import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import {
  getAeoBrandConfig, getAeoPrompts,
  saveCompetitorResearch, getCompetitorResearch, listCompetitorResearch, deleteCompetitorResearch,
  type CompetitorResearchResult,
} from "@/lib/server/db";

export const maxDuration = 60;

function safeJson<T>(text: string, fallback: T): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  try { return JSON.parse(m?.[1] ?? text) as T; } catch { return fallback; }
}

function extractDomain(raw: string): string {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0].split("?")[0];
  }
}

function isTracked(keyword: string, trackedSet: Set<string>): boolean {
  const kLow = keyword.toLowerCase();
  if (trackedSet.has(kLow)) return true;
  // 2+ significant word overlap
  const kWords = kLow.split(/\s+/).filter(w => w.length > 3);
  for (const tracked of trackedSet) {
    const tWords = tracked.split(/\s+/).filter(w => w.length > 3);
    const overlap = tWords.filter(w => kWords.includes(w)).length;
    if (overlap >= 2) return true;
  }
  return false;
}

/* ── GET — list all researched sites or fetch one by domain ── */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const domain = new URL(req.url).searchParams.get("domain");
  if (domain) {
    const cached = getCompetitorResearch(sessionId, domain);
    if (cached) return NextResponse.json(cached);
    return NextResponse.json({ error: "Not analyzed yet." }, { status: 404 });
  }
  return NextResponse.json({ sites: listCompetitorResearch(sessionId) });
}

/* ── DELETE — remove a cached site ── */
export async function DELETE(req: NextRequest) {
  const sessionId = await getSession();
  const domain = new URL(req.url).searchParams.get("domain");
  if (domain) deleteCompetitorResearch(sessionId, domain);
  return NextResponse.json({ ok: true });
}

function calcTrend(monthly: Array<{ year: number; month: number; search_volume: number }>): string {
  if (monthly.length < 6) return "unknown";
  const sorted = [...monthly].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  const recent = sorted.slice(-3).reduce((s, m) => s + m.search_volume, 0);
  const prev = sorted.slice(-6, -3).reduce((s, m) => s + m.search_volume, 0);
  if (prev === 0) return "unknown";
  return recent > prev * 1.1 ? "rising" : recent < prev * 0.9 ? "declining" : "stable";
}

