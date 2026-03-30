import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getStats } from "@/lib/server/db";

export async function GET() {
  const sessionId = await getSession();
  const stats = getStats(sessionId);
  return NextResponse.json(stats);
}
