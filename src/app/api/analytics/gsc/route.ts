import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import {
  getAnalyticsConnection,
  getAnalyticsCache,
  setAnalyticsCache,
} from "@/lib/server/db";
import { getValidToken } from "@/lib/server/analytics-auth";

/* ── GET: Fetch Google Search Console data ── */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const conn = getAnalyticsConnection(sessionId, "gsc");

  if (!conn?.access_token || !conn.property_id) {
    return NextResponse.json({ error: "GSC not connected" }, { status: 400 });
  }

  const metric = req.nextUrl.searchParams.get("metric") ?? "overview";
  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "28");
  const dateRange = `${days}d`;

  // Check cache
  const cached = getAnalyticsCache(sessionId, "gsc", metric, dateRange);
  if (cached) return NextResponse.json(cached);

  const token = await getValidToken(sessionId, "gsc");
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 });

  const siteUrl = conn.property_id;
  const startDate = daysAgo(days);
  const endDate = daysAgo(1); // GSC data has ~2 day lag

  try {
    let result;

    if (metric === "overview") {
      // Total clicks, impressions, CTR, position
      const data = await runGSCQuery(token, siteUrl, {
        startDate,
        endDate,
        dimensions: [],
        rowLimit: 1,
      });
      const row = data.rows?.[0];
      result = {
        clicks: row?.clicks ?? 0,
        impressions: row?.impressions ?? 0,
        ctr: row?.ctr ?? 0,
        position: row?.position ?? 0,
      };
    } else if (metric === "timeseries") {
      // Daily search performance
      const data = await runGSCQuery(token, siteUrl, {
        startDate,
        endDate,
        dimensions: ["date"],
      });
      result = (data.rows ?? []).map((r: GSCRow) => ({
        date: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
    } else if (metric === "queries") {
      // Top search queries
      const data = await runGSCQuery(token, siteUrl, {
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: 100,
      });
      result = (data.rows ?? []).map((r: GSCRow) => ({
        query: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
    } else if (metric === "pages") {
      // Top pages by clicks
      const data = await runGSCQuery(token, siteUrl, {
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: 100,
      });
      result = (data.rows ?? []).map((r: GSCRow) => ({
        page: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
    } else if (metric === "countries") {
      // Search traffic by country
      const data = await runGSCQuery(token, siteUrl, {
        startDate,
        endDate,
        dimensions: ["country"],
        rowLimit: 50,
      });
      result = (data.rows ?? []).map((r: GSCRow) => ({
        country: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
    } else if (metric === "devices") {
      // Search by device type
      const data = await runGSCQuery(token, siteUrl, {
        startDate,
        endDate,
        dimensions: ["device"],
      });
      result = (data.rows ?? []).map((r: GSCRow) => ({
        device: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
    } else {
      return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
    }

    setAnalyticsCache(sessionId, "gsc", metric, dateRange, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("GSC API error:", err);
    return NextResponse.json({ error: "GSC API failed" }, { status: 500 });
  }
}

/* ── Types ── */
interface GSCRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

/* ── GSC Search Analytics API ── */
async function runGSCQuery(
  token: string,
  siteUrl: string,
  body: { startDate: string; endDate: string; dimensions: string[]; rowLimit?: number }
) {
  const encodedSite = encodeURIComponent(siteUrl);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: body.startDate,
        endDate: body.endDate,
        dimensions: body.dimensions,
        rowLimit: body.rowLimit ?? 25000,
        dataState: "final",
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GSC API ${res.status}: ${errText}`);
  }
  return res.json();
}

/* ── Helpers ── */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

