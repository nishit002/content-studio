import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getAeoPrompts, updatePromptVolume } from "@/lib/server/db";

export const maxDuration = 60;

export interface VolumeResult {
  id: string;
  promptText: string;
  volume: number | null;   // monthly search volume (null = not found)
  trend: "rising" | "stable" | "declining" | "unknown";
  keyword: string;         // the keyword phrase used for lookup
}

// Strip conversational filler to get a better keyword phrase for volume lookup
function toKeyword(prompt: string): string {
  return prompt
    .replace(/^(what is|what are|tell me about|how to|how do i|best|top|find|show me|give me|list|compare|is|are|should i|can i|do you know)\s+/i, "")
    .replace(/\?$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    return NextResponse.json({ error: "DataForSEO credentials not configured. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to .env.local." }, { status: 400 });
  }

  // Accept explicit prompt list OR fetch all prompts for session
  let body: { promptIds?: string[] } = {};
  try { body = await req.json(); } catch { /* use all prompts */ }

  const allPrompts = getAeoPrompts(sessionId);
  const toFetch = body.promptIds
    ? allPrompts.filter(p => body.promptIds!.includes(p.id))
    : allPrompts;

  if (!toFetch.length) {
    return NextResponse.json({ error: "No prompts to fetch volume for." }, { status: 400 });
  }

  const keywords = toFetch.map(p => toKeyword(p.promptText));
  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  // DataForSEO: search volume in bulk (max 1000 per call)
  const chunks: string[][] = [];
  for (let i = 0; i < keywords.length; i += 100) chunks.push(keywords.slice(i, i + 100));

  const volumeMap = new Map<string, { search_volume: number; monthly_searches?: Array<{ year: number; month: number; search_volume: number }> }>();

  for (const chunk of chunks) {
    const payload = chunk.map(keyword => ({
      keywords: [keyword],
      location_code: 2356,   // India default (matches FindMyCollege)
      language_code: "en",
      search_partners: false,
    }));

    try {
      const res = await fetch("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) continue;

      const data = await res.json() as {
        tasks?: Array<{
          result?: Array<{
            keyword: string;
            search_volume: number;
            monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
          }>;
        }>;
      };

      for (const task of data.tasks ?? []) {
        for (const item of task.result ?? []) {
          volumeMap.set(item.keyword.toLowerCase(), {
            search_volume: item.search_volume ?? 0,
            monthly_searches: item.monthly_searches,
          });
        }
      }
    } catch {
      // continue with remaining chunks even if one fails
    }
  }

  // Build results and save to DB
  const results: VolumeResult[] = toFetch.map((prompt, i) => {
    const keyword = keywords[i];
    const found = volumeMap.get(keyword.toLowerCase());
    const volume = found?.search_volume ?? null;

    // Compute trend from last 3 months vs previous 3 months
    let trend: VolumeResult["trend"] = "unknown";
    if (found?.monthly_searches && found.monthly_searches.length >= 6) {
      const sorted = [...found.monthly_searches].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
      const recent = sorted.slice(-3).reduce((s, m) => s + m.search_volume, 0);
      const prev = sorted.slice(-6, -3).reduce((s, m) => s + m.search_volume, 0);
      if (prev === 0) trend = "unknown";
      else if (recent > prev * 1.1) trend = "rising";
      else if (recent < prev * 0.9) trend = "declining";
      else trend = "stable";
    }

    const volumeData = JSON.stringify({ volume, trend, keyword, fetchedAt: new Date().toISOString() });
    updatePromptVolume(sessionId, prompt.id, volumeData);

    return { id: prompt.id, promptText: prompt.promptText, volume, trend, keyword };
  });

  return NextResponse.json({ results });
}
