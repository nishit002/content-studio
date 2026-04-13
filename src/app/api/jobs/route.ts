/**
 * GET /api/jobs?id=<jobId>      — poll a specific job's status + progress
 * GET /api/jobs?active=1        — list all running jobs for this session
 *
 * Used by every feature tab to show in-progress state after a page refresh.
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { getJob, getActiveJobs } from "@/lib/server/job-queue";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const active = searchParams.get("active");

  if (id) {
    const job = getJob(id);
    if (!job || job.session_id !== sessionId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(job);
  }

  if (active) {
    const jobs = getActiveJobs(sessionId);
    return Response.json({ jobs });
  }

  return Response.json({ error: "Provide ?id=<jobId> or ?active=1" }, { status: 400 });
}
