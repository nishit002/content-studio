import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getApiKeys, upsertApiKey, deleteApiKey, updateApiKeyStatus } from "@/lib/server/db";

export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const keys = getApiKeys(sessionId);
  const raw = req.nextUrl.searchParams.get("raw") === "true";

  const result = keys.map((k) => ({
    ...k,
    key_value: raw ? k.key_value : maskKey(k.provider, k.key_value),
  }));

  return NextResponse.json(result);
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

export async function PUT(req: NextRequest) {
  const sessionId = await getSession();
  const { provider, old_key_value, new_key_value, label } = await req.json();

  if (!provider || !old_key_value || !new_key_value) {
    return NextResponse.json({ error: "provider, old_key_value, and new_key_value required" }, { status: 400 });
  }

  // Delete old, insert new
  deleteApiKey(sessionId, provider, old_key_value);
  upsertApiKey(sessionId, provider, new_key_value, label ?? "");
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

/** Mask key values for display — multi-field providers mask each part separately */
function maskKey(provider: string, key: string): string {
  // Multi-field providers: mask each pipe-separated part
  const multiFieldProviders = ["wordpress", "supabase", "google_ads", "dataforseo"];
  if (multiFieldProviders.includes(provider) && key.includes("|")) {
    return key.split("|").map((part) => maskPart(part)).join("|");
  }
  return maskPart(key);
}

function maskPart(part: string): string {
  if (!part) return "";
  if (part.length <= 8) return "••••" + part.slice(-2);
  return part.slice(0, 6) + "••••" + part.slice(-4);
}
