import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import {
  getAeoBrandConfig,
  getAeoRuns,
  saveAeoBattlecard,
  getAeoBattlecards,
  deleteAeoBattlecard,
} from "@/lib/server/db";

export const maxDuration = 120;

async function callOpenRouter(prompt: string): Promise<string> {
  const key = process.env.OPENROUTER_KEY;
  if (!key) throw new Error("Missing OPENROUTER_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "moonshotai/kimi-k2.5",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4000,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error (${res.status}): ${await res.text()}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

function safeJson<T>(text: string, fallback: T): T {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  try { return JSON.parse(match?.[1] ?? text) as T; } catch { return fallback; }
}

export async function GET() {
  const sessionId = await getSession();
  return NextResponse.json(getAeoBattlecards(sessionId));
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const { type } = await req.json() as { type: "battlecards" | "niche" | "fanout" };
  const config = getAeoBrandConfig(sessionId);
  const runs = getAeoRuns(sessionId, 100);

  if (!config.brandName) return NextResponse.json({ error: "Configure brand settings first." }, { status: 400 });

  if (type === "battlecards") {
    const competitors = config.competitors.split(",").map(s => s.trim()).filter(Boolean);
    if (!competitors.length) return NextResponse.json({ error: "Add competitors in Brand Settings first." }, { status: 400 });

    const runSummary = runs.slice(0, 30).map(r =>
      `[${r.provider}] "${r.promptText}" → score ${r.visibilityScore}, sentiment: ${r.sentiment}, mentioned: ${r.brandMentioned}`
    ).join("\n");

    const cards = [];
    for (const competitor of competitors.slice(0, 5)) {
      const prompt = `You are a competitive intelligence analyst. Based on the following AI visibility data for brand "${config.brandName}" vs competitor "${competitor}", create a battlecard.

Brand: ${config.brandName}
Industry: ${config.industry}
Keywords: ${config.keywords}
Competitor: ${competitor}

Recent AI visibility run data:
${runSummary}

Return a JSON object with this exact structure:
{
  "competitor": "${competitor}",
  "summary": "2-3 sentence competitive summary",
  "sentiment": "positive|neutral|negative",
  "sections": [
    {"title": "Where we win", "content": "..."},
    {"title": "Where they win", "content": "..."},
    {"title": "Key differentiators", "content": "..."},
    {"title": "Recommended talking points", "content": "..."}
  ]
}`;

      const text = await callOpenRouter(prompt);
      const parsed = safeJson<{ competitor: string; summary: string; sentiment: string; sections: { title: string; content: string }[] }>(text, {
        competitor,
        summary: text.slice(0, 200),
        sentiment: "neutral",
        sections: [{ title: "Analysis", content: text }],
      });

      const card = {
        id: uuidv4(),
        competitor,
        summary: parsed.summary ?? "",
        sections: parsed.sections ?? [],
        sentiment: parsed.sentiment ?? "neutral",
        createdAt: new Date().toISOString(),
      };
      saveAeoBattlecard(sessionId, card);
      cards.push(card);
    }
    return NextResponse.json({ battlecards: cards });
  }

  if (type === "niche") {
    const prompt = `You are an AI search visibility strategist. Generate 15-20 niche, long-tail questions that users might ask AI assistants (ChatGPT, Perplexity, Gemini, etc.) when looking for information in this space.

Brand: ${config.brandName}
Industry: ${config.industry}
Keywords: ${config.keywords}
Description: ${config.description}

Requirements:
- Questions should be conversational, as people actually ask AI assistants
- Mix of informational, comparison, and recommendation queries
- Cover different intents: "best X for Y", "how to choose X", "what is the difference between X and Y"
- Return a JSON array of strings, each being one question

Example format: ["What is the best MBA college in India for finance?", ...]`;

    const text = await callOpenRouter(prompt);
    const questions = safeJson<string[]>(text, []);
    return NextResponse.json({ questions });
  }

  if (type === "fanout") {
    const prompt = `You are an AI persona strategist. Generate prompt variants for 5 different user personas who might ask about "${config.brandName}" or its space.

Brand: ${config.brandName}
Industry: ${config.industry}
Keywords: ${config.keywords}

For each persona, generate 3 prompt variants they would use when asking an AI assistant.

Return a JSON array of objects:
[
  {
    "persona": "persona name/description",
    "prompts": ["prompt 1", "prompt 2", "prompt 3"]
  }
]`;

    const text = await callOpenRouter(prompt);
    const personas = safeJson<Array<{ persona: string; prompts: string[] }>>(text, []);
    return NextResponse.json({ personas });
  }

  return NextResponse.json({ error: "Invalid type. Use: battlecards, niche, fanout" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const sessionId = await getSession();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteAeoBattlecard(sessionId, id);
  return NextResponse.json({ ok: true });
}
