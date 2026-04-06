import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getApiKeys } from "@/lib/server/db";
import fs from "fs";
import path from "path";

const PIPELINE_DIR = process.env.PIPELINE_DIR || path.resolve("/Volumes/NISHIT_PD/gas new/gas-split/content-generator");
const OUTPUT_DIR = path.join(PIPELINE_DIR, "output");
const ATLAS_DIR = process.env.ATLAS_DIR || path.resolve("/Volumes/NISHIT_PD/content-studio/smart-writer");
const ATLAS_OUTPUT_DIR = path.join(ATLAS_DIR, "output");

/**
 * POST /api/publish — Publish article to WordPress.
 *
 * Body: { title, content, slug, coverImageUrl?, status?, category? }
 */
export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const body = await req.json();
  let { title, content, slug, coverImageUrl, status, category } = body as {
    title: string;
    content: string;
    slug: string;
    coverImageUrl?: string;
    status?: string;
    category?: string;
  };

  // Slug-only mode: read article HTML + title from disk
  if (slug && !content) {
    const safeSlug = slug.replace(/[^a-z0-9-]/gi, "");
    let articleDir = path.join(OUTPUT_DIR, safeSlug);
    if (!fs.existsSync(articleDir)) {
      const newsDir = path.join(OUTPUT_DIR, "news", safeSlug);
      if (fs.existsSync(newsDir)) {
        articleDir = newsDir;
      } else {
        const atlasDir = path.join(ATLAS_OUTPUT_DIR, safeSlug);
        if (fs.existsSync(atlasDir)) articleDir = atlasDir;
      }
    }
    const htmlPath = path.join(articleDir, "article.html");
    if (!fs.existsSync(htmlPath)) {
      return NextResponse.json({ error: "Article HTML not found on disk" }, { status: 404 });
    }
    content = fs.readFileSync(htmlPath, "utf-8");
    if (!title) {
      const metaPath = path.join(articleDir, "meta.json");
      if (fs.existsSync(metaPath)) {
        try { title = JSON.parse(fs.readFileSync(metaPath, "utf-8")).title || slug; } catch { title = slug; }
      } else { title = slug; }
    }
  }

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  // Get WordPress credentials from session
  const keys = getApiKeys(sessionId);
  const wpKey = keys.find((k) => k.provider === "wordpress");
  if (!wpKey) {
    return NextResponse.json({ error: "WordPress not configured. Add WordPress API key in Configuration." }, { status: 400 });
  }

  const [siteUrl, username, appPassword] = wpKey.key_value.split("|");
  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: "Invalid WordPress config. Need url|username|app_password." }, { status: 400 });
  }

  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  try {
    // Step 1: Upload cover image if provided
    let featuredMediaId: number | undefined;
    if (coverImageUrl) {
      featuredMediaId = await uploadCoverImage(siteUrl, authHeader, coverImageUrl, slug);
    }

    // Step 2: Resolve category if provided
    let categoryId: number | undefined;
    if (category) {
      categoryId = await resolveCategory(siteUrl, authHeader, category);
    }

    // Step 3: Strip H1 from content (WP renders title separately)
    const cleanContent = content.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");

    // Step 4: Create the post
    const postData: Record<string, unknown> = {
      title,
      content: cleanContent,
      slug: slug || undefined,
      status: status || "draft",
    };
    if (featuredMediaId) postData.featured_media = featuredMediaId;
    if (categoryId) postData.categories = [categoryId];

    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(postData),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `WordPress error: ${res.status} — ${err.slice(0, 300)}` }, { status: 502 });
    }

    const post = await res.json();
    return NextResponse.json({
      ok: true,
      post_id: post.id,
      post_url: post.link,
      edit_url: `${siteUrl}/wp-admin/post.php?post=${post.id}&action=edit`,
      status: post.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/* ── Upload cover image from URL ── */
async function uploadCoverImage(siteUrl: string, authHeader: string, imageUrl: string, slug: string): Promise<number | undefined> {
  try {
    // Fetch the image
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) return undefined;

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // Upload to WordPress media library
    const uploadRes = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${slug}-cover.${ext}"`,
      },
      body: buffer,
      signal: AbortSignal.timeout(30000),
    });

    if (!uploadRes.ok) return undefined;
    const media = await uploadRes.json();
    return media.id;
  } catch {
    return undefined;
  }
}

/* ── Resolve category name to ID ── */
async function resolveCategory(siteUrl: string, authHeader: string, categoryName: string): Promise<number | undefined> {
  try {
    const res = await fetch(
      `${siteUrl}/wp-json/wp/v2/categories?search=${encodeURIComponent(categoryName)}&per_page=5`,
      { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return undefined;
    const cats = await res.json();
    const match = cats.find((c: { name: string }) => c.name.toLowerCase() === categoryName.toLowerCase());
    return match?.id;
  } catch {
    return undefined;
  }
}
