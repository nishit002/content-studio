import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import { getAeoBrandConfig, getAeoPrompts, getAeoRuns, saveAeoRun } from "@/lib/server/db";
import { runAiScraper, computeVisibilityScore, type AeoProvider, PROVIDER_LABELS } from "@/lib/server/brightdata-scraper";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALL_PROVIDERS: AeoProvider[] = ["chatgpt", "perplexity", "copilot", "gemini", "google_ai", "grok"];

function sse(controller: ReadableStreamDefaultController, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json() as { providers?: AeoProvider[]; promptIds?: string[] };
  const providers: AeoProvider[] = (body.providers?.length ? body.providers : ALL_PROVIDERS);
  const allPrompts = getAeoPrompts(sessionId);
  const prompts = body.promptIds?.length
    ? allPrompts.filter(p => body.promptIds!.includes(p.id))
    : allPrompts;

  if (!prompts.length) {
    return new Response(JSON.stringify({ error: "No prompts configured. Add prompts in Prompt Hub first." }), { status: 400 });
  }

  const brandConfig = getAeoBrandConfig(sessionId);
  const brandTerms = [brandConfig.brandName, ...brandConfig.aliases.split(",")].map(s => s.trim()).filter(Boolean);

  // Fetch previous run scores per (prompt, provider) for drift detection
  const prevRuns = getAeoRuns(sessionId, 500);
  const prevScoreMap = new Map<string, number>();
  for (const r of prevRuns) {
    const key = `${r.promptText}__${r.provider}`;
    if (!prevScoreMap.has(key)) prevScoreMap.set(key, r.visibilityScore);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const total = providers.length * prompts.length;
      let done = 0;

      sse(controller, { type: "start", total });

      // Run all combos — parallel per provider, serial per prompt to avoid rate limits
      for (const prompt of prompts) {
        const tasks = providers.map(async (provider) => {
          try {
            sse(controller, { type: "progress", provider, providerLabel: PROVIDER_LABELS[provider], promptText: prompt.promptText, status: "running" });

            const result = await runAiScraper(provider, prompt.promptText);
            const { score, sentiment, brandMentioned, competitorsMentioned } = computeVisibilityScore(result.answer, brandTerms, result.sources);

            const run = {
              id: uuidv4(),
              provider,
              promptText: prompt.promptText,
              answer: result.answer,
              sources: result.sources,
              visibilityScore: score,
              sentiment,
              brandMentioned,
              competitors: competitorsMentioned,
              snapshotId: result.snapshotId,
              accuracyFlags: "",
              createdAt: result.createdAt,
            };
            saveAeoRun(sessionId, run);

            // Drift detection
            const prevKey = `${prompt.promptText}__${provider}`;
            const prevScore = prevScoreMap.get(prevKey);
            const drift = prevScore !== undefined ? score - prevScore : null;

            done++;
            sse(controller, { type: "result", done, total, run, drift });
          } catch (err) {
            done++;
            sse(controller, {
              type: "error", done, total,
              provider, providerLabel: PROVIDER_LABELS[provider],
              promptText: prompt.promptText,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });

        await Promise.allSettled(tasks);
      }

      sse(controller, { type: "done", total: done });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
