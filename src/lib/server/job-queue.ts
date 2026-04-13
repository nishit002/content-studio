/**
 * Server-side job queue — tracks all long-running operations so the browser
 * can poll for status and resume after a page refresh.
 *
 * Job types: single_article | aeo_scrape | sro | news_discover
 * Statuses:  running | done | error
 */

import { getDb } from "./db";
import { randomUUID } from "crypto";

export type JobType = "single_article" | "aeo_scrape" | "sro" | "news_discover";
export type JobStatus = "running" | "done" | "error";

export interface ServerJob {
  id: string;
  session_id: string;
  job_type: JobType;
  status: JobStatus;
  progress_json: string;
  error: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ServerJobWithProgress extends Omit<ServerJob, "progress_json"> {
  progress: Record<string, unknown>;
}

function parseJob(job: ServerJob): ServerJobWithProgress {
  let progress: Record<string, unknown> = {};
  try { progress = JSON.parse(job.progress_json); } catch { /* default */ }
  const { progress_json: _p, ...rest } = job;
  void _p;
  return { ...rest, progress };
}

/** Create a new job record (starts as 'running'). Returns the jobId. */
export function createJob(
  sessionId: string,
  type: JobType,
  initialProgress: Record<string, unknown> = {}
): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO server_jobs (id, session_id, job_type, status, progress_json)
       VALUES (?, ?, ?, 'running', ?)`
    )
    .run(id, sessionId, type, JSON.stringify(initialProgress));
  return id;
}

/** Create a queued job (status='queued') to be picked up by single-worker. Returns the jobId. */
export function createQueuedJob(
  sessionId: string,
  type: JobType,
  initialProgress: Record<string, unknown> = {}
): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO server_jobs (id, session_id, job_type, status, progress_json)
       VALUES (?, ?, ?, 'queued', ?)`
    )
    .run(id, sessionId, type, JSON.stringify(initialProgress));
  return id;
}

/** Write current progress so the browser poll can show it (replaces entire progress). */
export function updateProgress(jobId: string, progress: Record<string, unknown>): void {
  getDb()
    .prepare(
      `UPDATE server_jobs SET progress_json = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(JSON.stringify(progress), jobId);
}

/**
 * Append a log entry AND update stage/message in one atomic read-modify-write.
 * Keeps full history so the browser can display the complete event log.
 */
export function appendLog(
  jobId: string,
  entry: { stage: string; message: string; extra?: Record<string, unknown> }
): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT progress_json FROM server_jobs WHERE id = ?`)
    .get(jobId) as { progress_json: string } | undefined;
  let progress: Record<string, unknown> = {};
  if (row) {
    try { progress = JSON.parse(row.progress_json); } catch { /* use default */ }
  }
  const log = (progress.log as Array<{ stage: string; message: string; time: string }>) ?? [];
  log.push({ stage: entry.stage, message: entry.message, time: new Date().toISOString() });
  progress.stage = entry.stage;
  progress.message = entry.message;
  if (entry.extra) Object.assign(progress, entry.extra);
  progress.log = log;
  db
    .prepare(`UPDATE server_jobs SET progress_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(progress), jobId);
}

/** Mark job as done. */
export function finishJob(jobId: string): void {
  getDb()
    .prepare(
      `UPDATE server_jobs
       SET status = 'done', updated_at = datetime('now'), completed_at = datetime('now')
       WHERE id = ?`
    )
    .run(jobId);
}

/** Mark job as error. */
export function failJob(jobId: string, error: string): void {
  getDb()
    .prepare(
      `UPDATE server_jobs
       SET status = 'error', error = ?, updated_at = datetime('now'), completed_at = datetime('now')
       WHERE id = ?`
    )
    .run(error.slice(0, 500), jobId);
}

/** Get a single job (null if not found). */
export function getJob(jobId: string): ServerJobWithProgress | null {
  const row = getDb()
    .prepare(`SELECT * FROM server_jobs WHERE id = ?`)
    .get(jobId) as ServerJob | undefined;
  return row ? parseJob(row) : null;
}

/** Get all currently running jobs for a session (used to resume on page load). */
export function getActiveJobs(sessionId: string): ServerJobWithProgress[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM server_jobs
       WHERE session_id = ? AND status IN ('running', 'queued')
       ORDER BY created_at DESC`
    )
    .all(sessionId) as ServerJob[];
  return rows.map(parseJob);
}
