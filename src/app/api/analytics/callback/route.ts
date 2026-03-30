import { NextRequest, NextResponse } from "next/server";
import { upsertAnalyticsConnection } from "@/lib/server/db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const BING_CLIENT_ID = process.env.BING_CLIENT_ID ?? "";
const BING_CLIENT_SECRET = process.env.BING_CLIENT_SECRET ?? "";

function getBaseUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/* ── GET: OAuth callback from Google / Microsoft ── */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code || !state) {
    return redirectWithError(req, error ?? "Missing code or state");
  }

  const [sessionId, provider] = state.split(":");
  if (!sessionId || !provider) {
    return redirectWithError(req, "Invalid state");
  }

  const baseUrl = getBaseUrl(req);
  const callbackUrl = `${baseUrl}/api/analytics/callback`;

  try {
    if (provider === "ga4" || provider === "gsc") {
      // Exchange code for tokens with Google
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: callbackUrl,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("Google token exchange failed:", err);
        return redirectWithError(req, "Google token exchange failed");
      }

      const tokens = await tokenRes.json();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
        .toISOString()
        .replace("Z", "");

      // Get user email
      let email = "";
      try {
        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userRes.ok) {
          const user = await userRes.json();
          email = user.email ?? "";
        }
      } catch { /* email is optional */ }

      upsertAnalyticsConnection(sessionId, provider, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? "",
        token_expires_at: expiresAt,
        email,
      });

      return redirectWithSuccess(req, provider);
    }

    if (provider === "bing") {
      // Exchange code for tokens with Microsoft
      const tokenRes = await fetch(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: BING_CLIENT_ID,
            client_secret: BING_CLIENT_SECRET,
            redirect_uri: callbackUrl,
            grant_type: "authorization_code",
            scope: "https://api.bing.com/.default offline_access",
          }),
        }
      );

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("Bing token exchange failed:", err);
        return redirectWithError(req, "Bing token exchange failed");
      }

      const tokens = await tokenRes.json();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
        .toISOString()
        .replace("Z", "");

      upsertAnalyticsConnection(sessionId, provider, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? "",
        token_expires_at: expiresAt,
      });

      return redirectWithSuccess(req, provider);
    }

    return redirectWithError(req, "Unknown provider");
  } catch (err) {
    console.error("OAuth callback error:", err);
    return redirectWithError(req, "OAuth failed");
  }
}

function redirectWithSuccess(req: NextRequest, provider: string) {
  const baseUrl = getBaseUrl(req);
  return NextResponse.redirect(`${baseUrl}/?analytics_connected=${provider}`);
}

function redirectWithError(req: NextRequest, error: string) {
  const baseUrl = getBaseUrl(req);
  return NextResponse.redirect(
    `${baseUrl}/?analytics_error=${encodeURIComponent(error)}`
  );
}
