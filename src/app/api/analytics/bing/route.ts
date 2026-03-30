import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import {
  getAnalyticsConnection,
  getAnalyticsCache,
  setAnalyticsCache,
} from "@/lib/server/db";
import { getValidToken, getBingAuthHeader } from "@/lib/server/analytics-auth";

const BING_API = "https://ssl.bing.com/webmaster/api.svc/json";

/* ── GET: Fetch Bing Webmaster data ── */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const conn = getAnalyticsConnection(sessionId, "bing");

  if (!conn?.access_token || !conn.property_id) {
    return NextResponse.json({ error: "Bing not connected" }, { status: 400 });
  }

  const metric = req.nextUrl.searchParams.get("metric") ?? "overview";
  const dateRange = "28d";

  // Check cache
  const cached = getAnalyticsCache(sessionId, "bing", metric, dateRange);
  if (cached) return NextResponse.json(cached);

  const token = await getValidToken(sessionId, "bing");
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 });

  const siteUrl = conn.property_id;

  try {
    let result;

    if (metric === "overview") {
      // Traffic stats summary
      const stats = await bingGet(token, "GetRankAndTrafficStats", siteUrl);
      const data = stats.d ?? [];
      // Sum last 28 days
      const recent = data.slice(-28);
      const totalClicks = recent.reduce((s: number, r: BingTrafficRow) => s + (r.Clicks ?? 0), 0);
      const totalImpressions = recent.reduce((s: number, r: BingTrafficRow) => s + (r.Impressions ?? 0), 0);
      result = {
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
        avgPosition: recent.length > 0
          ? recent.reduce((s: number, r: BingTrafficRow) => s + (r.AvgClickPosition ?? 0), 0) / recent.length
          : 0,
      };
    } else if (metric === "timeseries") {
      // Daily traffic
      const stats = await bingGet(token, "GetRankAndTrafficStats", siteUrl);
      const data = stats.d ?? [];
      result = data.slice(-28).map((r: BingTrafficRow) => ({
        date: r.Date ? r.Date.split("T")[0] : "",
        clicks: r.Clicks ?? 0,
        impressions: r.Impressions ?? 0,
      }));
    } else if (metric === "keywords") {
      // Top keywords from Bing
      const stats = await bingGet(token, "GetQueryStats", siteUrl);
      const data = stats.d ?? [];
      result = data.slice(0, 100).map((r: BingKeywordRow) => ({
        query: r.Query ?? "",
        clicks: r.Clicks ?? 0,
        impressions: r.Impressions ?? 0,
        avgPosition: r.AvgClickPosition ?? 0,
        avgImpressionPosition: r.AvgImpressionPosition ?? 0,
      }));
    } else if (metric === "pages") {
      // Top pages
      const stats = await bingGet(token, "GetPageStats", siteUrl);
      const data = stats.d ?? [];
      result = data.slice(0, 100).map((r: BingPageRow) => ({
        page: r.Page ?? "",
        clicks: r.Clicks ?? 0,
        impressions: r.Impressions ?? 0,
        avgClickPosition: r.AvgClickPosition ?? 0,
      }));
    } else if (metric === "crawl") {
      // Crawl stats — pages crawled, errors, etc.
      const stats = await bingGet(token, "GetCrawlStats", siteUrl);
      const data = stats.d ?? [];
      const recent = data.slice(-28);
      result = {
        timeseries: recent.map((r: BingCrawlRow) => ({
          date: r.Date ? r.Date.split("T")[0] : "",
          crawled: r.CrawledPages ?? 0,
          inIndex: r.InIndex ?? 0,
          errors: r.CrawlErrors ?? 0,
        })),
        totalCrawled: recent.reduce((s: number, r: BingCrawlRow) => s + (r.CrawledPages ?? 0), 0),
        totalErrors: recent.reduce((s: number, r: BingCrawlRow) => s + (r.CrawlErrors ?? 0), 0),
        latestInIndex: recent.length > 0 ? (recent[recent.length - 1] as BingCrawlRow).InIndex ?? 0 : 0,
      };
    } else if (metric === "backlinks") {
      // Inbound links
      const stats = await bingGet(token, "GetLinkCounts", siteUrl);
      result = {
        totalLinks: stats.d ?? 0,
      };
    } else {
      return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
    }

    setAnalyticsCache(sessionId, "bing", metric, dateRange, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Bing API error:", err);
    return NextResponse.json({ error: "Bing API failed" }, { status: 500 });
  }
}

/* ── Types ── */
interface BingTrafficRow {
  Date?: string;
  Clicks?: number;
  Impressions?: number;
  AvgClickPosition?: number;
}
interface BingKeywordRow {
  Query?: string;
  Clicks?: number;
  Impressions?: number;
  AvgClickPosition?: number;
  AvgImpressionPosition?: number;
}
interface BingPageRow {
  Page?: string;
  Clicks?: number;
  Impressions?: number;
  AvgClickPosition?: number;
}
interface BingCrawlRow {
  Date?: string;
  CrawledPages?: number;
  InIndex?: number;
  CrawlErrors?: number;
}

/* ── Bing API helper ── */
async function bingGet(token: string, method: string, siteUrl: string) {
  const encodedSite = encodeURIComponent(siteUrl);
  // Build auth headers — supports both API key and OAuth
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // For API key auth, Bing uses query param
  const apiKeyParam = token.length < 64 ? `&apikey=${encodeURIComponent(token)}` : "";
  if (!apiKeyParam) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BING_API}/${method}?siteUrl=${encodedSite}${apiKeyParam}`, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bing API ${res.status}: ${errText}`);
  }
  return res.json();
}
