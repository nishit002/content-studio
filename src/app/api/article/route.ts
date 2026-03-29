import { NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import fs from "fs";
import path from "path";
import yaml from "js-yaml"; // may not be available — handle gracefully

const PIPELINE_DIR = process.env.PIPELINE_DIR
  || path.resolve("/Users/nishitkumar/Documents/gas-split/content-generator");
const OUTPUT_DIR = path.join(PIPELINE_DIR, "output");

/**
 * GET /api/article?slug=scope-of-bca-in-india&part=html|meta|outline|all
 *
 * Returns article artifacts from the Python pipeline output folder.
 */
export async function GET(req: NextRequest) {
  await getSession(); // validate session

  const list = req.nextUrl.searchParams.get("list");
  const slug = req.nextUrl.searchParams.get("slug");
  const part = req.nextUrl.searchParams.get("part") || "all";

  // List all generated articles
  if (list === "true") {
    if (!fs.existsSync(OUTPUT_DIR)) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const dirs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    const articles: Record<string, unknown>[] = [];
    for (const dir of dirs) {
      const metaPath = path.join(OUTPUT_DIR, dir.name, "meta.json");
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        const htmlPath = path.join(OUTPUT_DIR, dir.name, "article.html");
        articles.push({
          slug: dir.name,
          topic: meta.topic || dir.name,
          title: meta.title || "",
          content_type: meta.content_type || "",
          word_count: meta.word_count || 0,
          table_count: meta.table_count || 0,
          section_count: meta.section_count || 0,
          quality_grade: meta.quality?.overall_grade || "",
          quality_score: meta.quality?.overall_score || 0,
          generation_time: meta.generation_time || 0,
          generated_at: meta.generated_at || "",
          has_html: fs.existsSync(htmlPath),
        });
      } catch {
        // skip malformed meta
      }
    }

    // Sort by generated_at descending (newest first)
    articles.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));

    return new Response(JSON.stringify(articles), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!slug) {
    return new Response(JSON.stringify({ error: "slug is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Sanitize slug to prevent path traversal
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "");
  const articleDir = path.join(OUTPUT_DIR, safeSlug);

  if (!fs.existsSync(articleDir)) {
    return new Response(JSON.stringify({ error: "Article not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (part === "html") {
    const htmlPath = path.join(articleDir, "article.html");
    if (!fs.existsSync(htmlPath)) {
      return new Response(JSON.stringify({ error: "HTML not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const html = fs.readFileSync(htmlPath, "utf-8");
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Build combined response
  const result: Record<string, unknown> = { slug: safeSlug };

  // Meta
  const metaPath = path.join(articleDir, "meta.json");
  if (fs.existsSync(metaPath)) {
    try {
      result.meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch { result.meta = null; }
  }

  // Outline
  const outlinePath = path.join(articleDir, "outline.yaml");
  if (fs.existsSync(outlinePath)) {
    const raw = fs.readFileSync(outlinePath, "utf-8");
    try {
      // Try to parse YAML
      result.outline = yaml.load(raw);
    } catch {
      result.outlineRaw = raw;
    }
  }

  // HTML (include in "all" response as string)
  if (part === "all" || part === "meta") {
    const htmlPath = path.join(articleDir, "article.html");
    if (fs.existsSync(htmlPath)) {
      result.html = fs.readFileSync(htmlPath, "utf-8");
    }
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * PUT /api/article — Save edited article HTML back to disk.
 *
 * Body: { slug, html }
 */
export async function PUT(req: NextRequest) {
  await getSession();
  const body = await req.json();
  const { slug, html } = body as { slug?: string; html?: string };

  if (!slug || !html) {
    return new Response(JSON.stringify({ error: "slug and html are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "");
  const articleDir = path.join(OUTPUT_DIR, safeSlug);

  if (!fs.existsSync(articleDir)) {
    return new Response(JSON.stringify({ error: "Article not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Save to article.html
  const htmlPath = path.join(articleDir, "article.html");
  fs.writeFileSync(htmlPath, html, "utf-8");

  return new Response(JSON.stringify({ ok: true, slug: safeSlug }), {
    headers: { "Content-Type": "application/json" },
  });
}
