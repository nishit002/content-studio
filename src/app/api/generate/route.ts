import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { runPipeline, runNewsPipeline, type PipelineEvent } from "@/lib/server/pipeline";

// Allow up to 5 minutes for article generation (default is 60s on Vercel)
export const maxDuration = 300;

/**
 * POST /api/generate — Start article generation via SSE.
 *
 * Body: { topic: string, subKeywords?: string, region?: string, type?: "article"|"news", competitorUrl?: string }
 * Response: text/event-stream with PipelineEvent JSON per line.
 */
export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();
  const { topic, subKeywords, region, type: articleType, competitorUrl, customOutline } = body as {
    topic?: string;
    subKeywords?: string;
    region?: string;
    type?: string;
    competitorUrl?: string;
    customOutline?: string;
  };

  if (!topic?.trim()) {
    return new Response(JSON.stringify({ error: "topic is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create a job + content row in DB
  const db = getDb();
  const jobId = uuidv4();
  const contentId = uuidv4();

  const isNews = articleType === "news";

  db.prepare(
    `INSERT INTO jobs (id, session_id, job_type, status, total_items, config_json, started_at, created_at)
     VALUES (?, ?, ?, 'running', 1, ?, datetime('now'), datetime('now'))`
  ).run(jobId, sessionId, isNews ? "news" : "single", JSON.stringify({ topic, subKeywords, region, type: articleType, competitorUrl }));

  db.prepare(
    `INSERT INTO content (id, session_id, topic, content_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
  ).run(contentId, sessionId, topic.trim(), isNews ? "news" : "blog_post");

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: PipelineEvent & { jobId?: string; contentId?: string }) {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      // Send initial event with IDs
      send({
        stage: "queued",
        message: "Job created",
        jobId,
        contentId,
        timestamp: Date.now(),
      });

      let lastStage = "queued";

      try {
        const pipeline = isNews
          ? runNewsPipeline(sessionId, topic.trim(), { competitorUrl, tags: subKeywords })
          : runPipeline(sessionId, topic.trim(), { subKeywords, region, articleType, customOutline });

        for await (const event of pipeline) {
          send({ ...event, jobId, contentId });
          lastStage = event.stage;

          // Update content status as stages progress
          if (event.stage === "outlining" || event.stage === "researching") {
            db.prepare(
              "UPDATE content SET status = ?, updated_at = datetime('now') WHERE id = ?"
            ).run("outline_ready", contentId);
          } else if (event.stage === "writing") {
            db.prepare(
              "UPDATE content SET status = 'writing', updated_at = datetime('now') WHERE id = ?"
            ).run(contentId);
          } else if (event.stage === "done" && event.detail) {
            const d = event.detail;
            db.prepare(
              `UPDATE content SET
                status = 'done',
                word_count = ?,
                table_count = ?,
                quality_score = ?,
                updated_at = datetime('now')
              WHERE id = ?`
            ).run(
              (d.wordCount as number) || 0,
              (d.tableCount as number) || 0,
              (d.qualityScore as number) || 0,
              contentId
            );
            db.prepare(
              `UPDATE jobs SET status = 'done', completed_items = 1, completed_at = datetime('now') WHERE id = ?`
            ).run(jobId);
          } else if (event.stage === "error") {
            db.prepare(
              "UPDATE content SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?"
            ).run(event.message, contentId);
            db.prepare(
              `UPDATE jobs SET status = 'error', failed_items = 1, completed_at = datetime('now') WHERE id = ?`
            ).run(jobId);
          }
        }

        // If we never got a "done" or "error" event, mark as done anyway
        if (lastStage !== "done" && lastStage !== "error") {
          db.prepare(
            "UPDATE content SET status = 'done', updated_at = datetime('now') WHERE id = ?"
          ).run(contentId);
          db.prepare(
            `UPDATE jobs SET status = 'done', completed_items = 1, completed_at = datetime('now') WHERE id = ?`
          ).run(jobId);
          send({ stage: "done", message: "Pipeline completed", jobId, contentId, timestamp: Date.now() });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        db.prepare(
          "UPDATE content SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(msg, contentId);
        db.prepare(
          `UPDATE jobs SET status = 'error', failed_items = 1, completed_at = datetime('now') WHERE id = ?`
        ).run(jobId);
        send({ stage: "error", message: msg, jobId, contentId, timestamp: Date.now() });
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
      "X-Job-Id": jobId,
      "X-Content-Id": contentId,
    },
  });
}

/**
 * GET /api/generate?jobId=... — Check job status (polling fallback).
 */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return new Response(JSON.stringify({ error: "jobId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = getDb();
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND session_id = ?")
    .get(jobId, sessionId);

  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(job), {
    headers: { "Content-Type": "application/json" },
  });
}
