import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getConfig, setConfigBatch } from "@/lib/server/db";

export async function GET() {
  const sessionId = await getSession();
  const config = getConfig(sessionId);
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Only allow string values
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    entries[key] = String(value);
  }

  setConfigBatch(sessionId, entries);
  const updated = getConfig(sessionId);
  return NextResponse.json(updated);
}
