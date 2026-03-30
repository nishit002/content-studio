import { NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { getApiKeys } from "@/lib/server/db";
import * as XLSX from "xlsx";

/**
 * POST /api/bulk — Parse uploaded .xlsx file into structured rows.
 *
 * Accepts multipart/form-data with a file field.
 * Auto-detects both formats:
 *   Simple: topic, sub_keywords, category, region, Internal Links
 *   Detailed: #, Degree, Type, Vol/mo, Topic, H1 Title, H2 Headings, Sub Keywords, ...
 *
 * Returns: { rows: BulkRow[], format: "simple"|"detailed" }
 */
export async function POST(req: NextRequest) {
  await getSession();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    if (raw.length === 0) {
      return Response.json({ error: "Empty spreadsheet" }, { status: 400 });
    }

    // Detect format from column headers
    const headers = Object.keys(raw[0]).map((h) => h.toLowerCase().trim());
    const isDetailed = headers.some((h) => h.includes("h1") || h.includes("h2") || h.includes("vol"));

    const rows = raw.map((r, i) => {
      // Normalize column access (case-insensitive)
      const get = (keys: string[]): string => {
        for (const k of keys) {
          for (const col of Object.keys(r)) {
            if (col.toLowerCase().trim() === k.toLowerCase()) {
              return String(r[col] ?? "").trim();
            }
          }
        }
        return "";
      };

      return {
        id: i,
        topic: get(["topic", "topic (url slug)", "title", "h1 title"]),
        subKeywords: get(["sub_keywords", "sub keywords", "subkeywords"]),
        category: get(["category", "type"]),
        region: get(["region"]) || "India",
        internalLinks: get(["internal links", "internal_links"]) || "Yes",
        // Detailed format extras
        h1Title: isDetailed ? get(["h1 title", "h1"]) : "",
        h2Headings: isDetailed ? get(["h2 headings", "h2"]) : "",
        searchVolume: isDetailed ? get(["vol/mo", "volume", "search volume"]) : "",
        status: get(["status"]) || "Pending",
      };
    }).filter((r) => r.topic); // Drop empty rows

    return Response.json({ rows, format: isDetailed ? "detailed" : "simple", total: rows.length });
  } catch (err) {
    return Response.json(
      { error: `Failed to parse file: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 400 }
    );
  }
}

/**
 * PUT /api/bulk — Auto-generate sub-keywords for topics using DataForSEO.
 *
 * Body: { topics: string[] }
 * Returns: { keywords: Record<string, string[]> } — map of topic → related keywords
 */
export async function PUT(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();
  const { topics } = body as { topics: string[] };

  if (!topics?.length) {
    return Response.json({ error: "topics array required" }, { status: 400 });
  }

  // Get DataForSEO credentials from session
  const keys = getApiKeys(sessionId);
  const dfKey = keys.find((k) => k.provider === "dataforseo");

  if (!dfKey) {
    return Response.json({ error: "DataForSEO API key not configured. Add it in Configuration > API Keys." }, { status: 400 });
  }

  const [login, password] = dfKey.key_value.split("|");
  if (!login || !password) {
    return Response.json({ error: "DataForSEO credentials incomplete (need login|password)" }, { status: 400 });
  }

  const auth = Buffer.from(`${login}:${password}`).toString("base64");
  const result: Record<string, string[]> = {};

  // Process each topic — batch to avoid overwhelming the API
  for (const topic of topics.slice(0, 50)) {
    try {
      const res = await fetch(
        "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              keywords: [topic],
              location_name: "India",
              language_name: "English",
              limit: 15,
            },
          ]),
        }
      );

      if (!res.ok) {
        result[topic] = [];
        continue;
      }

      const data = await res.json();
      const items = data?.tasks?.[0]?.result || [];
      const keywords: string[] = [];

      for (const item of items) {
        const kw =
          item?.keyword ||
          item?.key ||
          item?.keyword_data?.keyword ||
          item?.keyword_info?.keyword;
        if (kw && kw.toLowerCase() !== topic.toLowerCase()) {
          keywords.push(kw);
        }
      }

      result[topic] = keywords.slice(0, 12);
    } catch {
      result[topic] = [];
    }
  }

  return Response.json({ keywords: result });
}
