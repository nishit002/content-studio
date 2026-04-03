import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import { getAeoPrompts, addAeoPrompt, deleteAeoPrompt } from "@/lib/server/db";

export async function GET() {
  const sessionId = await getSession();
  return NextResponse.json(getAeoPrompts(sessionId));
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const { promptText } = await req.json();
  if (!promptText?.trim()) return NextResponse.json({ error: "promptText required" }, { status: 400 });
  const id = uuidv4();
  addAeoPrompt(sessionId, id, promptText.trim());
  return NextResponse.json({ id, promptText: promptText.trim() });
}

export async function DELETE(req: NextRequest) {
  const sessionId = await getSession();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteAeoPrompt(sessionId, id);
  return NextResponse.json({ ok: true });
}
