/**
 * GET /api/generate/history
 * Returns the last N single_article server_jobs for this session,
 * newest first. Used by the Single Article UI to show recent articles.
 */
import { NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";

interface HistoryItem {
  id: string;
  status: string;
  error: string;
  topic: string;
  wordCount: number;
  qualityGrade: string;
  qualityScore: number;
  articlePath: string;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  elapsedMs: number;
}

export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "30", 10);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, status, error, progress_json, created_at, updated_at
       FROM server_jobs
       WHERE session_id = ? AND job_type = 'single_article'
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(sessionId, Math.min(limit, 100)) as Array<{
      id: string;
      status: string;
      error: string;
      progress_json: string;
      created_at: string;
      updated_at: string;
    }>;

  const items: HistoryItem[] = rows.map((r) => {
    let progress: Record<string, unknown> = {};
    try { progress = JSON.parse(r.progress_json); } catch { /* default */ }

    const detail = (progress.detail ?? {}) as Record<string, unknown>;
    const startedAt = progress.startedAt as string | undefined;
    const createdAt = r.created_at;

    // Compute elapsed: from startedAt (or created_at) to updated_at
    const startMs  = startedAt ? new Date(startedAt).getTime() : new Date(createdAt).getTime();
    const endMs    = new Date(r.updated_at).getTime();
    const elapsedMs = Math.max(0, endMs - startMs);

    return {
      id: r.id,
      status: r.status,
      error: r.error,
      topic: (progress.topic as string) || "",
      wordCount:    (detail.wordCount    as number) || 0,
      qualityGrade: (detail.qualityGrade as string) || "",
      qualityScore: (detail.qualityScore as number) || 0,
      articlePath:  (detail.articlePath  as string) || "",
      startedAt:    startedAt || createdAt,
      createdAt,
      updatedAt: r.updated_at,
      elapsedMs,
    };
  });

  return Response.json(items);
}
