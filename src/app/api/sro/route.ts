/**
 * POST /api/sro — SSE streaming SRO analysis pipeline
 * Stages: grounding → serp → scraping → context → analyzing → done
 *
 * Client receives SSE events: { stage, data?, error? }
 * Final event stage="done" contains full SROResult in data.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
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

const bodySchema = z.object({
  url: z.string().url(),
  keyword: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const sessionId = await getSession();

  let url: string;
  let keyword: string;

  try {
    const body = bodySchema.parse(await req.json());
    url = body.url;
    keyword = body.keyword;
  } catch {
    return new Response(JSON.stringify({ error: "url and keyword are required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const auditId = uuidv4();

  const stream = new ReadableStream({
    async start(controller) {
      function send(stage: string, data?: unknown, error?: string) {
        const payload = JSON.stringify({ stage, data, error });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }

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
        send("grounding");
        try {
          result.grounding = await analyzeGrounding(keyword, url);
        } catch (err) {
          send("grounding_warn", null, err instanceof Error ? err.message : String(err));
        }

        // Stage 2: SERP
        send("serp");
        result.serp = await fetchSerp(keyword, url);

        // Stage 3: Scraping — target page + top 3 competitors
        send("scraping");
        const competitorUrls = result.serp?.topCompetitors.slice(0, 3) ?? [];
        const [targetPage, competitorPages] = await Promise.all([
          scrapePage(url),
          scrapePages(competitorUrls),
        ]);
        result.targetPage = targetPage;
        result.competitorPages = competitorPages;

        // Stage 4: Site Context
        send("context");
        result.siteContext = await extractSiteContext(url);

        // Stage 5: LLM SRO Analysis
        send("analyzing");
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

        send("done", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.stage = "error";
        result.error = message;
        send("error", null, message);
      } finally {
        controller.close();
      }
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
