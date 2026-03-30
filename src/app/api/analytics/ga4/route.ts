import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import {
  getAnalyticsConnection,
  getAnalyticsCache,
  setAnalyticsCache,
} from "@/lib/server/db";
import { getValidToken } from "@/lib/server/analytics-auth";

/* ── GET: Fetch GA4 analytics data ── */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const conn = getAnalyticsConnection(sessionId, "ga4");

  if (!conn?.access_token || !conn.property_id) {
    return NextResponse.json({ error: "GA4 not connected" }, { status: 400 });
  }

  const metric = req.nextUrl.searchParams.get("metric") ?? "overview";
  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "28");
  const dateRange = `${days}d`;

  // Check cache
  const cached = getAnalyticsCache(sessionId, "ga4", metric, dateRange);
  if (cached) return NextResponse.json(cached);

  // Ensure fresh token (service account or OAuth)
  const token = await getValidToken(sessionId, "ga4");
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 });

  const propertyId = conn.property_id;
  const startDate = daysAgo(days);
  const endDate = daysAgo(0);

  try {
    let result;

    if (metric === "overview") {
      // Summary metrics: sessions, users, pageviews, avg engagement
      result = await runGA4Report(token, propertyId, {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
          { name: "newUsers" },
        ],
      });
    } else if (metric === "timeseries") {
      // Daily traffic over time
      result = await runGA4Report(token, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      });
    } else if (metric === "pages") {
      // Top pages by pageviews
      result = await runGA4Report(token, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "totalUsers" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: "50",
      });
    } else if (metric === "sources") {
      // Traffic sources
      result = await runGA4Report(token, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: "20",
      });
    } else if (metric === "countries") {
      // Traffic by country
      result = await runGA4Report(token, propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "country" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: "20",
      });
    } else {
      return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
    }

    const parsed = parseGA4Response(metric, result);
    setAnalyticsCache(sessionId, "ga4", metric, dateRange, parsed);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("GA4 API error:", err);
    return NextResponse.json({ error: "GA4 API failed" }, { status: 500 });
  }
}

/* ── GA4 Data API v1 report runner ── */
async function runGA4Report(
  token: string,
  propertyId: string,
  body: Record<string, unknown>
) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GA4 API ${res.status}: ${errText}`);
  }
  return res.json();
}

/* ── Parse GA4 response into clean shapes ── */
function parseGA4Response(metric: string, data: Record<string, unknown>) {
  const rows = (data.rows ?? []) as Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }>;

  if (metric === "overview") {
    const r = rows[0];
    if (!r?.metricValues) return { sessions: 0, users: 0, pageviews: 0, avgDuration: 0, bounceRate: 0, newUsers: 0 };
    return {
      sessions: parseInt(r.metricValues[0]?.value ?? "0"),
      users: parseInt(r.metricValues[1]?.value ?? "0"),
      pageviews: parseInt(r.metricValues[2]?.value ?? "0"),
      avgDuration: parseFloat(r.metricValues[3]?.value ?? "0"),
      bounceRate: parseFloat(r.metricValues[4]?.value ?? "0"),
      newUsers: parseInt(r.metricValues[5]?.value ?? "0"),
    };
  }

  if (metric === "timeseries") {
    return rows.map((r) => ({
      date: formatGA4Date(r.dimensionValues?.[0]?.value ?? ""),
      sessions: parseInt(r.metricValues?.[0]?.value ?? "0"),
      users: parseInt(r.metricValues?.[1]?.value ?? "0"),
      pageviews: parseInt(r.metricValues?.[2]?.value ?? "0"),
    }));
  }

  if (metric === "pages") {
    return rows.map((r) => ({
      path: r.dimensionValues?.[0]?.value ?? "",
      title: r.dimensionValues?.[1]?.value ?? "",
      pageviews: parseInt(r.metricValues?.[0]?.value ?? "0"),
      users: parseInt(r.metricValues?.[1]?.value ?? "0"),
      avgDuration: parseFloat(r.metricValues?.[2]?.value ?? "0"),
      bounceRate: parseFloat(r.metricValues?.[3]?.value ?? "0"),
    }));
  }

  if (metric === "sources") {
    return rows.map((r) => ({
      channel: r.dimensionValues?.[0]?.value ?? "",
      sessions: parseInt(r.metricValues?.[0]?.value ?? "0"),
      users: parseInt(r.metricValues?.[1]?.value ?? "0"),
      pageviews: parseInt(r.metricValues?.[2]?.value ?? "0"),
    }));
  }

  if (metric === "countries") {
    return rows.map((r) => ({
      country: r.dimensionValues?.[0]?.value ?? "",
      sessions: parseInt(r.metricValues?.[0]?.value ?? "0"),
      users: parseInt(r.metricValues?.[1]?.value ?? "0"),
    }));
  }

  return rows;
}

/* ── Helpers ── */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function formatGA4Date(s: string): string {
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

