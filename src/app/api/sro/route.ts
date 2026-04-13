/**
 * POST /api/sro — Queue SRO analysis (fire-and-forget).
 *
 * Returns { serverJobId } immediately.
 * Browser polls GET /api/jobs?id=<serverJobId> every 3s for stage + result.
 * Final SROResult saved to server_jobs.progress_json so it survives page refresh.
 */

import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { getSession } from "@/lib/server/session";
import { saveAudit } from "@/lib/server/db";
import {
  analyzeGrounding,
  fetchSerp,
  scrapePage,
  scrapePages,
  extractSiteContext,
  analyzeSRO,
} from "@/lib/server/sro-pipeline";
import type { SROResult } from "@/lib/server/sro-types";
import { createJob, updateProgress, finishJob, failJob } from "@/lib/server/job-queue";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  url: z.string().url(),
  keyword: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const sessionId = await getSession();

  let url: string;
  let keyword: string;

  try {
    const parsed = bodySchema.parse(await req.json());
    url = parsed.url;
    keyword = parsed.keyword;
  } catch {
    return Response.json({ error: "url and keyword are required" }, { status: 400 });
  }

  const auditId = uuidv4();

  // Create server_job — browser polls this for stage updates and final result
  const serverJobId = createJob(sessionId, "sro", {
    stage: "grounding",
    url,
    keyword,
    result: null,
  });

  // Fire-and-forget
  runSroBackground(sessionId, serverJobId, auditId, url, keyword).catch((err) => {
    try { failJob(serverJobId, String(err)); } catch { /* ignore */ }
  });

  return Response.json({ serverJobId, auditId });
}

async function runSroBackground(
  sessionId: string,
  serverJobId: string,
  auditId: string,
  url: string,
  keyword: string
) {
  const result: SROResult = {
    targetUrl: url,
    keyword,
    stage: "grounding",
    grounding: null,
    serp: null,
    targetPage: null,
    competitorPages: [],
    siteContext: null,
    llmAnalysis: null,
  };

  try {
    // Stage 1: Gemini Grounding
    updateProgress(serverJobId, { stage: "grounding", url, keyword, result: null });
    try {
      result.grounding = await analyzeGrounding(keyword, url);
    } catch (err) {
      // Non-fatal — continue without grounding
      void err;
    }

    // Stage 2: SERP
    updateProgress(serverJobId, { stage: "serp", url, keyword, result: null });
    result.serp = await fetchSerp(keyword, url);

    // Stage 3: Scraping
    updateProgress(serverJobId, { stage: "scraping", url, keyword, result: null });
    const competitorUrls = result.serp?.topCompetitors.slice(0, 3) ?? [];
    const [targetPage, competitorPages] = await Promise.all([
      scrapePage(url),
      scrapePages(competitorUrls),
    ]);
    result.targetPage = targetPage;
    result.competitorPages = competitorPages;

    // Stage 4: Site Context
    updateProgress(serverJobId, { stage: "context", url, keyword, result: null });
    result.siteContext = await extractSiteContext(url);

    // Stage 5: LLM Analysis
    updateProgress(serverJobId, { stage: "analyzing", url, keyword, result: null });
    result.llmAnalysis = await analyzeSRO({
      targetUrl: url,
      keyword,
      grounding: result.grounding,
      platforms: [],
      serp: result.serp,
      targetPage: result.targetPage,
      competitorPages: result.competitorPages,
      siteContext: result.siteContext,
    });

    // Save to DB
    result.stage = "done";
    result.completedAt = new Date().toISOString();
    const score = result.llmAnalysis?.overallScore ?? 0;
    saveAudit(sessionId, auditId, "sro", url, keyword, score, result);

    // Write final result to progress_json so browser can retrieve it from the poll
    updateProgress(serverJobId, { stage: "done", url, keyword, result });
    finishJob(serverJobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.stage = "error";
    result.error = message;
    updateProgress(serverJobId, { stage: "error", url, keyword, result: null, error: message });
    failJob(serverJobId, message);
  }
}
