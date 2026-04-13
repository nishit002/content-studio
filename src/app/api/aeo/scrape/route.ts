/**
 * POST /api/aeo/scrape — Queue AEO visibility scan (fire-and-forget).
 *
 * Returns { serverJobId, total } immediately.
 * Browser polls GET /api/jobs?id=<serverJobId> every 3s.
 * Each result is saved to aeo_runs as it completes — safe across refreshes.
 */

import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import { getAeoBrandConfig, getAeoPrompts, getAeoRuns, saveAeoRun } from "@/lib/server/db";
import {
  runAiScraper,
  computeVisibilityScore,
  type AeoProvider,
  PROVIDER_LABELS,
} from "@/lib/server/brightdata-scraper";
import { createJob, updateProgress, finishJob, failJob } from "@/lib/server/job-queue";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALL_PROVIDERS: AeoProvider[] = [
  "chatgpt", "perplexity", "copilot", "gemini", "google_ai", "grok",
];

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json() as { providers?: AeoProvider[]; promptIds?: string[] };

  const providers: AeoProvider[] = body.providers?.length ? body.providers : ALL_PROVIDERS;
  const allPrompts = getAeoPrompts(sessionId);
  const prompts = body.promptIds?.length
    ? allPrompts.filter((p) => body.promptIds!.includes(p.id))
    : allPrompts;

  if (!prompts.length) {
    return Response.json(
      { error: "No prompts configured. Add prompts in Prompt Hub first." },
      { status: 400 }
    );
  }

  const total = providers.length * prompts.length;

  // Create server_job immediately — browser gets jobId and starts polling
  const serverJobId = createJob(sessionId, "aeo_scrape", {
    done: 0,
    total,
    log: [],
  });

  // Fire-and-forget — runs in background after response is sent
  runAeoBackground(sessionId, serverJobId, providers, prompts, total).catch((err) => {
    try { failJob(serverJobId, String(err)); } catch { /* ignore */ }
  });

  return Response.json({ serverJobId, total });
}

async function runAeoBackground(
  sessionId: string,
  serverJobId: string,
  providers: AeoProvider[],
  prompts: Array<{ id: string; promptText: string }>,
  total: number
) {
  const brandConfig = getAeoBrandConfig(sessionId);
  const brandTerms = [brandConfig.brandName, ...brandConfig.aliases.split(",")]
    .map((s) => s.trim())
    .filter(Boolean);

  // Previous scores for drift detection
  const prevRuns = getAeoRuns(sessionId, 500);
  const prevScoreMap = new Map<string, number>();
  for (const r of prevRuns) {
    const key = `${r.promptText}__${r.provider}`;
    if (!prevScoreMap.has(key)) prevScoreMap.set(key, r.visibilityScore);
  }

  let done = 0;
  const log: string[] = [];

  for (const prompt of prompts) {
    const tasks = providers.map(async (provider) => {
      const label = PROVIDER_LABELS[provider] ?? provider;
      try {
        const result = await runAiScraper(provider, prompt.promptText);
        const { score, sentiment, brandMentioned, competitorsMentioned } =
          computeVisibilityScore(result.answer, brandTerms, result.sources);

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

        done++;
        log.push(`✓ ${label} — score ${score}`);
      } catch (err) {
        done++;
        log.push(`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Update progress after every individual result
      updateProgress(serverJobId, { done, total, log: log.slice(-30) });
    });

    await Promise.allSettled(tasks);
  }

  finishJob(serverJobId);
}