/* ── POST — analyze a competitor website ── */
export async function POST(req: NextRequest) {
  try {
    const sessionId = await getSession();
    const body = await req.json() as { url?: string };
    const inputUrl = body.url?.trim();
    if (!inputUrl) return NextResponse.json({ error: "URL is required." }, { status: 400 });

    const openrouterKey = process.env.OPENROUTER_KEY;
    if (!openrouterKey) return NextResponse.json({ error: "OPENROUTER_KEY not set." }, { status: 500 });

    const domain = extractDomain(inputUrl);
    const fullUrl = inputUrl.startsWith("http") ? inputUrl : `https://${inputUrl}`;

    const brandConfig = getAeoBrandConfig(sessionId);
    const trackedPrompts = getAeoPrompts(sessionId);
    const trackedSet = new Set(trackedPrompts.map(p => p.promptText.toLowerCase()));

    const dfsLogin = process.env.DATAFORSEO_LOGIN;
    const dfsPass = process.env.DATAFORSEO_PASSWORD;
    const dfsConfigured = !!(dfsLogin && dfsPass);

    // ── 1. DataForSEO keywords_for_site (real Google organic keywords + volumes) ──
    type DfsKeyword = { keyword: string; search_volume: number; monthly_searches?: Array<{ year: number; month: number; search_volume: number }> };
    let organicFromDfs: DfsKeyword[] = [];
    let dfsError = false;

    if (dfsConfigured) {
      const auth = Buffer.from(`${dfsLogin}:${dfsPass}`).toString("base64");
      try {
        const dfsRes = await fetch("https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_site/live", {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify([{ target: domain, location_code: 2356, language_code: "en", limit: 50 }]),
          signal: AbortSignal.timeout(15000),
        });
        if (dfsRes.ok) {
          const dfsData = await dfsRes.json() as { tasks?: Array<{ result?: DfsKeyword[] }> };
          for (const task of dfsData.tasks ?? []) {
            organicFromDfs.push(...(task.result ?? []));
          }
        } else {
          dfsError = true;
        }
      } catch {
        dfsError = true;
      }
    }

    // ── 2. AI: generate ai_prompts (+ organic fallback if DataForSEO not available) ──
    let aiOrganic: string[] = [];
    let aiPromptsList: string[] = [];
    let aiIndustry = "unknown";
    let aiBrand = domain;
    let warning: string | undefined;

    const needAiOrganic = !dfsConfigured || dfsError || organicFromDfs.length === 0;

    if (needAiOrganic) {
      warning = dfsConfigured
        ? "DataForSEO returned no keywords — showing AI-estimated keywords only"
        : "DataForSEO not configured — showing AI-estimated keywords only";
    }

    const aiPromptText = needAiOrganic
      ? `You are an SEO and AI-search expert. Analyze this website and generate search queries.

Website domain: ${domain}
${brandConfig.industry ? `Industry context: ${brandConfig.industry}` : ""}

Generate exactly two categories:
1. ORGANIC: 20 real Google/Bing search queries that drive traffic to this site. Mix short-tail and long-tail.
2. AI_PROMPTS: 15 conversational queries someone would type into ChatGPT/Perplexity/Gemini that would result in this site being cited.

Return ONLY valid JSON:
{"industry":"string","brand":"string","organic":["...x20"],"ai_prompts":["...x15"]}`
      : `You are an AI-search expert. Generate conversational AI-grounding prompts for this website.

Website domain: ${domain}
${brandConfig.industry ? `Industry context: ${brandConfig.industry}` : ""}

Generate 15 natural-language questions that someone would type into ChatGPT, Perplexity, or Gemini where this site would be recommended or cited as a source.

Return ONLY valid JSON:
{"industry":"string","brand":"string","ai_prompts":["...x15"]}`;

    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "moonshotai/kimi-k2.5",
        messages: [{ role: "user", content: aiPromptText }],
        max_tokens: needAiOrganic ? 5000 : 3000,
        temperature: 0.3,
      }),
    });

    const aiData = await aiRes.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!aiRes.ok || aiData.error) {
      return NextResponse.json({ error: aiData.error?.message ?? `AI error (${aiRes.status})` }, { status: 502 });
    }

    const aiText = aiData.choices?.[0]?.message?.content ?? "";
    if (!aiText) return NextResponse.json({ error: "AI returned empty response. Try again." }, { status: 502 });

    const parsed = safeJson<{ industry?: string; brand?: string; organic?: string[]; ai_prompts?: string[] }>(aiText, {});
    aiIndustry = parsed.industry ?? "unknown";
    aiBrand = parsed.brand ?? domain;
    aiOrganic = (parsed.organic ?? []).slice(0, 20).map(k => k.trim()).filter(Boolean);
    aiPromptsList = (parsed.ai_prompts ?? []).slice(0, 15).map(k => k.trim()).filter(Boolean);

    if (!aiPromptsList.length && needAiOrganic && !aiOrganic.length) {
      return NextResponse.json({ error: "AI could not generate keywords for this website. Try again." }, { status: 500 });
    }

    // ── 3. Fetch volumes for AI-estimated organic keywords (fallback mode only) ──
    const aiVolumeMap = new Map<string, { volume: number; trend: string }>();
    if (needAiOrganic && aiOrganic.length > 0 && dfsConfigured) {
      const auth = Buffer.from(`${dfsLogin}:${dfsPass}`).toString("base64");
      try {
        const payload = aiOrganic.map(k => ({ keywords: [k], location_code: 2356, language_code: "en", search_partners: false }));
        const volRes = await fetch("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
        if (volRes.ok) {
          const volData = await volRes.json() as { tasks?: Array<{ result?: DfsKeyword[] }> };
          for (const task of volData.tasks ?? []) {
            for (const item of task.result ?? []) {
              aiVolumeMap.set(item.keyword.toLowerCase(), {
                volume: item.search_volume ?? 0,
                trend: calcTrend(item.monthly_searches ?? []),
              });
            }
          }
        }
      } catch { /* volumes remain null */ }
    }

    // ── 4. Build keyword list ──
    const organicKeywords = needAiOrganic
      ? aiOrganic.map(k => {
          const vol = aiVolumeMap.get(k.toLowerCase());
          return { text: k, type: "organic" as const, volume: vol?.volume ?? null, trend: vol?.trend ?? "unknown", tracked: isTracked(k, trackedSet) };
        })
      : organicFromDfs.map(k => ({
          text: k.keyword,
          type: "organic" as const,
          volume: k.search_volume ?? null,
          trend: calcTrend(k.monthly_searches ?? []),
          tracked: isTracked(k.keyword, trackedSet),
        }));

    const aiPromptKeywords = aiPromptsList.map(k => ({
      text: k,
      type: "ai_prompt" as const,
      volume: null,
      trend: "unknown",
      tracked: isTracked(k, trackedSet),
    }));

    const keywords = [
      ...organicKeywords.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)),
      ...aiPromptKeywords,
    ];

    const result: CompetitorResearchResult = {
      id: uuidv4(),
      domain,
      url: fullUrl,
      industry: aiIndustry,
      brand: aiBrand,
      keywords,
      totalVolume: keywords.reduce((s, k) => s + (k.volume ?? 0), 0),
      analyzedAt: new Date().toISOString(),
      ...(warning ? { warning } : {}),
    };

    saveCompetitorResearch(sessionId, domain, result);
    return NextResponse.json(result);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Unexpected error: ${msg}` }, { status: 500 });
  }
}
