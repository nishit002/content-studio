import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/server/session";

const bodySchema = z.object({ url: z.string().url() });

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Check = {
  id: string;
  label: string;
  category: "discovery" | "structure" | "content" | "technical" | "rendering";
  pass: boolean;
  value: string;
  detail: string;
};

async function tryFetch(url: string): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "ContentStudio-AEO/1.0" }, cache: "no-store", redirect: "follow" });
    const text = res.ok ? await res.text() : "";
    return { ok: res.ok, text, status: res.status };
  } catch {
    return { ok: false, text: "", status: 0 };
  }
}

export async function POST(req: NextRequest) {
  void req;
  await getSession();

  try {
    const { url } = bodySchema.parse(await req.json());
    const target = new URL(url);
    const checks: Check[] = [];

    const pageRes = await tryFetch(url);
    if (!pageRes.ok) return NextResponse.json({ error: `Unable to fetch page (${pageRes.status})` }, { status: 400 });

    const html = pageRes.text;
    const plain = stripHtml(html);

    const [llmsRes, llmsFullRes, robotsRes, sitemapRes] = await Promise.all([
      tryFetch(`${target.origin}/llms.txt`),
      tryFetch(`${target.origin}/llms-full.txt`),
      tryFetch(`${target.origin}/robots.txt`),
      tryFetch(`${target.origin}/sitemap.xml`),
    ]);

    // ── DISCOVERY ──────────────────────────────────────────────────────────

    checks.push({ id: "llms_txt", label: "llms.txt", category: "discovery", pass: llmsRes.ok, value: llmsRes.ok ? "Present" : "Missing", detail: llmsRes.ok ? `Found at ${target.origin}/llms.txt (${llmsRes.text.length} bytes)` : "No llms.txt found. This file tells AI models about your site's purpose and preferred content." });

    checks.push({ id: "llms_full_txt", label: "llms-full.txt", category: "discovery", pass: llmsFullRes.ok, value: llmsFullRes.ok ? "Present" : "Missing", detail: llmsFullRes.ok ? `Found at ${target.origin}/llms-full.txt (${llmsFullRes.text.length} bytes)` : "No llms-full.txt found. This extended file provides detailed context for AI models." });

    const aiBots = ["gptbot", "chatgpt-user", "claudebot", "anthropic-ai", "google-extended", "googleother", "cohere-ai", "perplexitybot", "ccbot"];
    const blockedBots: string[] = [];
    const allowedBots: string[] = [];
    if (robotsRes.ok) {
      for (const bot of aiBots) {
        if (new RegExp(`user-agent:\\s*${bot}[\\s\\S]*?disallow:\\s*/`, "i").test(robotsRes.text)) blockedBots.push(bot);
        else allowedBots.push(bot);
      }
    }
    checks.push({ id: "robots_ai_access", label: "AI Bot Access (robots.txt)", category: "discovery", pass: robotsRes.ok && blockedBots.length <= 2, value: robotsRes.ok ? `${blockedBots.length} blocked / ${aiBots.length} checked` : "No robots.txt", detail: robotsRes.ok ? blockedBots.length > 0 ? `Blocked: ${blockedBots.join(", ")}. Allowed: ${allowedBots.slice(0, 5).join(", ")}` : "All major AI bots allowed." : "No robots.txt — AI bots will default to crawling all pages." });

    const hasSitemap = sitemapRes.ok && sitemapRes.text.includes("<url");
    const sitemapUrlCount = (sitemapRes.text.match(/<url>/gi) ?? []).length;
    checks.push({ id: "sitemap", label: "XML Sitemap", category: "discovery", pass: hasSitemap, value: hasSitemap ? `${sitemapUrlCount} URLs` : "Missing", detail: hasSitemap ? `Sitemap found with ${sitemapUrlCount} URL entries.` : "No sitemap.xml found." });

    // ── STRUCTURE ─────────────────────────────────────────────────────────

    const jsonLdBlocks = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
    const schemaTypes: string[] = [];
    for (const block of jsonLdBlocks) {
      try {
        const parsed = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, ""));
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item?.["@type"]) schemaTypes.push(...(Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]));
        }
      } catch { /* skip */ }
    }
    checks.push({ id: "json_ld", label: "JSON-LD Structured Data", category: "structure", pass: jsonLdBlocks.length > 0, value: jsonLdBlocks.length > 0 ? `${jsonLdBlocks.length} blocks (${schemaTypes.length} types)` : "None", detail: schemaTypes.length > 0 ? `Schema types: ${[...new Set(schemaTypes)].join(", ")}` : "No JSON-LD found. Add Organization, FAQPage, or Article schema." });

    const hasFaqSchema = schemaTypes.some((t) => /faq/i.test(t));
    const hasFaqHtml = /<details|<summary|class="faq"|id="faq"/i.test(html);
    checks.push({ id: "faq_schema", label: "FAQ / Q&A Schema", category: "structure", pass: hasFaqSchema || hasFaqHtml, value: hasFaqSchema ? "Schema present" : hasFaqHtml ? "HTML only" : "Missing", detail: hasFaqSchema ? "FAQPage schema found — AI models can extract Q&A pairs." : hasFaqHtml ? "FAQ HTML found but no FAQPage schema. Add JSON-LD FAQPage schema." : "No FAQ content detected. FAQ schema dramatically improves AI answer citations." });

    const ogTitle = /og:title/i.test(html);
    const ogDesc = /og:description/i.test(html);
    const ogImage = /og:image/i.test(html);
    const ogComplete = ogTitle && ogDesc && ogImage;
    const ogTags = html.match(/<meta[^>]*property=["']og:[^"']*["'][^>]*>/gi) ?? [];
    checks.push({ id: "open_graph", label: "Open Graph Tags", category: "structure", pass: ogComplete, value: `${ogTags.length} tags${ogComplete ? " (complete)" : ""}`, detail: ogComplete ? "og:title, og:description, and og:image all present." : `Missing: ${[!ogTitle && "og:title", !ogDesc && "og:description", !ogImage && "og:image"].filter(Boolean).join(", ")}` });

    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const metaDesc = metaDescMatch?.[1] ?? "";
    const metaDescOk = metaDesc.length >= 50 && metaDesc.length <= 300;
    checks.push({ id: "meta_description", label: "Meta Description", category: "structure", pass: metaDescOk, value: metaDesc ? `${metaDesc.length} chars` : "Missing", detail: metaDesc ? metaDescOk ? `Good length (${metaDesc.length} chars)` : `Length ${metaDesc.length} — aim for 50–160 chars.` : "No meta description found." });

    const hasCanonical = /<link[^>]*rel=["']canonical["']/i.test(html);
    checks.push({ id: "canonical", label: "Canonical Tag", category: "structure", pass: hasCanonical, value: hasCanonical ? "Present" : "Missing", detail: hasCanonical ? "Canonical tag found." : "No canonical tag. Add one to prevent duplicate content issues." });

    // ── CONTENT ───────────────────────────────────────────────────────────

    const firstChunk = plain.slice(0, Math.floor(Math.max(plain.length * 0.2, 400)));
    const bulletCount = (html.match(/<li\b/gi) ?? []).length;
    const hasDirectAnswer = /\b(in short|tl;dr|summary|key takeaways|bottom line|the answer is|here('?s| is) (what|how|why))\b/i.test(firstChunk);
    const blufScore = Math.min(1, (Number(hasDirectAnswer) + Number(bulletCount > 3) + Number(firstChunk.length > 100)) / 2);
    checks.push({ id: "bluf_style", label: "BLUF / Direct-Answer Style", category: "content", pass: blufScore >= 0.5, value: `${Math.round(blufScore * 100)}%`, detail: hasDirectAnswer ? "Content leads with a direct answer — good for AI citation." : "Content doesn't lead with a clear answer. Start with a BLUF (Bottom Line Up Front) statement." });

    const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
    const h2Count = (html.match(/<h2[\s>]/gi) ?? []).length;
    const h3Count = (html.match(/<h3[\s>]/gi) ?? []).length;
    checks.push({ id: "heading_hierarchy", label: "Heading Hierarchy", category: "content", pass: h1Count === 1 && h2Count >= 2, value: `H1:${h1Count} H2:${h2Count} H3:${h3Count}`, detail: h1Count === 0 ? "No H1 tag found." : h1Count > 1 ? `${h1Count} H1 tags — use exactly one.` : h2Count < 2 ? "Need at least 2 H2 subheadings." : "Good heading hierarchy." });

    const wordCount = plain.split(/\s+/).filter(Boolean).length;
    checks.push({ id: "content_length", label: "Content Depth", category: "content", pass: wordCount >= 300, value: `${wordCount.toLocaleString()} words`, detail: wordCount >= 2000 ? "Comprehensive content — great for in-depth AI citations." : wordCount >= 300 ? "Adequate content length." : "Thin content — AI models prefer 300+ words for citation." });

    const internalLinkPattern = new RegExp(`<a[^>]*href=["'](?:https?://(?:www\\.)?${target.hostname.replace(/\./g, "\\.")})?/[^"']*["']`, "gi");
    const internalLinks = (html.match(internalLinkPattern) ?? []).length;
    checks.push({ id: "internal_links", label: "Internal Links", category: "content", pass: internalLinks >= 3, value: `${internalLinks} links`, detail: internalLinks >= 3 ? "Good internal linking." : "Add 3+ internal links to help AI models discover related content." });

    // ── TECHNICAL ─────────────────────────────────────────────────────────

    const isHttps = target.protocol === "https:";
    checks.push({ id: "https", label: "HTTPS", category: "technical", pass: isHttps, value: isHttps ? "Yes" : "No", detail: isHttps ? "Site uses HTTPS." : "Site is not using HTTPS — hurts trust signals." });

    const pageSizeKb = Math.round(html.length / 1024);
    checks.push({ id: "page_size", label: "Page Size", category: "technical", pass: pageSizeKb < 500, value: `${pageSizeKb} KB`, detail: pageSizeKb < 500 ? "Page size is reasonable." : "Page is large (>500 KB). Heavy pages may timeout AI crawlers." });

    const langMatch = html.match(/<html[^>]*lang=["']([^"']+)["']/i);
    checks.push({ id: "lang_tag", label: "Language Attribute", category: "technical", pass: !!langMatch, value: langMatch ? langMatch[1] : "Missing", detail: langMatch ? `Language: "${langMatch[1]}"` : 'No lang attribute on <html>. Add lang="en".' });

    // ── RENDERING ─────────────────────────────────────────────────────────

    const csrSignals = [
      { name: "React CSR", pattern: /<div\s+id=["'](root|app|__next)["'][^>]*>\s*<\/div>/i },
      { name: "Vue CSR", pattern: /<div\s+id=["'](app|__vue_app__)["'][^>]*>\s*<\/div>/i },
      { name: "Angular", pattern: /<app-root[^>]*>\s*<\/app-root>/i },
    ];
    const detectedCsr = csrSignals.filter((s) => s.pattern.test(html)).map((s) => s.name);
    const textToHtmlRatio = plain.length / Math.max(html.length, 1);
    const hasMinimalContent = plain.length < 200 && html.length > 2000;
    const likelyCsr = detectedCsr.length > 0 && (hasMinimalContent || textToHtmlRatio < 0.02);
    const hasSsrMarkers = /__NEXT_DATA__/i.test(html) || /data-reactroot/i.test(html);
    checks.push({ id: "csr_detection", label: "Client-Side Rendering", category: "rendering", pass: !likelyCsr || hasSsrMarkers, value: likelyCsr ? hasSsrMarkers ? "CSR + SSR markers" : `Likely CSR (${detectedCsr.join(", ")})` : "Server-rendered", detail: likelyCsr && !hasSsrMarkers ? `${detectedCsr.join(", ")} detected with minimal server text. LLM bots cannot execute JS — use SSR/SSG.` : `Server-rendered content (${plain.length.toLocaleString()} chars, ${(textToHtmlRatio * 100).toFixed(1)}% text ratio).` });

    const hasNoscript = /<noscript[\s>]/i.test(html);
    const noscriptContent = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i)?.[1] ?? "";
    const noscriptHasContent = stripHtml(noscriptContent).length > 20;
    checks.push({ id: "noscript_fallback", label: "Noscript Fallback", category: "rendering", pass: hasNoscript && noscriptHasContent, value: hasNoscript ? noscriptHasContent ? "Has content" : "Empty" : "Missing", detail: hasNoscript && noscriptHasContent ? "<noscript> with fallback content found." : "No meaningful <noscript> fallback. Add one for bots that don't run JS." });

    const scriptTags = html.match(/<script[^>]*src=["'][^"']+["'][^>]*>/gi) ?? [];
    const inlineScripts = html.match(/<script(?![^>]*src=)[\s\S]*?<\/script>/gi) ?? [];
    const totalInlineKb = Math.round(inlineScripts.reduce((sum, s) => sum + s.length, 0) / 1024);
    const jsHeavy = scriptTags.length > 15 || totalInlineKb > 100;
    checks.push({ id: "js_bundle_weight", label: "JavaScript Weight", category: "rendering", pass: !jsHeavy, value: `${scriptTags.length} external, ${totalInlineKb}KB inline`, detail: jsHeavy ? `Heavy JS: ${scriptTags.length} external scripts + ${totalInlineKb}KB inline. LLM bots may see partial content.` : `Reasonable JS footprint.` });

    const hasSemanticHtml = /<(article|main|section)[\s>]/i.test(html);
    const serverContentOk = plain.length > 500 && hasSemanticHtml;
    checks.push({ id: "server_content_quality", label: "Server-Rendered Content Quality", category: "rendering", pass: serverContentOk, value: serverContentOk ? `${plain.length.toLocaleString()} chars` : `${plain.length} chars`, detail: serverContentOk ? `${plain.length.toLocaleString()} chars with semantic HTML — LLM bots can extract meaningful content.` : plain.length <= 500 ? "Very little server-rendered text. Ensure key content is SSR, not JS-injected." : "Lacks semantic structure (<article>, <main>, <section>)." });

    const passed = checks.filter((c) => c.pass).length;
    const score = Math.round((passed / checks.length) * 100);
    const schemaMentions = jsonLdBlocks.length + (html.match(/schema\.org/gi) ?? []).length;

    // ── SWOT + Fixes via OpenRouter ───────────────────────────────────────
    let swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] } | null = null;
    let fixes: Array<{ title: string; priority: string; impact: string; action: string }> = [];

    const openrouterKey = process.env.OPENROUTER_KEY;
    if (openrouterKey) {
      try {
        const passList = checks.filter(c => c.pass).map(c => `✓ ${c.label}`).join(", ");
        const failList = checks.filter(c => !c.pass).map(c => `✗ ${c.label}: ${c.detail}`).join("\n");

        const swotPrompt = `You are an AEO (Answer Engine Optimization) expert. Based on this website audit result, generate a SWOT analysis and top 3 fix recommendations.

URL: ${url}
AEO Score: ${score}/100
Passed checks: ${passList}

Failed checks:
${failList || "None"}

Return ONLY a JSON object (no other text):
{
  "swot": {
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"],
    "opportunities": ["opportunity 1", "opportunity 2"],
    "threats": ["threat 1", "threat 2"]
  },
  "fixes": [
    {
      "title": "Short fix title",
      "priority": "high|medium|low",
      "impact": "Estimated impact (e.g. +15-20 AEO score points)",
      "action": "Specific 1-sentence action to take"
    }
  ]
}

Rules:
- Generate exactly 2-3 items per SWOT quadrant
- Generate exactly 3 fixes ordered by priority (highest first)
- Base everything on the actual check results above
- Be specific and actionable — no generic advice`;

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "moonshotai/kimi-k2.5",
            messages: [{ role: "user", content: swotPrompt }],
            max_tokens: 4000,
            temperature: 0.2,
          }),
        });

        if (res.ok) {
          const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
          const text = data.choices?.[0]?.message?.content ?? "";
          const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
          try {
            const parsed = JSON.parse(match?.[1] ?? text) as { swot?: typeof swot; fixes?: typeof fixes };
            swot = parsed.swot ?? null;
            fixes = parsed.fixes ?? [];
          } catch { /* fallback: no swot/fixes */ }
        }
      } catch { /* swot is optional — don't fail the audit */ }
    }

    return NextResponse.json({ url, score, checks, llmsTxtPresent: llmsRes.ok, schemaMentions, blufDensity: blufScore, pass: { llmsTxt: llmsRes.ok, schema: schemaMentions > 0, bluf: blufScore >= 0.5 }, swot, fixes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
