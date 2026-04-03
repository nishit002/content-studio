import { NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { getApiKeys, createBulkRun, updateBulkRun, listBulkRuns, getBulkRun, deleteBulkRun } from "@/lib/server/db";
import * as XLSX from "xlsx";

/**
 * GET /api/bulk?runs=true          → list all bulk runs (no items)
 * GET /api/bulk?runId=X            → get specific run including items_json
 */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("runId");

  if (runId) {
    const run = getBulkRun(sessionId, runId);
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({
      ...run,
      items: (() => { try { return JSON.parse(run.items_json || "[]"); } catch { return []; } })(),
    });
  }

  const runs = listBulkRuns(sessionId);
  return Response.json({ runs });
}

/**
 * PATCH /api/bulk — update a bulk run's progress/completion
 * Body: { runId, status?, done?, failed?, totalWords?, items?, completedAt? }
 */
export async function PATCH(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json() as { runId: string; status?: string; done?: number; failed?: number; totalWords?: number; items?: unknown[]; completedAt?: string };
  const { runId, ...updates } = body;
  if (!runId) return Response.json({ error: "runId required" }, { status: 400 });

  const run = getBulkRun(sessionId, runId);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });

  updateBulkRun(runId, updates);
  return Response.json({ ok: true });
}

/**
 * DELETE /api/bulk?runId=X — delete a specific bulk run
 */
export async function DELETE(req: NextRequest) {
  const sessionId = await getSession();
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("runId");
  if (!runId) return Response.json({ error: "runId required" }, { status: 400 });
  deleteBulkRun(sessionId, runId);
  return Response.json({ ok: true });
}

/**
 * POST /api/bulk — two modes:
 *   1. JSON body { action: "createRun", name, total } → creates a bulk run, returns { runId }
 *   2. FormData with file field → parse uploaded .xlsx file into structured rows
 *
 * Accepts multipart/form-data with a file field.
 * Auto-detects both formats:
 *   Simple: topic, sub_keywords, category, region, Internal Links
 *   Detailed: #, Degree, Type, Vol/mo, Topic, H1 Title, H2 Headings, Sub Keywords, ...
 *
 * Returns: { rows: BulkRow[], format: "simple"|"detailed" }
 */
export async function POST(req: NextRequest) {
  const sessionId = await getSession();

  // JSON body → create a new bulk run record
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await req.json() as { action: string; name: string; total: number };
    if (body.action === "createRun") {
      const runId = createBulkRun(sessionId, body.name || "Batch", body.total || 0);
      return Response.json({ runId });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

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
