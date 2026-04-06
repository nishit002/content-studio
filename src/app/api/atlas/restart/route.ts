import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { spawn } from "child_process";
import path from "path";

const ATLAS_DIR = process.env.ATLAS_DIR || path.resolve("/Volumes/NISHIT_PD/content-studio/smart-writer");
const PYTHON_BIN = process.env.PYTHON_BIN || "/usr/bin/python3";

/**
 * POST /api/atlas/restart
 * Body: { topic, contentType }
 *
 * Spawns atlas.py detached in the background. Returns immediately.
 * atlas.py auto-resumes an existing failed run for the same topic.
 */
export async function POST(req: NextRequest) {
  await getSession();
  const { topic, contentType } = await req.json() as { topic: string; contentType?: string };

  if (!topic?.trim()) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const args = ["atlas.py", topic.trim(), "--use-you-research"];
  if (contentType) args.push("--type", contentType);

  const child = spawn(PYTHON_BIN, args, {
    cwd: ATLAS_DIR,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PYTHONPATH: ATLAS_DIR },
  });
  child.unref(); // fire-and-forget

  return NextResponse.json({ ok: true, topic: topic.trim() });
}
