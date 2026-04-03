import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getAeoBrandConfig } from "@/lib/server/db";

export const maxDuration = 60;

function safeJson<T>(text: string, fallback: T): T {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  try { return JSON.parse(match?.[1] ?? text) as T; } catch { return fallback; }
}

export interface SuggestGroup {
  intent: string;
  description: string;
  prompts: string[];
}

export async function POST() {
  try {
    const sessionId = await getSession();
    const config = getAeoBrandConfig(sessionId);

    if (!config.brandName) {
      return NextResponse.json({ error: "Configure your brand in Configuration → Brand & AEO first." }, { status: 400 });
    }

    const key = process.env.OPENROUTER_KEY;
    if (!key) return NextResponse.json({ error: "Missing OPENROUTER_KEY in environment." }, { status: 500 });

    const competitorList = config.competitors
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");

    const prompt = `You are an AI search visibility strategist. Generate 20 tracking prompts that someone monitoring the brand "${config.brandName}" should track across AI assistants (ChatGPT, Perplexity, Gemini, etc.).

Brand details:
- Brand: ${config.brandName}
- Industry: ${config.industry || "not specified"}
- Keywords: ${config.keywords || "not specified"}
- Competitors: ${competitorList || "not specified"}
- Description: ${config.description || "not specified"}

Generate prompts in 4 intent groups (5 prompts each):
1. awareness — "what is X", "X reviews", "is X good", "X overview", "tell me about X"
2. comparison — "X vs [competitor]", "alternatives to X", "best X alternatives", "X compared to [competitor]"
3. feature — "X for [use case]", "does X have [feature]", "how does X help with [keyword]", "X [specific service]"
4. decision — "should I use X", "X pricing", "X worth it", "X pros and cons", "how to get started with X"

Rules:
- Make prompts conversational, exactly how a user would type into ChatGPT or Perplexity
- Use the actual brand name "${config.brandName}" in prompts where natural
- Mix in competitor names where relevant
- Keep prompts specific to the industry: ${config.industry || "general"}

Return ONLY a JSON array of objects, no other text:
[
  {
    "intent": "awareness",
    "description": "Prompts to track how AI describes your brand",
    "prompts": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5"]
  },
  {
    "intent": "comparison",
    "description": "Prompts where users compare you to competitors",
    "prompts": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5"]
  },
  {
    "intent": "feature",
    "description": "Prompts about specific use cases and features",
    "prompts": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5"]
  },
  {
    "intent": "decision",
    "description": "Prompts from users making a decision",
    "prompts": ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5"]
  }
]`;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "moonshotai/kimi-k2.5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 6000,
        temperature: 0.4,
      }),
    });

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: number } };

    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `OpenRouter error (${res.status})`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) {
      return NextResponse.json({ error: "OpenRouter returned an empty response. The model may be overloaded — try again in a moment." }, { status: 502 });
    }

    const groups = safeJson<SuggestGroup[]>(text, []);

    if (!groups.length) {
      return NextResponse.json({ error: "Failed to parse suggestions from AI response. Try again." }, { status: 500 });
    }

    return NextResponse.json({ groups });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Unexpected error: ${msg}` }, { status: 500 });
  }
}
