import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/server/session";
import { getDb, getNewsSources, upsertNewsSource, deleteNewsSource } from "@/lib/server/db";
import { discoverNews } from "@/lib/server/pipeline";

/**
 * GET /api/news — List news sources, discovered topics, or suggested feeds.
 *
 * ?view=sources  — list all watched sources with on/off status
 * ?view=discovered — list discovered news topics (from last discovery run)
 * ?view=suggestions — smart feed suggestions by category
 * ?view=runs — recent discovery runs
 */
export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const view = req.nextUrl.searchParams.get("view") || "sources";

  if (view === "sources") {
    const sources = getNewsSources(sessionId);
    return Response.json({ sources });
  }

  if (view === "discovered") {
    const db = getDb();
    const runId = req.nextUrl.searchParams.get("runId");
    let items: unknown[];
    // Show all items, not just from one run — sorted newest-published first.
    // runId filter still supported if explicitly passed.
    if (runId) {
      items = db.prepare(
        `SELECT id, title, url, source, tags, published, status, run_id, created_at
         FROM news_items WHERE session_id = ? AND run_id = ?
         ORDER BY published DESC, created_at DESC LIMIT 300`
      ).all(sessionId, runId);
    } else {
      items = db.prepare(
        `SELECT id, title, url, source, tags, published, status, run_id, created_at
         FROM news_items WHERE session_id = ?
         ORDER BY published DESC, created_at DESC LIMIT 300`
      ).all(sessionId);
    }
    return Response.json({ items });
  }

  if (view === "runs") {
    const db = getDb();
    const runs = db
      .prepare(
        `SELECT id, status, items_found, started_at, completed_at
         FROM news_runs WHERE session_id = ?
         ORDER BY started_at DESC LIMIT 20`
      )
      .all(sessionId);
    return Response.json({ runs });
  }

  if (view === "suggestions") {
    // Smart suggestions grouped by category
    const suggestions = [
      {
        category: "Top Publishers",
        icon: "newspaper",
        feeds: [
          { name: "Times of India Education", url: "https://timesofindia.indiatimes.com/rssfeeds/913168846.cms" },
          { name: "Indian Express Education", url: "https://indianexpress.com/section/education/feed/" },
          { name: "NDTV Education", url: "https://feeds.feedburner.com/ndtv/education" },
          { name: "Hindustan Times Education", url: "https://www.hindustantimes.com/feeds/rss/education/rssfeed.xml" },
          { name: "The Hindu Education", url: "https://www.thehindu.com/education/feeder/default.rss" },
          { name: "Jagran Josh", url: "https://www.jagranjosh.com/articles-rss.xml" },
          { name: "LiveMint Education", url: "https://www.livemint.com/rss/education" },
          { name: "Economic Times Education", url: "https://economictimes.indiatimes.com/news/how-to/rssfeeds/22745977.cms" },
        ],
      },
      {
        category: "Entrance Exams",
        icon: "exam",
        feeds: [
          { name: "JEE / NEET Updates", url: "https://news.google.com/rss/search?q=JEE+NEET+college+admission+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "GATE / IIT", url: "https://news.google.com/rss/search?q=GATE+IIT+NIT+engineering+admission+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "CAT / MBA", url: "https://news.google.com/rss/search?q=CAT+MBA+management+entrance+IIM+admission+2026&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "CLAT / Law", url: "https://news.google.com/rss/search?q=CLAT+AILET+law+entrance+exam+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "CUET", url: "https://news.google.com/rss/search?q=CUET+central+university+entrance+test+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "Medical / MBBS", url: "https://news.google.com/rss/search?q=MBBS+AIIMS+NEET+PG+medical+admission+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
        ],
      },
      {
        category: "Board Exams",
        icon: "board",
        feeds: [
          { name: "CBSE Board", url: "https://news.google.com/rss/search?q=CBSE+board+exam+result+datesheet+2026&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "ICSE / ISC", url: "https://news.google.com/rss/search?q=ICSE+ISC+board+exam+result+2026&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "State Boards", url: "https://news.google.com/rss/search?q=state+board+result+admit+card+india&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "South Boards", url: "https://news.google.com/rss/search?q=Kerala+SSLC+TN+board+AP+SSC+exam+result+2026&hl=en-IN&gl=IN&ceid=IN:en" },
        ],
      },
      {
        category: "Government Jobs",
        icon: "govt",
        feeds: [
          { name: "UPSC", url: "https://news.google.com/rss/search?q=UPSC+civil+services+IAS+IPS+notification+2026&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "SSC / Railway", url: "https://news.google.com/rss/search?q=SSC+IBPS+Railway+recruitment+government+job+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "Defence Jobs", url: "https://news.google.com/rss/search?q=Indian+Army+Navy+Air+Force+recruitment+2026&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "Teaching (TET/CTET)", url: "https://news.google.com/rss/search?q=teacher+recruitment+TET+CTET+SUPER+TET+2026&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "Police Jobs", url: "https://news.google.com/rss/search?q=police+constable+SI+recruitment+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
        ],
      },
      {
        category: "Banking",
        icon: "bank",
        feeds: [
          { name: "IBPS / Bank PO", url: "https://news.google.com/rss/search?q=IBPS+bank+exam+recruitment+2026+india&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "SBI Recruitment", url: "https://news.google.com/rss/search?q=SBI+clerk+PO+recruitment+exam+2026&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "RBI", url: "https://news.google.com/rss/search?q=RBI+grade+B+assistant+recruitment+2026&hl=en-IN&gl=IN&ceid=IN:en" },
        ],
      },
      {
        category: "Reddit / Forums",
        icon: "reddit",
        feeds: [
          { name: "r/Indian_Academia", url: "https://www.reddit.com/r/Indian_Academia/.rss" },
          { name: "r/JEENEETards", url: "https://www.reddit.com/r/JEENEETards/.rss" },
          { name: "r/CATpreparation", url: "https://www.reddit.com/r/CATpreparation/.rss" },
          { name: "r/UPSC", url: "https://www.reddit.com/r/UPSC/.rss" },
          { name: "r/developersIndia", url: "https://www.reddit.com/r/developersIndia/.rss" },
        ],
      },
      {
        category: "International",
        icon: "globe",
        feeds: [
          { name: "Study Abroad", url: "https://news.google.com/rss/search?q=study+abroad+GRE+GMAT+IELTS+foreign+university+india+students&hl=en-IN&gl=IN&ceid=IN:en" },
          { name: "Times Higher Education", url: "https://www.timeshighereducation.com/rss" },
          { name: "r/GRE", url: "https://www.reddit.com/r/GRE/.rss" },
        ],
      },
    ];

    return Response.json({ suggestions });
  }

  return Response.json({ error: "Invalid view parameter" }, { status: 400 });
}

/**
 * POST /api/news — Multiple actions via `action` field.
 *
 * { action: "add-source", name, url, category? }
 * { action: "toggle-source", id, enabled }
 * { action: "discover" } — run news discovery via Python pipeline
 * { action: "add-custom-feed", topic } — create Google News RSS for any topic
 */
export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();
  const { action } = body as { action: string };

  if (action === "add-source") {
    const { name, url, category } = body as { name: string; url: string; category?: string };
    if (!name?.trim() || !url?.trim()) {
      return Response.json({ error: "name and url required" }, { status: 400 });
    }
    const id = uuidv4();
    upsertNewsSource(sessionId, id, name.trim(), url.trim(), "rss", category?.trim() || "Custom");
    return Response.json({ ok: true, id });
  }

  if (action === "toggle-source") {
    const { id, enabled } = body as { id: string; enabled: boolean };
    const db = getDb();
    db.prepare("UPDATE news_sources SET enabled = ? WHERE id = ? AND session_id = ?")
      .run(enabled ? 1 : 0, id, sessionId);
    return Response.json({ ok: true });
  }

  if (action === "add-custom-feed") {
    // Smart: create a Google News RSS feed for any topic the user types
    const { topic } = body as { topic: string };
    if (!topic?.trim()) {
      return Response.json({ error: "topic required" }, { status: 400 });
    }
    const encoded = encodeURIComponent(topic.trim().replace(/\s+/g, "+"));
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-IN&gl=IN&ceid=IN:en`;
    const id = uuidv4();
    const name = `Google: ${topic.trim().slice(0, 40)}`;
    upsertNewsSource(sessionId, id, name, url, "rss", "Custom Topic");
    return Response.json({ ok: true, id, name, url });
  }

  if (action === "discover") {
    // fire-and-forget — return runId immediately, browser polls news_runs for completion
    const db = getDb();
    const runId = uuidv4();
    db.prepare(
      `INSERT INTO news_runs (id, session_id, status, started_at)
       VALUES (?, ?, 'running', datetime('now'))`
    ).run(runId, sessionId);

    // Run discovery in background — does NOT block the HTTP response
    (async () => {
      try {
        const items = await discoverNews(sessionId);
        const upsertStmt = db.prepare(
          `INSERT INTO news_items (id, session_id, title, url, source, tags, published, status, run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'discovered', ?, datetime('now'))
           ON CONFLICT(session_id, url) DO UPDATE SET
             published = excluded.published`
        );
        let newCount = 0;
        const tx = db.transaction(() => {
          for (const item of items) {
            const id = uuidv4();
            const result = upsertStmt.run(
              id, sessionId, item.title, item.url, item.source,
              item.tags || "", item.published || "", runId
            );
            if (result.changes > 0) newCount++;
          }
        });
        tx();
        db.prepare(
          `UPDATE news_runs SET status = 'done', items_found = ?, completed_at = datetime('now') WHERE id = ?`
        ).run(newCount, runId);
      } catch {
        try {
          db.prepare(
            `UPDATE news_runs SET status = 'error', completed_at = datetime('now') WHERE id = ?`
          ).run(runId);
        } catch { /* ignore */ }
      }
    })();

    // Return runId immediately — browser polls GET /api/news?view=runs to check status
    return Response.json({ ok: true, runId, discovering: true });
  }

  if (action === 'mark-done') {
    const { id } = body as { id: string };
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });
    const db = getDb();
    db.prepare('UPDATE news_items SET status = ? WHERE id = ? AND session_id = ?').run('used', id, sessionId);
    return Response.json({ ok: true });
  }

  if (action === 'unmark-done') {
    const { id } = body as { id: string };
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });
    const db = getDb();
    db.prepare('UPDATE news_items SET status = ? WHERE id = ? AND session_id = ?').run('discovered', id, sessionId);
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}

/**
 * DELETE /api/news?id=... — Remove a news source.
 */
export async function DELETE(req: NextRequest) {
  await getSession();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  deleteNewsSource(id);
  return Response.json({ ok: true });
}
