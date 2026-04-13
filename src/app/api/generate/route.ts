import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { runPipeline, runNewsPipeline, runAtlasPipeline } from "@/lib/server/pipeline";
import { createJob, createQueuedJob, appendLog, finishJob, failJob } from "@/lib/server/job-queue";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/generate — Queue a single article for server-side generation.
 *
 * Returns { jobId, contentId, serverJobId } immediately.
 * Browser polls GET /api/jobs?id=<serverJobId> every 3s for stage updates.
 * Results are always in DB — safe across page refreshes and browser switches.
 */
export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();
  const {
    topic,
    subKeywords,
    region,
    type: articleType,
    competitorUrl,
    customOutline,
    pipeline: pipelineChoice,
    writingStyle,
  } = body as {
    topic?: string;
    subKeywords?: string;
    region?: string;
    type?: string;
    competitorUrl?: string;
    customOutline?: string;
    pipeline?: string;
    writingStyle?: string;
  };

  if (!topic?.trim()) {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }

  const db = getDb();
  const jobId = uuidv4();
  const contentId = uuidv4();

  const isNews = articleType === "news";
  const isAtlas = pipelineChoice === "atlas";
  const jobType = isNews ? "news" : isAtlas ? "atlas" : "single";

  // Create legacy jobs + content rows (keeps history + library working)
  db.prepare(
    `INSERT INTO jobs (id, session_id, job_type, status, total_items, config_json, started_at, created_at)
     VALUES (?, ?, ?, 'running', 1, ?, datetime('now'), datetime('now'))`
  ).run(
    jobId,
    sessionId,
    jobType,
    JSON.stringify({ topic, subKeywords, region, type: articleType, competitorUrl, pipeline: pipelineChoice })
  );

  db.prepare(
    `INSERT INTO content (id, session_id, topic, content_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
  ).run(contentId, sessionId, topic.trim(), isNews ? "news" : "blog_post");

  // Create server_job so browser can poll for stage updates.
  // ATLAS articles are offloaded to single-worker (separate PM2 process) so they
  // never block on a long bulk run. Non-ATLAS (CG / news) still run in-process.
  const serverJobId = isAtlas
    ? createQueuedJob(sessionId, "single_article", {
        stage: "queued",
        message: "Queued — waiting for single-worker…",
        contentId,
        topic: topic.trim(),
        writingStyle: writingStyle ?? 'comprehensive',
      })
    : createJob(sessionId, "single_article", {
        stage: "queued",
        message: "Starting…",
        contentId,
        topic: topic.trim(),
      });

  // Fire-and-forget only for non-ATLAS pipelines (ATLAS handled by single-worker)
  if (!isAtlas) {
    runSingleArticleBackground(sessionId, serverJobId, jobId, contentId, topic.trim(), {
      subKeywords,
      region,
      articleType,
      customOutline,
      competitorUrl,
      isNews,
      isAtlas,
      pipelineChoice,
    }).catch((err) => {
      try { failJob(serverJobId, String(err)); } catch { /* db may be gone */ }
    });
  }

  return Response.json({ jobId, contentId, serverJobId });
}

/** Runs the pipeline in background; writes every stage to server_jobs for polling. */
async function runSingleArticleBackground(
  sessionId: string,
  serverJobId: string,
  jobId: string,
  contentId: string,
  topic: string,
  opts: {
    subKeywords?: string;
    region?: string;
    articleType?: string;
    customOutline?: string;
    competitorUrl?: string;
    isNews?: boolean;
    isAtlas?: boolean;
    pipelineChoice?: string;
  }
) {
  const db = getDb();
  let lastStage = "queued";

  try {
    const pipeline = opts.isNews
      ? runNewsPipeline(sessionId, topic, { competitorUrl: opts.competitorUrl, tags: opts.subKeywords })
      : opts.isAtlas
      ? runAtlasPipeline(sessionId, topic, { contentType: opts.articleType, force: false })
      : runPipeline(sessionId, topic, {
          subKeywords: opts.subKeywords,
          region: opts.region,
          articleType: opts.articleType,
          customOutline: opts.customOutline,
        });

    // Merge all "done" event details so articlePath + wordCount are both visible to the browser
    const accumulatedDetail: Record<string, unknown> = {};

    for await (const event of pipeline) {
      lastStage = event.stage;
      if (event.detail) Object.assign(accumulatedDetail, event.detail);

      // Append to log so browser poll sees full event history
      appendLog(serverJobId, {
        stage: event.stage,
        message: event.message ?? "",
        extra: { detail: Object.keys(accumulatedDetail).length > 0 ? { ...accumulatedDetail } : (event.detail ?? null), contentId, topic },
      });

      // Keep content + legacy jobs tables in sync
      if (event.stage === "outlining" || event.stage === "researching") {
        db.prepare(
          "UPDATE content SET status = 'outline_ready', updated_at = datetime('now') WHERE id = ?"
        ).run(contentId);
      } else if (event.stage === "writing") {
        db.prepare(
          "UPDATE content SET status = 'writing', updated_at = datetime('now') WHERE id = ?"
        ).run(contentId);
      } else if (event.stage === "done" && event.detail) {
        const d = event.detail;
        db.prepare(
          `UPDATE content SET status = 'done', word_count = ?, table_count = ?, quality_score = ?,
           updated_at = datetime('now') WHERE id = ?`
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

    // Pipeline ended without explicit done/error — treat as done
    if (lastStage !== "done" && lastStage !== "error") {
      db.prepare(
        "UPDATE content SET status = 'done', updated_at = datetime('now') WHERE id = ?"
      ).run(contentId);
      db.prepare(
        `UPDATE jobs SET status = 'done', completed_items = 1, completed_at = datetime('now') WHERE id = ?`
      ).run(jobId);
    }

    finishJob(serverJobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      db.prepare(
        "UPDATE content SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(msg, contentId);
      db.prepare(
        `UPDATE jobs SET status = 'error', failed_items = 1, completed_at = datetime('now') WHERE id = ?`
      ).run(jobId);
    } catch { /* ignore secondary errors */ }
    failJob(serverJobId, msg);
  }
}

/**
 * GET /api/generate?jobId=... — Check legacy job status (kept for backwards compat).
 */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return Response.json({ error: "jobId required" }, { status: 400 });
  }

  const db = getDb();
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND session_id = ?")
    .get(jobId, sessionId);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json(job);
}
