import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getAeoRuns, deleteAeoRun, clearAeoRuns } from "@/lib/server/db";

export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "200");
  return NextResponse.json(getAeoRuns(sessionId, limit));
}

export async function DELETE(req: NextRequest) {
  const sessionId = await getSession();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id === "all") { clearAeoRuns(sessionId); return NextResponse.json({ ok: true }); }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteAeoRun(sessionId, id);
  return NextResponse.json({ ok: true });
}
