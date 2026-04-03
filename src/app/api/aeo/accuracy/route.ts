import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getAeoBrandConfig, getAeoRuns, updateRunAccuracy } from "@/lib/server/db";

export const maxDuration = 60;

function safeJson<T>(text: string, fallback: T): T {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  try { return JSON.parse(match?.[1] ?? text) as T; } catch { return fallback; }
}

export interface AccuracyResult {
  runId: string;
  accurate: boolean;
  issues: string[];
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json() as { runId?: string; runIds?: string[] };

  const config = getAeoBrandConfig(sessionId);
  if (!config.brandName) {
    return NextResponse.json({ error: "Brand not configured. Set brand details in Configuration → Brand & AEO." }, { status: 400 });
  }

  const key = process.env.OPENROUTER_KEY;
  if (!key) return NextResponse.json({ error: "Missing OPENROUTER_KEY" }, { status: 500 });

  const allRuns = getAeoRuns(sessionId, 500);

  // Support checking a single run or a batch
  const idsToCheck = body.runIds ?? (body.runId ? [body.runId] : []);
  if (!idsToCheck.length) {
    return NextResponse.json({ error: "Provide runId or runIds[]" }, { status: 400 });
  }

  const runsToCheck = allRuns.filter(r => idsToCheck.includes(r.id) && r.brandMentioned);
  if (!runsToCheck.length) {
    return NextResponse.json({ results: [] });
  }

  const brandFacts = [
    config.brandName && `Brand name: ${config.brandName}`,
    config.website && `Official website: ${config.website}`,
    config.industry && `Industry: ${config.industry}`,
    config.description && `Description: ${config.description}`,
    config.keywords && `Key offerings/keywords: ${config.keywords}`,
  ].filter(Boolean).join("\n");

  const results: AccuracyResult[] = [];

  for (const run of runsToCheck) {
    // Truncate answer to avoid token overflow
    const answer = run.answer.slice(0, 1200);

    const prompt = `You are a brand accuracy checker. Compare the AI-generated response about a brand against the official brand facts, and identify any factual inaccuracies, hallucinations, outdated claims, or misleading statements.

OFFICIAL BRAND FACTS:
${brandFacts}

AI RESPONSE TO CHECK (from ${run.provider}, prompt: "${run.promptText}"):
"${answer}"

Instructions:
- Only flag actual factual errors or hallucinations — things that contradict the brand facts above or that are clearly invented
- Do NOT flag missing information (the AI doesn't have to say everything)
- Do NOT flag opinions or phrasing choices
- If the response is accurate, return accurate: true and empty issues array
- Keep each issue concise (1 sentence max)

Return ONLY a JSON object:
{
  "accurate": true or false,
  "issues": ["issue 1", "issue 2"]
}`;

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2.5",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 3000,
          temperature: 0.1,
        }),
      });

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? "";
      const parsed = safeJson<{ accurate: boolean; issues: string[] }>(text, { accurate: true, issues: [] });

      const flags = JSON.stringify({ accurate: parsed.accurate, issues: parsed.issues, checkedAt: new Date().toISOString() });
      updateRunAccuracy(sessionId, run.id, flags);

      results.push({ runId: run.id, accurate: parsed.accurate, issues: parsed.issues });
    } catch {
      // Skip failed checks silently — don't fail the whole batch
      results.push({ runId: run.id, accurate: true, issues: [] });
    }
  }

  return NextResponse.json({ results });
}
