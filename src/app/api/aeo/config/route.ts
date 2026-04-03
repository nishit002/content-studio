import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getAeoBrandConfig, setAeoBrandConfig } from "@/lib/server/db";

export async function GET() {
  const sessionId = await getSession();
  return NextResponse.json(getAeoBrandConfig(sessionId));
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();
  setAeoBrandConfig(sessionId, {
    brandName: body.brandName ?? "",
    aliases: body.aliases ?? "",
    website: body.website ?? "",
    industry: body.industry ?? "",
    keywords: body.keywords ?? "",
    description: body.description ?? "",
    competitors: body.competitors ?? "",
  });
  return NextResponse.json({ ok: true });
}
