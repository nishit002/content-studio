import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import path from "path";
import fs from "fs";

export const maxDuration = 60;

/**
 * POST /api/rewrite
 *
 * Rewrites a single HTML section of an article using OpenRouter (kimi-k2.5).
 * Guardrails are baked into the system prompt to prevent scope creep.
 * If a slug is provided, loads research_index.json for factual grounding.
 *
 * Body: {
 *   sectionHeading: string   — the h2/h3 heading of the section
 *   sectionHtml: string      — full HTML of the section (including heading tag)
 *   instruction: string      — user's plain-English instruction
 *   topicContext?: string    — article topic for context (optional)
 *   qualityIssues?: string[] — known quality issues for context (optional)
 *   slug?: string            — article slug to load research_index.json (optional)
 * }
 *
 * Returns: { html: string }  — rewritten section HTML only
 */
export async function POST(req: NextRequest) {
  await getSession();

  const body = await req.json() as {
    sectionHeading: string;
    sectionHtml: string;
    instruction: string;
    topicContext?: string;
    qualityIssues?: string[];
    slug?: string;
  };

  const { sectionHeading, sectionHtml, instruction, topicContext, qualityIssues, slug } = body;

  if (!sectionHeading || !sectionHtml || !instruction?.trim()) {
    return NextResponse.json({ error: "sectionHeading, sectionHtml, and instruction are required" }, { status: 400 });
  }

  const key = process.env.OPENROUTER_KEY;
  if (!key) {
    return NextResponse.json({ error: "OPENROUTER_KEY not configured" }, { status: 500 });
  }

  // Load research index for factual grounding if slug is provided
  const PIPELINE_DIR = process.env.PIPELINE_DIR || path.resolve("/Volumes/NISHIT_PD/gas new/gas-split/content-generator");
  const OUTPUT_DIR = path.join(PIPELINE_DIR, "output");
  let researchBlock = "";
  if (slug) {
    try {
      const indexPath = path.join(OUTPUT_DIR, slug, "research_index.json");
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, "utf-8");
        const index = JSON.parse(raw);
        // Stringify compactly, cap at 20k chars so we don't blow token budget
        const indexStr = JSON.stringify(index, null, 2).slice(0, 20000);
        researchBlock = `\n\n═══ VERIFIED RESEARCH DATA — USE THIS, DO NOT INVENT ═══
The data below was extracted from real sources when this article was originally written.
ONLY use facts from this research. Do NOT use your training knowledge to fill gaps.
If a fact you want to write is NOT in this research, skip it or say "refer to the official website".

${indexStr}`;
      }
    } catch {
      // Research index not found — proceed without it
    }
  }

  const contextNote = topicContext ? `The full article is about: "${topicContext}".` : "";
  const issuesNote = qualityIssues?.length
    ? `Known quality issues in the full article: ${qualityIssues.slice(0, 5).join("; ")}.`
    : "";

  const systemPrompt = `You are a precise content editor. Your job is to rewrite ONE specific HTML section of an existing article.

STRICT RULES you must follow:
1. Only rewrite the section provided — do NOT touch any other part of the article.
2. Keep the EXACT same heading tag and heading text (e.g. <h2>Same Heading</h2>).
3. Do NOT add an introduction or conclusion that summarises the whole article.
4. Do NOT repeat facts, statistics, or data that belong in other sections.
5. Do NOT add new headings or sub-sections beyond what the original had.
6. Address ONLY the user's specific instruction — nothing more.
7. Output clean, valid HTML only — no markdown, no code fences, no explanatory text.
8. Preserve tables, lists, and inline formatting where appropriate.
9. Keep roughly the same length as the original section (±20%).
10. NEVER invent facts, statistics, scores, or dates — only use data from the verified research provided.`;

  const userPrompt = `${contextNote} ${issuesNote}${researchBlock}

Section heading: "${sectionHeading}"

Current section HTML:
${sectionHtml}

User instruction: ${instruction}

Rewrite only this section according to the instruction. Output the full rewritten section HTML including the heading tag.`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "moonshotai/kimi-k2.5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `OpenRouter error (${res.status}): ${text.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    let html = data.choices?.[0]?.message?.content ?? "";

    // Strip markdown code fences if the model wrapped output anyway
    html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    return NextResponse.json({ html });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
