import crypto from "crypto";
import {
  getAnalyticsConnection,
  upsertAnalyticsConnection,
  setAnalyticsProperty,
} from "./db";

/* ══════════════════════════════════════════════════════════
   Service Account Configuration (from env vars)
   ══════════════════════════════════════════════════════════ */
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
// Handle all possible \n formats: literal \\n, already real \n, or JSON-escaped
const SA_KEY_RAW = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "";
const SA_KEY = SA_KEY_RAW.replace(/\\n/g, "\n").replace(/"/g, "");
const GA4_PROPERTY = process.env.GA4_PROPERTY_ID ?? "";
const GSC_PROPERTY = process.env.GSC_PROPERTY ?? "";
const BING_API_KEY_ENV = process.env.BING_API_KEY ?? "";
const BING_SITE_URL = process.env.BING_SITE_URL ?? "";

/* OAuth fallback */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

const SCOPES: Record<string, string> = {
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
};

/* ── Check if service account is configured ── */
export function hasServiceAccount(): boolean {
  return !!(SA_EMAIL && SA_KEY);
}

export function hasGA4Property(): boolean {
  return !!GA4_PROPERTY;
}

export function hasGSCProperty(): boolean {
  return !!GSC_PROPERTY;
}

export function hasBingApiKey(): boolean {
  return !!BING_API_KEY_ENV;
}

/* ══════════════════════════════════════════════════════════
   Auto-setup: Create connections from env vars
   ══════════════════════════════════════════════════════════ */
export async function autoSetupConnections(sessionId: string) {
  const results: string[] = [];

  // GA4 via service account
  if (hasServiceAccount() && hasGA4Property()) {
    const existing = getAnalyticsConnection(sessionId, "ga4");
    if (!existing?.property_id) {
      const token = await getServiceAccountToken("ga4");
      if (token) {
        upsertAnalyticsConnection(sessionId, "ga4", {
          access_token: token.access_token,
          refresh_token: "__service_account__",
          token_expires_at: token.expires_at,
          email: SA_EMAIL,
        });
        setAnalyticsProperty(sessionId, "ga4", GA4_PROPERTY, `GA4 Property ${GA4_PROPERTY}`);
        results.push("ga4");
      }
    }
  }

  // GSC via service account
  if (hasServiceAccount() && hasGSCProperty()) {
    const existing = getAnalyticsConnection(sessionId, "gsc");
    if (!existing?.property_id) {
      const token = await getServiceAccountToken("gsc");
      if (token) {
        upsertAnalyticsConnection(sessionId, "gsc", {
          access_token: token.access_token,
          refresh_token: "__service_account__",
          token_expires_at: token.expires_at,
          email: SA_EMAIL,
        });
        setAnalyticsProperty(sessionId, "gsc", GSC_PROPERTY, GSC_PROPERTY);
        results.push("gsc");
      }
    }
  }

  // Bing via API key
  if (hasBingApiKey() && BING_SITE_URL) {
    const existing = getAnalyticsConnection(sessionId, "bing");
    if (!existing?.property_id) {
      upsertAnalyticsConnection(sessionId, "bing", {
        access_token: BING_API_KEY_ENV,
        refresh_token: "__api_key__",
        token_expires_at: "2099-01-01T00:00:00",
        email: "",
      });
      setAnalyticsProperty(sessionId, "bing", BING_SITE_URL, BING_SITE_URL);
      results.push("bing");
    }
  }

  return results;
}

/* ══════════════════════════════════════════════════════════
   Get valid token for a provider (service account or OAuth)
   ══════════════════════════════════════════════════════════ */
export async function getValidToken(sessionId: string, provider: string): Promise<string | null> {
  const conn = getAnalyticsConnection(sessionId, provider);
  if (!conn?.access_token) return null;

  // Bing with API key — never expires
  if (provider === "bing" && conn.refresh_token === "__api_key__") {
    return conn.access_token;
  }

  // Check if token is still valid (5 min buffer)
  const expiresAt = new Date(conn.token_expires_at + "Z").getTime();
  if (Date.now() < expiresAt - 300000) {
    return conn.access_token;
  }

  // Service account — generate new JWT token
  if (conn.refresh_token === "__service_account__") {
    const token = await getServiceAccountToken(provider);
    if (!token) return null;
    upsertAnalyticsConnection(sessionId, provider, {
      access_token: token.access_token,
      refresh_token: "__service_account__",
      token_expires_at: token.expires_at,
      email: conn.email,
    });
    return token.access_token;
  }

  // OAuth — refresh token
  if (!conn.refresh_token || conn.refresh_token.startsWith("__")) return null;

  if (provider === "ga4" || provider === "gsc") {
    return refreshGoogleToken(sessionId, provider, conn.refresh_token);
  }

  return null;
}

/* ══════════════════════════════════════════════════════════
   Service Account JWT → Access Token
   ══════════════════════════════════════════════════════════ */
async function getServiceAccountToken(provider: string): Promise<{ access_token: string; expires_at: string } | null> {
  const scope = SCOPES[provider];
  if (!scope || !SA_EMAIL || !SA_KEY) return null;

  try {
    // Debug key format
    console.log(`[SA] Provider: ${provider}, Email: ${SA_EMAIL}`);
    console.log(`[SA] Key length: ${SA_KEY.length}, starts: ${SA_KEY.substring(0, 27)}, has real newlines: ${SA_KEY.includes("\n") && !SA_KEY.includes("\\n")}`);

    // Build JWT
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        iss: SA_EMAIL,
        scope,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    ).toString("base64url");

    const signInput = `${header}.${payload}`;
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signInput);
    const signature = sign.sign(SA_KEY, "base64url");
    const jwt = `${signInput}.${signature}`;

    // Exchange JWT for access token
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      console.error("Service account token error:", await res.text());
      return null;
    }

    const data = await res.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString().replace("Z", "");

    return { access_token: data.access_token, expires_at: expiresAt };
  } catch (err) {
    console.error("JWT signing error:", err);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   OAuth Token Refresh (fallback)
   ══════════════════════════════════════════════════════════ */
async function refreshGoogleToken(sessionId: string, provider: string, refreshToken: string): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString().replace("Z", "");

  upsertAnalyticsConnection(sessionId, provider, {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? "",
    token_expires_at: expiresAt,
  });

  return data.access_token;
}

/* ── Bing auth header ── */
export function getBingAuthHeader(conn: { access_token: string; refresh_token: string }): Record<string, string> {
  if (conn.refresh_token === "__api_key__") {
    // API key auth — Bing uses apikey query param, but also supports header
    return { "Ocp-Apim-Subscription-Key": conn.access_token };
  }
  return { Authorization: `Bearer ${conn.access_token}` };
}
