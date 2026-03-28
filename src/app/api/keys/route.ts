import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getApiKeys, upsertApiKey, deleteApiKey, updateApiKeyStatus } from "@/lib/server/db";

export async function GET() {
  const sessionId = await getSession();
  const keys = getApiKeys(sessionId);

  // Mask key values for security (show first 8 + last 4 chars)
  const masked = keys.map((k) => ({
    ...k,
    key_value: maskKey(k.key_value),
    key_hash: hashKey(k.key_value), // for identifying which key to delete
  }));

  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const { provider, key_value, label } = await req.json();

  if (!provider || !key_value) {
    return NextResponse.json({ error: "provider and key_value required" }, { status: 400 });
  }

  upsertApiKey(sessionId, provider, key_value, label || "");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sessionId = await getSession();
  const { provider, key_value } = await req.json();

  if (!provider || !key_value) {
    return NextResponse.json({ error: "provider and key_value required" }, { status: 400 });
  }

  deleteApiKey(sessionId, provider, key_value);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const sessionId = await getSession();
  const { provider, key_value, status } = await req.json();

  if (!provider || !key_value || !status) {
    return NextResponse.json({ error: "provider, key_value, and status required" }, { status: 400 });
  }

  updateApiKeyStatus(sessionId, provider, key_value, status);
  return NextResponse.json({ ok: true });
}

function maskKey(key: string): string {
  if (key.length <= 12) return "****" + key.slice(-4);
  return key.slice(0, 8) + "..." + key.slice(-4);
}

function hashKey(key: string): string {
  // Simple hash for client-side identification (NOT cryptographic)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}
