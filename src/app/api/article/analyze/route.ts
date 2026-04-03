/**
 * POST /api/article/analyze
 *
 * Analyzes an article section-by-section and returns structured JSON:
 *   { titleIssue: { issue, suggested } | null, sections: [{ heading, issue }] }
 *
 * Used by the Rewrite panel in both tabs to show per-section issues
 * and pre-fill instruction textareas before the user hits Start Rewrite.
 *
 * Input:  { html, topic, contentType?, qualityScore?, currentTitle? }
 * Output: { titleIssue: {issue,suggested}|null, sections: [{heading,issue}] }
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Strip HTML to a structured summary the LLM can reason about ─────────────

function stripToStructure(html: string): string {
  const sections: string[] = [];

  // Split on H2/H3 boundaries
  const sectionBlocks = html.split(/<h[23][^>]*>/i).slice(1);

  for (const block of sectionBlocks) {
    const headingMatch = block.match(/^(.*?)<\/h[23]>/i);
    const heading = headingMatch
      ? headingMatch[1].replace(/<[^>]+>/g, "").trim()
      : "Untitled";

    const pMatches = block.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    const prose = pMatches
      .map((p) => p.replace(/<[^>]+>/g, "").trim())
      .join(" ")
      .slice(0, 200);

    const thMatches = block.match(/<th[^>]*>[\s\S]*?<\/th>/gi) || [];
    const cols = thMatches.map((th) => th.replace(/<[^>]+>/g, "").trim()).join(", ");
    const rowCount = (block.match(/<tr/gi) || []).length - 1;

    let summary = `SECTION: ${heading}`;
    if (prose) summary += `\n  Prose: ${prose}${prose.length >= 200 ? "…" : ""}`;
    if (cols) summary += `\n  Table columns: ${cols} (${rowCount} data rows)`;
    if (!prose && !cols) summary += "\n  [empty — no prose or table found]";

    sections.push(summary);
  }

  return sections.join("\n\n");
}

// ─── Analysis prompt ──────────────────────────────────────────────────────────

const ANALYZE_PROMPT = `You are a senior content quality analyst. Analyze this article and output a JSON object describing issues.

Article topic: {topic}
Content type: {contentType}
Current quality score: {score}/100
Current title: {currentTitle}

Article structure:
{structure}

Output ONLY a valid JSON object with this exact structure — no text before or after:
{
  "titleIssue": { "issue": "why the title is generic or weak", "suggested": "a specific replacement title with concrete facts like rank, fees, year" } or null,
  "sections": [
    { "heading": "exact section heading from the article", "issue": "one specific actionable issue for this section" }
  ]
}

Rules for titleIssue:
- Set if title matches generic patterns: "X: Overview, Key Highlights & Why It Matters", "X: Complete Guide", "X: Key Facts & Why It Matters", "X: Overview, & Key Facts", etc.
- If title is already specific and contains concrete facts (rank, fees, key stat), set to null.
- suggested must include at least one concrete fact from the article structure above.

Rules for sections:
- Only include sections with a genuine, specific issue — skip sections that are fine.
- One issue per section, max 15 words. Be direct: "Missing hostel/mess fees breakdown" not "could be improved".
- Do NOT invent issues — only flag what is clearly missing or weak from the structure above.
- Max 8 sections in the output.`;

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const key = process.env.OPENROUTER_KEY;
  if (!key) return NextResponse.json({ error: "OPENROUTER_KEY not configured" }, { status: 500 });

  let body: { html?: string; topic?: string; contentType?: string; qualityScore?: number; currentTitle?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { html = "", topic = "", contentType = "article", qualityScore = 0, currentTitle = "" } = body;
  if (!html || !topic) return NextResponse.json({ error: "html and topic required" }, { status: 400 });

  const structure = stripToStructure(html);
  if (!structure.trim()) return NextResponse.json({ titleIssue: null, sections: [] });

  const prompt = ANALYZE_PROMPT
    .replace("{topic}", topic)
    .replace("{contentType}", contentType)
    .replace("{score}", String(qualityScore))
    .replace("{currentTitle}", currentTitle || "(not provided)")
    .replace("{structure}", structure);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "moonshotai/kimi-k2.5",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `OpenRouter error: ${err.slice(0, 200)}` }, { status: 500 });
    }

    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim() || "";

    // Parse JSON — strip any markdown fences the model might add
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      const parsed = JSON.parse(cleaned) as {
        titleIssue: { issue: string; suggested: string } | null;
        sections: { heading: string; issue: string }[];
      };
      return NextResponse.json({
        titleIssue: parsed.titleIssue || null,
        sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      });
    } catch {
      // LLM didn't return valid JSON — return empty result rather than crashing
      return NextResponse.json({ titleIssue: null, sections: [] });
    }

  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
