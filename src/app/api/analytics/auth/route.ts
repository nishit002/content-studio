import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import {
  getAnalyticsConnection,
  getAllAnalyticsConnections,
  setAnalyticsProperty,
  deleteAnalyticsConnection,
  upsertAnalyticsConnection,
} from "@/lib/server/db";
import { autoSetupConnections, getValidToken } from "@/lib/server/analytics-auth";

/* ── OAuth Configuration ── */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const BING_CLIENT_ID = process.env.BING_CLIENT_ID ?? "";
const BING_CLIENT_SECRET = process.env.BING_CLIENT_SECRET ?? "";

function getBaseUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

const GOOGLE_SCOPES: Record<string, string> = {
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
};

/* ── GET: Start OAuth flow OR list connections ── */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const provider = req.nextUrl.searchParams.get("provider");
  const action = req.nextUrl.searchParams.get("action");

  // Auto-setup from env vars (service account + API keys)
  if (action === "auto-setup") {
    const setupResults = await autoSetupConnections(sessionId);
    return NextResponse.json({ setup: setupResults });
  }

  // List all connections (auto-setup first if needed)
  if (action === "list") {
    await autoSetupConnections(sessionId);
    const connections = getAllAnalyticsConnections(sessionId);
    return NextResponse.json(
      connections.map((c) => ({
        provider: c.provider,
        property_id: c.property_id,
        property_name: c.property_name,
        email: c.email,
        connected: !!c.access_token,
        connected_at: c.connected_at,
      }))
    );
  }

  // List available properties for a connected provider
  if (action === "properties" && provider) {
    const conn = getAnalyticsConnection(sessionId, provider);
    if (!conn?.access_token) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }

    const token = await getValidToken(sessionId, provider);
    if (!token) return NextResponse.json({ error: "Token refresh failed" }, { status: 401 });

    if (provider === "ga4") {
      const properties = await fetchGA4Properties(token);
      return NextResponse.json(properties);
    }
    if (provider === "gsc") {
      const sites = await fetchGSCSites(token);
      return NextResponse.json(sites);
    }
    if (provider === "bing") {
      const sites = await fetchBingSites(token);
      return NextResponse.json(sites);
    }

    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // Start OAuth flow — redirect user to provider
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 });

  const baseUrl = getBaseUrl(req);
  const callbackUrl = `${baseUrl}/api/analytics/callback`;
  const state = `${sessionId}:${provider}`;

  if (provider === "ga4" || provider === "gsc") {
    if (!GOOGLE_CLIENT_ID) {
      return NextResponse.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 500 });
    }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: `${GOOGLE_SCOPES[provider]} https://www.googleapis.com/auth/userinfo.email`,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return NextResponse.json({
      redirect_url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    });
  }

  if (provider === "bing") {
    if (!BING_CLIENT_ID) {
      return NextResponse.json({ error: "BING_CLIENT_ID not configured" }, { status: 500 });
    }
    const params = new URLSearchParams({
      client_id: BING_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "https://api.bing.com/.default offline_access",
      state,
    });
    return NextResponse.json({
      redirect_url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
    });
  }

  return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
}

/* ── POST: Save selected property ── */
export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const { provider, property_id, property_name } = await req.json();

  if (!provider || !property_id) {
    return NextResponse.json({ error: "provider and property_id required" }, { status: 400 });
  }

  const conn = getAnalyticsConnection(sessionId, provider);
  if (!conn?.access_token) {
    return NextResponse.json({ error: "Not connected" }, { status: 400 });
  }

  setAnalyticsProperty(sessionId, provider, property_id, property_name || property_id);
  return NextResponse.json({ ok: true });
}

/* ── DELETE: Disconnect a provider ── */
export async function DELETE(req: NextRequest) {
  const sessionId = await getSession();
  const provider = req.nextUrl.searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 });

  deleteAnalyticsConnection(sessionId, provider);
  return NextResponse.json({ ok: true });
}

/* ── GA4: List properties ── */
async function fetchGA4Properties(token: string) {
  const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const properties: { id: string; name: string; account: string }[] = [];
  for (const account of data.accountSummaries ?? []) {
    for (const prop of account.propertySummaries ?? []) {
      properties.push({
        id: prop.property.replace("properties/", ""),
        name: prop.displayName,
        account: account.displayName,
      });
    }
  }
  return properties;
}

/* ── GSC: List sites ── */
async function fetchGSCSites(token: string) {
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.siteEntry ?? []).map((s: { siteUrl: string; permissionLevel: string }) => ({
    id: s.siteUrl,
    name: s.siteUrl,
    permission: s.permissionLevel,
  }));
}

/* ── Bing: List sites ── */
async function fetchBingSites(token: string) {
  const res = await fetch("https://ssl.bing.com/webmaster/api.svc/json/GetUserSites", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.d ?? []).map((s: { Url: string }) => ({
    id: s.Url,
    name: s.Url,
  }));
}
