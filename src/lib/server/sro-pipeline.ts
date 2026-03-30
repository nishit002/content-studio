/**
 * SRO Pipeline — server-side helpers for AEO/SRO analysis.
 * Combines: Gemini Grounding, SERP (BrightData), Web Unlocker (BrightData),
 * Site Context extraction (OpenRouter), and final SRO LLM analysis (OpenRouter).
 */

import type {
  GroundingResult,
  GroundingChunk,
  GroundingSupport,
  SerpResult,
  SerpOrganicResult,
  ScrapedPage,
  SiteContext,
  LLMAnalysisInput,
  LLMAnalysisResult,
  LLMRecommendation,
} from "./sro-types";

// ─── Helpers ─────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function urlMatchesTarget(sourceUrl: string, targetUrl: string): boolean {
  const sourceDomain = extractDomain(sourceUrl);
  const targetDomain = extractDomain(targetUrl);
  if (!sourceDomain || !targetDomain) return false;
  return sourceDomain === targetDomain;
}

// ─── Gemini Grounding ─────────────────────────────────────────────────────

export async function analyzeGrounding(
  keyword: string,
  targetUrl: string
): Promise<GroundingResult> {
  const keys = (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "").split(",").filter(Boolean);
  const apiKey = keys[0];

  if (!apiKey) {
    throw new Error("No Gemini API key configured.");
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: keyword,
    config: { tools: [{ googleSearch: {} }] },
  });

  const candidate = response.candidates?.[0];
  const metadata = candidate?.groundingMetadata;
  const answerText = response.text ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunks: GroundingChunk[] = ((metadata?.groundingChunks ?? []) as any[]).map((c) => ({
    uri: c?.web?.uri ?? "",
    title: c?.web?.title ?? "",
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supports: GroundingSupport[] = ((metadata?.groundingSupports ?? []) as any[]).map((s) => ({
    startIndex: s?.segment?.startIndex ?? 0,
    endIndex: s?.segment?.endIndex ?? 0,
    text: s?.segment?.text ?? "",
    chunkIndices: s?.groundingChunkIndices ?? [],
    confidenceScores: s?.confidenceScores ?? [],
  }));

  const searchQueries = (metadata?.webSearchQueries as string[]) ?? [];
  const targetDomain = extractDomain(targetUrl);

  const targetChunkIndices: number[] = [];
  chunks.forEach((chunk, idx) => {
    const titleDomain = chunk.title.replace(/^www\./, "").toLowerCase();
    if (
      urlMatchesTarget(chunk.uri, targetUrl) ||
      titleDomain === targetDomain ||
      titleDomain.endsWith(`.${targetDomain}`)
    ) {
      targetChunkIndices.push(idx);
    }
  });

  const targetSnippets: string[] = [];
  for (const support of supports) {
    if (support.chunkIndices.some((idx) => targetChunkIndices.includes(idx)) && support.text) {
      targetSnippets.push(support.text);
    }
  }

  const totalGroundingWords = supports.reduce((sum, s) => sum + (s.text?.split(/\s+/).length ?? 0), 0);
  const targetGroundingWords = targetSnippets.reduce((sum, s) => sum + s.split(/\s+/).length, 0);

  return {
    query: keyword,
    answer: answerText,
    searchQueries,
    chunks,
    supports,
    targetUrlFound: targetChunkIndices.length > 0,
    targetUrlChunkIndices: targetChunkIndices,
    targetSnippets,
    totalGroundingWords,
    targetGroundingWords,
    selectionRate: totalGroundingWords > 0 ? targetGroundingWords / totalGroundingWords : 0,
  };
}

// ─── SERP (BrightData) ────────────────────────────────────────────────────

export async function fetchSerp(keyword: string, targetUrl: string): Promise<SerpResult> {
  const apiKey = process.env.BRIGHT_DATA_KEY;
  const zone = process.env.BRIGHT_DATA_SERP_ZONE || "serp_api1";
  const empty: SerpResult = { keyword, totalResults: 0, organicResults: [], targetRank: null, topCompetitors: [] };

  if (!apiKey) return empty;

  const targetDomain = extractDomain(targetUrl);
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&gl=in&brd_json=1`;

  try {
    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url: googleUrl, format: "json" }),
    });

    if (!response.ok) return empty;

    const data = await response.json();
    const body = typeof data.body === "string" ? JSON.parse(data.body) : data.body;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawOrganic: any[] = body?.organic ?? [];

    let targetRank: number | null = null;
    const organicResults: SerpOrganicResult[] = [];
    const topCompetitors: string[] = [];

    for (const item of rawOrganic) {
      const url = item.link ?? "";
      const domain = extractDomain(url);
      const position = item.rank ?? item.global_rank ?? organicResults.length + 1;
      const isTarget = domain === targetDomain;

      organicResults.push({ position, url, domain, title: item.title ?? "", description: item.description ?? item.snippet ?? "", isTarget });
      if (isTarget && targetRank === null) targetRank = position;
      if (!isTarget && topCompetitors.length < 5) topCompetitors.push(url);
    }

    return { keyword, totalResults: organicResults.length, organicResults, targetRank, topCompetitors };
  } catch {
    return empty;
  }
}

// ─── Web Unlocker / Page Scraper (BrightData) ────────────────────────────

function extractTitleFromMarkdown(md: string): string {
  const match = md.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function extractHeadingsFromMarkdown(md: string): string[] {
  const headings: string[] = [];
  const re = /^(#{1,3})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const text = m[2].trim();
    if (text) headings.push(text);
  }
  return headings;
}

function countWords(md: string): number {
  return md.replace(/^#{1,6}\s+/gm, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_~`#>|]/g, "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

export async function scrapePage(url: string): Promise<ScrapedPage> {
  const apiKey = process.env.BRIGHT_DATA_KEY;
  const base = { url, domain: new URL(url).hostname, title: "", headings: [], wordCount: 0, contentSnippet: "", fullText: "", metaDescription: "" };

  if (!apiKey) return { ...base, error: "BRIGHT_DATA_KEY not configured" };

  const zone = process.env.BRIGHT_DATA_UNLOCKER_ZONE || "web_unlocker1";

  try {
    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url, format: "raw", data_format: "markdown" }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const markdown = await response.text();
    const words = markdown.split(/\s+/);

    return {
      url,
      domain: new URL(url).hostname,
      title: extractTitleFromMarkdown(markdown),
      headings: extractHeadingsFromMarkdown(markdown),
      wordCount: countWords(markdown),
      contentSnippet: words.slice(0, 500).join(" "),
      fullText: markdown,
      metaDescription: "",
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function scrapePages(urls: string[]): Promise<ScrapedPage[]> {
  return Promise.all(urls.slice(0, 5).map((u) => scrapePage(u)));
}

// ─── Site Context (OpenRouter) ────────────────────────────────────────────

export async function extractSiteContext(targetUrl: string): Promise<SiteContext> {
  const domain = extractDomain(targetUrl);
  const homepageUrl = `https://${domain}`;
  const base: SiteContext = { domain, homepageUrl, primaryTopics: [], industry: "Unknown", targetAudience: "Unknown", contentThemes: [], siteDescription: "" };

  const page = await scrapePage(homepageUrl);
  if (page.error || !page.fullText) return { ...base, error: page.error || "Could not scrape homepage" };

  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    return { ...base, primaryTopics: page.headings.slice(0, 10), contentThemes: page.headings.slice(0, 5), siteDescription: page.contentSnippet.slice(0, 300) };
  }

  const prompt = `Analyze this homepage and extract structured site context. Respond ONLY with valid JSON:
{"primaryTopics":[],"industry":"","targetAudience":"","contentThemes":[],"siteDescription":""}

URL: ${homepageUrl}
Headings: ${page.headings.slice(0, 20).join(", ")}
Content:
${page.fullText.slice(0, 4000)}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.0-flash-001", messages: [{ role: "user", content: prompt }], max_tokens: 1000, temperature: 0.1, response_format: { type: "json_object" } }),
    });

    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);

    const json = await res.json();
    const raw = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;

    return {
      domain, homepageUrl,
      primaryTopics: Array.isArray(raw.primaryTopics) ? raw.primaryTopics.filter((t: unknown) => typeof t === "string") : [],
      industry: typeof raw.industry === "string" ? raw.industry : "Unknown",
      targetAudience: typeof raw.targetAudience === "string" ? raw.targetAudience : "Unknown",
      contentThemes: Array.isArray(raw.contentThemes) ? raw.contentThemes.filter((t: unknown) => typeof t === "string") : [],
      siteDescription: typeof raw.siteDescription === "string" ? raw.siteDescription : "",
    };
  } catch {
    return { ...base, primaryTopics: page.headings.slice(0, 10), contentThemes: page.headings.slice(0, 5), siteDescription: page.contentSnippet.slice(0, 300) };
  }
}

// ─── SRO LLM Analysis (OpenRouter) ───────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert SRO (Selection Rate Optimization) analyst. SRO optimizes web content to be selected by AI systems as grounding sources.

Key concepts:
- Selection Rate: share of AI grounding budget allocated to a source (~2000 words per query)
- Higher selection = more influence on AI answers
- Factors: front-loaded facts, self-contained statements, factual density, structured markup, cross-platform presence

Respond ONLY with valid JSON:
{"overallScore":<0-100>,"summary":"<2-3 sentences>","recommendations":[{"category":"<content|structure|technical|strategy>","priority":"<high|medium|low>","title":"","description":"","actionItems":[]}],"contentGaps":[],"competitorInsights":[]}`;

function truncate(text: string, max: number) {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

function buildPrompt(input: LLMAnalysisInput): string {
  const g = input.grounding;
  const groundingSection = g
    ? [
        `Target found in grounding: ${g.targetUrlFound ? "YES" : "NO"}`,
        `Selection Rate: ${(g.selectionRate * 100).toFixed(1)}%`,
        `Target words: ${g.targetGroundingWords}/${g.totalGroundingWords}`,
        g.targetSnippets.slice(0, 3).map((s) => `  Snippet: "${truncate(s, 200)}"`).join("\n"),
        `All sources: ${g.chunks.map((c, i) => `#${i + 1} ${c.title}${g.targetUrlChunkIndices.includes(i) ? " [TARGET]" : ""}`).join(", ")}`,
      ].join("\n")
    : "No grounding data.";

  const serpSection = input.serp
    ? [`Rank: ${input.serp.targetRank ?? "Not found"}`, input.serp.organicResults.slice(0, 8).map((r) => `  #${r.position}: ${r.url}${r.isTarget ? " [TARGET]" : ""}`).join("\n")].join("\n")
    : "No SERP data.";

  const pageSection = input.targetPage
    ? [`Title: ${input.targetPage.title}`, `Words: ${input.targetPage.wordCount}`, `Headings: ${input.targetPage.headings.slice(0, 15).join(", ")}`, `Content: ${truncate(input.targetPage.contentSnippet, 3000)}`].join("\n")
    : "No page data.";

  const competitorSection = input.competitorPages.length
    ? input.competitorPages.slice(0, 3).map((p) => `--- ${p.url} ---\nWords: ${p.wordCount}\nHeadings: ${p.headings.slice(0, 8).join(", ")}\n${truncate(p.contentSnippet, 1500)}`).join("\n\n")
    : "No competitor data.";

  const prompt = [
    `Target URL: ${input.targetUrl}`,
    `Keyword: ${input.keyword}`,
    `\n=== GEMINI GROUNDING ===\n${groundingSection}`,
    `\n=== SERP DATA ===\n${serpSection}`,
    `\n=== TARGET PAGE ===\n${pageSection}`,
    `\n=== COMPETITORS ===\n${competitorSection}`,
    `\nProvide specific SRO recommendations to improve selection rate for "${input.keyword}".`,
  ].join("\n");

  return prompt.length > 50000 ? prompt.slice(0, 50000) + "\n[truncated]" : prompt;
}

function parseAnalysis(raw: unknown): LLMAnalysisResult {
  const d = raw as Record<string, unknown>;
  const recommendations: LLMRecommendation[] = [];

  if (Array.isArray(d.recommendations)) {
    for (const r of d.recommendations) {
      const rec = r as Record<string, unknown>;
      recommendations.push({
        category: ["content", "structure", "technical", "strategy"].includes(rec.category as string) ? rec.category as LLMRecommendation["category"] : "strategy",
        priority: ["high", "medium", "low"].includes(rec.priority as string) ? rec.priority as LLMRecommendation["priority"] : "medium",
        title: typeof rec.title === "string" ? rec.title : "Untitled",
        description: typeof rec.description === "string" ? rec.description : "",
        actionItems: Array.isArray(rec.actionItems) ? rec.actionItems.filter((i: unknown) => typeof i === "string") : [],
      });
    }
  }

  return {
    overallScore: Math.max(0, Math.min(100, Number(d.overallScore) || 0)),
    summary: typeof d.summary === "string" ? d.summary : "Analysis complete.",
    recommendations,
    contentGaps: Array.isArray(d.contentGaps) ? d.contentGaps.filter((g: unknown) => typeof g === "string") : [],
    competitorInsights: Array.isArray(d.competitorInsights) ? d.competitorInsights.filter((i: unknown) => typeof i === "string") : [],
  };
}

export async function analyzeSRO(input: LLMAnalysisInput): Promise<LLMAnalysisResult> {
  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    return { overallScore: 0, summary: "OpenRouter key not configured.", recommendations: [], contentGaps: [], competitorInsights: [] };
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: buildPrompt(input) }],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("No content in response");

    return parseAnalysis(JSON.parse(content));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { overallScore: 0, summary: `Analysis failed: ${msg}`, recommendations: [], contentGaps: [], competitorInsights: [] };
  }
}
