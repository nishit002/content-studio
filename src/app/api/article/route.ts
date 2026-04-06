import { NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import fs from "fs";
import path from "path";
import yaml from "js-yaml"; // may not be available — handle gracefully

const PIPELINE_DIR = process.env.PIPELINE_DIR
  || path.resolve("/Volumes/NISHIT_PD/gas new/gas-split/content-generator");
const OUTPUT_DIR = path.join(PIPELINE_DIR, "output");

const ATLAS_DIR = process.env.ATLAS_DIR || path.resolve("/Volumes/NISHIT_PD/content-studio/smart-writer");
const ATLAS_OUTPUT_DIR = path.join(ATLAS_DIR, "output");

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

    // Include news articles from output/news/
    const NEWS_OUTPUT_DIR = path.join(OUTPUT_DIR, "news");
    if (fs.existsSync(NEWS_OUTPUT_DIR)) {
      const newsDirs = fs.readdirSync(NEWS_OUTPUT_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const dir of newsDirs) {
        const metaPath = path.join(NEWS_OUTPUT_DIR, dir.name, "meta.json");
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          const htmlPath = path.join(NEWS_OUTPUT_DIR, dir.name, "article.html");
          articles.push({
            slug: dir.name,
            topic: meta.title || dir.name,
            title: meta.title || dir.name,
            content_type: "news_article",
            word_count: meta.word_count || 0,
            table_count: 0,
            section_count: 0,
            quality_grade: "",
            quality_score: 0,
            generation_time: meta.generation_time || 0,
            generated_at: meta.generated_at || "",
            has_html: fs.existsSync(htmlPath),
            source: "news",
            wp_post_id: meta.wp_post_id || null,
          });
        } catch { /* skip */ }
      }
    }

    // Include ATLAS articles from smart-writer/output/runs.json
    const atlasRunsPath = path.join(ATLAS_OUTPUT_DIR, "runs.json");
    if (fs.existsSync(atlasRunsPath)) {
      try {
        const runs = JSON.parse(fs.readFileSync(atlasRunsPath, "utf-8")) as Record<string, Record<string, unknown>>;
        for (const [, run] of Object.entries(runs)) {
          if (run.status !== "done") continue;
          const runDir = run.run_dir as string | undefined;
          if (!runDir) continue;
          const absRunDir = path.join(ATLAS_DIR, runDir);
          const htmlPath = path.join(absRunDir, "article.html");
          if (!fs.existsSync(htmlPath)) continue;
          // Extract slug from run_dir: last path component
          const dirName = path.basename(runDir);
          // Read coherence report for word count
          let wordCount = (run.word_count as number) || 0;
          let coherencePassed = true;
          const reportPath = path.join(absRunDir, "coherence_report.json");
          if (fs.existsSync(reportPath)) {
            try {
              const rpt = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
              coherencePassed = rpt.passed !== false;
            } catch { /* ignore */ }
          }
          articles.push({
            slug: dirName,
            topic: run.topic || dirName,
            title: run.topic || dirName,
            content_type: run.type || "atlas",
            word_count: wordCount,
            table_count: 0,
            section_count: 0,
            quality_grade: coherencePassed ? "A" : "B",
            quality_score: coherencePassed ? 90 : 70,
            generation_time: 0,
            generated_at: run.finished || run.started || "",
            has_html: true,
            source: "atlas",
          });
        }
      } catch { /* ignore malformed runs.json */ }
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

  // Check content-generator output, then news subdir, then ATLAS output
  let articleDir = path.join(OUTPUT_DIR, safeSlug);
  let isAtlasArticle = false;
  if (!fs.existsSync(articleDir)) {
    const newsDir = path.join(OUTPUT_DIR, "news", safeSlug);
    if (fs.existsSync(newsDir)) {
      articleDir = newsDir;
    } else {
      const atlasDir = path.join(ATLAS_OUTPUT_DIR, safeSlug);
      if (fs.existsSync(atlasDir)) {
        articleDir = atlasDir;
        isAtlasArticle = true;
      } else {
        return new Response(JSON.stringify({ error: "Article not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  if (part === "sources") {
    try {
      const lines: string[] = [
        `Research Sources`,
        `Article: ${safeSlug}`,
        `Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
      ];

      if (isAtlasArticle) {
        // ATLAS: read sources.json (sub-topic → url list)
        const sourcesPath = path.join(articleDir, "sources.json");
        if (!fs.existsSync(sourcesPath)) {
          return new Response("No source data found for this article.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        const sourcesData = JSON.parse(fs.readFileSync(sourcesPath, "utf-8")) as Record<string, string[]>;
        const allUrls = [...new Set(Object.values(sourcesData).flat())];
        lines.push(`Total sources: ${allUrls.length}`, "", "─────────────────────────────────────────────", "SOURCES", "─────────────────────────────────────────────", "");
        allUrls.forEach((url, i) => lines.push(`${i + 1}. ${url}`));
        // Also list sub-topics
        lines.push("", "─────────────────────────────────────────────", "RESEARCH TOPICS", "─────────────────────────────────────────────", "");
        Object.keys(sourcesData).forEach((topic, i) => lines.push(`${i + 1}. ${topic} (${sourcesData[topic].length} sources)`));
      } else {
        // CG: read research.json
        const researchPath = path.join(articleDir, "research.json");
        if (!fs.existsSync(researchPath)) {
          return new Response("No research data found for this article.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        const research = JSON.parse(fs.readFileSync(researchPath, "utf-8"));
        const sources: { url: string; title?: string }[] = research.sources || [];
        const queries: { query: string }[] = research.queries || [];
        lines.push(`Total sources: ${sources.length}`, "", "─────────────────────────────────────────────", "SOURCES", "─────────────────────────────────────────────", "");
        sources.forEach((s, i) => lines.push(`${i + 1}. ${s.title || "(no title)"}\n   ${s.url}`));
        if (queries.length > 0) {
          lines.push("", "─────────────────────────────────────────────", "SEARCH QUERIES USED", "─────────────────────────────────────────────", "");
          queries.forEach((q, i) => lines.push(`${i + 1}. ${q.query}`));
        }
      }

      return new Response(lines.join("\n"), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeSlug}-sources.txt"`,
        },
      });
    } catch {
      return new Response("Failed to read research data.", { headers: { "Content-Type": "text/plain" } });
    }
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
  const result: Record<string, unknown> = { slug: safeSlug, source: isAtlasArticle ? "atlas" : "cg" };

  // Meta — for ATLAS articles, synthesize from runs.json + coherence_report.json
  if (isAtlasArticle) {
    const atlasRunsPath = path.join(ATLAS_OUTPUT_DIR, "runs.json");
    let atlasMeta: Record<string, unknown> = { topic: safeSlug, content_type: "atlas" };
    if (fs.existsSync(atlasRunsPath)) {
      try {
        const runs = JSON.parse(fs.readFileSync(atlasRunsPath, "utf-8")) as Record<string, Record<string, unknown>>;
        const run = Object.values(runs).find((r) => path.basename((r.run_dir as string) || "") === safeSlug);
        if (run) atlasMeta = { topic: run.topic, content_type: run.type, word_count: run.word_count, generated_at: run.finished || run.started };
      } catch { /* ignore */ }
    }
    const reportPath = path.join(articleDir, "coherence_report.json");
    if (fs.existsSync(reportPath)) {
      try {
        const rpt = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
        atlasMeta.coherence_passed = rpt.passed;
        atlasMeta.coherence_issues = rpt.issues?.length || 0;
        atlasMeta.major_issues = rpt.major_issues_for_review || [];
      } catch { /* ignore */ }
    }
    // Extract title from H1 tag in article.html (most reliable source for ATLAS)
    const atlasHtmlPath = path.join(articleDir, "article.html");
    if (fs.existsSync(atlasHtmlPath)) {
      try {
        const atlasHtml = fs.readFileSync(atlasHtmlPath, "utf-8");
        const h1Match = atlasHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match) atlasMeta.title = h1Match[1].replace(/<[^>]+>/g, "").trim();
      } catch { /* ignore */ }
    }
    result.meta = atlasMeta;
  } else {
    const metaPath = path.join(articleDir, "meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        result.meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      } catch { result.meta = null; }
    }
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
 * PUT /api/article — Save edited article HTML and/or title back to disk.
 *
 * Body: { slug, html?, title? }
 * At least one of html or title must be provided.
 */
export async function PUT(req: NextRequest) {
  await getSession();
  const body = await req.json();
  const { slug, html, title } = body as { slug?: string; html?: string; title?: string };

  if (!slug || (!html && !title)) {
    return new Response(JSON.stringify({ error: "slug and at least one of html or title are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "");

  // Check CG dir, news subdir, then ATLAS
  let articleDir = path.join(OUTPUT_DIR, safeSlug);
  if (!fs.existsSync(articleDir)) {
    const newsDir = path.join(OUTPUT_DIR, "news", safeSlug);
    if (fs.existsSync(newsDir)) {
      articleDir = newsDir;
    } else {
      const atlasDir = path.join(ATLAS_OUTPUT_DIR, safeSlug);
      if (fs.existsSync(atlasDir)) {
        articleDir = atlasDir;
      } else {
        return new Response(JSON.stringify({ error: "Article not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  if (html) {
    fs.writeFileSync(path.join(articleDir, "article.html"), html, "utf-8");
  }

  // Update title in meta.json if provided
  if (title) {
    const metaPath = path.join(articleDir, "meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        meta.title = title;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
      } catch { /* ignore — meta.json may not exist for ATLAS */ }
    }
  }

  return new Response(JSON.stringify({ ok: true, slug: safeSlug }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * DELETE /api/article?slug=some-article — Remove article folder from disk.
 */
export async function DELETE(req: NextRequest) {
  await getSession();
  const slug = req.nextUrl.searchParams.get("slug");

  if (!slug) {
    return new Response(JSON.stringify({ error: "slug is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "");

  // Check CG dir, news subdir, then ATLAS
  let articleDir = path.join(OUTPUT_DIR, safeSlug);
  if (!fs.existsSync(articleDir)) {
    const newsDir = path.join(OUTPUT_DIR, "news", safeSlug);
    if (fs.existsSync(newsDir)) {
      articleDir = newsDir;
    } else {
      const atlasDir = path.join(ATLAS_OUTPUT_DIR, safeSlug);
      if (fs.existsSync(atlasDir)) {
        articleDir = atlasDir;
      } else {
        return new Response(JSON.stringify({ error: "Article not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  fs.rmSync(articleDir, { recursive: true, force: true });

  return new Response(JSON.stringify({ ok: true, slug: safeSlug }), {
    headers: { "Content-Type": "application/json" },
  });
}
