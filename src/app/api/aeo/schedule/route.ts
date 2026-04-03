import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import {
  getAeoSchedule,
  setAeoSchedule,
  getAeoDriftAlerts,
  dismissAeoDriftAlert,
} from "@/lib/server/db";

export async function GET() {
  const sessionId = await getSession();
  const schedule = getAeoSchedule(sessionId);
  const alerts = getAeoDriftAlerts(sessionId);
  return NextResponse.json({ schedule, alerts });
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json() as { action?: "dismiss"; alertId?: string; enabled?: boolean; intervalMs?: number };

  if (body.action === "dismiss") {
    if (!body.alertId) return NextResponse.json({ error: "alertId required" }, { status: 400 });
    dismissAeoDriftAlert(sessionId, body.alertId);
    return NextResponse.json({ ok: true });
  }

  const current = getAeoSchedule(sessionId);
  setAeoSchedule(sessionId, {
    enabled: body.enabled ?? current.enabled,
    intervalMs: body.intervalMs ?? current.intervalMs,
    lastRunAt: current.lastRunAt,
  });
  return NextResponse.json({ ok: true });
}
