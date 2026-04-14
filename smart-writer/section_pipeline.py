"""
section_pipeline.py — Fanout-driven section-by-section research+write pipeline.

Architecture (replaces 12-stage atlas.py for new articles):

  1. fanout.generate_outline(topic)  → section plan (headings + intents)
  2. One Gemini call generates targeted search queries per section
  3. Batch You.com search for ALL sections at once
  4. Per section (parallel, 3 workers):
       a. Fetch top pages (skip Reddit/Quora as fact sources)
       b. Extract user questions from Reddit/Quora search snippets (intent signals only)
       c. Gemini: extract + verify facts for THIS section from pages
       d. Write section HTML in format determined by what data came back
          (table-dominant / list-dominant / prose-dominant)
  5. Write FAQ from all user questions collected across sections
  6. Assemble and return article HTML

Key differences from atlas.py:
  - Section heading drives research (not a pre-planned blueprint)
  - Format determined by actual data shape (not format_hint)
  - Reddit/Quora = intent signals only (question titles, not fact sources)
  - FAQ built from real questions found during research
  - No thin-section problem: if data is sparse, section is short (no LLM padding)
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import json
import logging
import re
from pathlib import Path

from llm_client import GeminiClient

log = logging.getLogger("section_pipeline")

# ── Reddit/Quora intent signal extraction ────────────────────────────────────

_QUESTION_DOMAINS = {"reddit.com", "quora.com"}
_QUESTION_RE = re.compile(
    r"^(can|how|what|why|when|which|is|does|do|should|are|will|where)\b",
    re.IGNORECASE,
)


def _extract_user_questions(section_search: dict[str, list[dict]]) -> list[str]:
    """
    Pull user questions from Reddit/Quora result titles.
    These are intent signals — NOT fact sources.
    """
    questions = []
    for results in section_search.values():
        for r in results:
            url = r.get("url", "")
            title = r.get("title", "").strip()
            domain = url.split("/")[2].lstrip("www.") if url.count("/") >= 2 else ""
            if domain in _QUESTION_DOMAINS and title:
                clean = re.sub(r"\s*[-|]\s*(Reddit|Quora|r/\w+).*$", "", title, flags=re.I).strip()
                if len(clean) > 15 and _QUESTION_RE.match(clean) and clean not in questions:
                    questions.append(clean)
    return questions[:5]


# ── Section query generation ──────────────────────────────────────────────────

_QUERY_GEN_PROMPT = """\
Generate 3 targeted search queries for each article section below.

Topic: {topic}
Entity type: {entity_type}

Sections:
{sections_json}

Rules:
1. Each query must be specific to the section heading — not the generic topic
2. Include one query targeting official/authoritative pages (official body name, or site:gov.in)
3. Include one query with specific data keywords (year, numbers, cutoff, rank, fee amount)
4. 6-12 words per query. Factual, no question format.
5. Do NOT add site:reddit.com or site:quora.com.

Return JSON:
{
  "sections": [
    {"heading": "...", "queries": ["q1", "q2", "q3"]},
    ...
  ]
}"""


def _generate_section_queries(
    topic: str, entity_type: str, sections: list
) -> dict[str, list[str]]:
    """
    One Gemini call → targeted search queries for every section.
    Falls back to heading-based queries on failure.
    """
    sections_data = [{"heading": s.heading, "seo_intent": s.seo_intent} for s in sections]
    client = GeminiClient()
    try:
        prompt = (_QUERY_GEN_PROMPT
                   .replace("{topic}", topic)
                   .replace("{entity_type}", entity_type)
                   .replace("{sections_json}", json.dumps(sections_data, indent=2)))
        result = client.generate_json(
            prompt,
            temperature=0.2,
            max_tokens=2048,
        )
        out = {}
        for item in result.get("sections", []):
            h = item.get("heading", "")
            qs = item.get("queries", [])
            if h and qs:
                out[h] = qs[:3]
        # Fill in any missing sections
        for s in sections:
            if s.heading not in out:
                out[s.heading] = [f"{topic} {s.heading}"]
        return out
    except Exception as e:
        log.warning("Query generation failed: %s — using fallback", e)
        return {s.heading: [f"{topic}: {s.heading}", s.heading] for s in sections}


# ── Page fetching ─────────────────────────────────────────────────────────────

_SKIP_DOMAINS = {
    "reddit.com", "quora.com", "youtube.com", "facebook.com",
    "twitter.com", "instagram.com", "linkedin.com",
    "shiksha.com", "collegedunia.com", "careers360.com",  # aggregators
}


def _fetch_pages_for_section(
    queries: list[str],
    search_results: dict[str, list[dict]],
    pages_dir: Path,
    primary_entity: str,
) -> tuple[str, str]:
    """
    Fetch top pages for a section. Returns (combined_text, snippets_text).
    Reddit/Quora skipped for page fetching (used only for question signals).
    """
    from researcher import _fetch_url

    pages_dir.mkdir(parents=True, exist_ok=True)

    seen_urls: set[str] = set()
    candidate_urls: list[str] = []
    snippet_parts: list[str] = []

    for query in queries:
        for r in search_results.get(query, []):
            url = r.get("url", "")
            title = r.get("title", "")
            desc = r.get("description", "")

            # Collect snippets (including Reddit/Quora for intent signals)
            if title or desc:
                snippet_parts.append(f"{title}: {desc}")

            # Skip non-page URLs or already seen
            if not url or url in seen_urls:
                continue
            domain = url.split("/")[2].lstrip("www.") if url.count("/") >= 2 else ""
            if any(s in domain for s in _SKIP_DOMAINS):
                continue

            seen_urls.add(url)
            candidate_urls.append(url)
            if len(candidate_urls) >= 5:
                break
        if len(candidate_urls) >= 5:
            break

    snippets_text = "\n".join(snippet_parts[:20])[:6000]

    # Fetch pages in parallel
    text_parts: list[str] = []

    def _fetch_one(url: str) -> str:
        try:
            result = _fetch_url(url, primary_entity, pages_dir)
            if result is None:
                return ""
            page, markdown = result
            if markdown and len(markdown) > 200:
                return markdown[:8000]
            if page.clean_text and len(page.clean_text) > 200:
                return page.clean_text[:8000]
            return ""
        except Exception as e:
            log.debug("Fetch failed %s: %s", url[:60], e)
            return ""

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        fetched = list(pool.map(_fetch_one, candidate_urls[:5]))
    text_parts = [t for t in fetched if t]

    combined = "\n\n".join(text_parts)[:28000]
    return combined, snippets_text


# ── Per-section data extraction ───────────────────────────────────────────────

_EXTRACT_PROMPT = """\
Extract data from source text to fully answer this article section.

Topic: {topic}
Section heading: {heading}
Section intent: {seo_intent}
What this section must answer: {what_to_answer}

SOURCE TEXT (official pages + search snippets):
{source_text}

EXTRACT:
1. Facts directly relevant to this heading (field + exact value from source)
2. Tables that belong to this section — ONLY if title/columns match this heading
   Tables with <3 rows: skip (will become bullet list automatically)
3. Specific numbers, dates, names — exact as they appear in source

RELEVANCE RULE: Only extract content that answers "{heading}". Skip off-topic content.

Return JSON:
{
  "facts": [
    {"field": "...", "value": "...", "verified": true, "snippet": "..."}
  ],
  "tables": [
    {"title": "...", "columns": [...], "rows": [[...], ...]}
  ],
  "user_questions": ["actual question from Reddit/Quora title about this section"],
  "data_shape": "table-dominant|list-dominant|prose-dominant"
}

data_shape rules:
  table-dominant  → has 1+ table with 3+ rows of real data
  list-dominant   → 5+ distinct key-value facts, no big table
  prose-dominant  → narrative facts without clear table/list structure"""

_WHAT_TO_ANSWER = {
    "informational": "key facts, context, numbers",
    "table-data":    "structured data tables with specific numbers and comparisons",
    "how-to":        "step-by-step process the user needs to follow",
    "comparison":    "side-by-side comparison with specific numbers per option",
    "faq":           "common user questions and direct answers",
}


def _extract_section_data(
    topic: str, section, source_text: str, snippets: str
) -> dict:
    """Gemini extraction for one section. Returns facts + tables + data_shape."""
    what = _WHAT_TO_ANSWER.get(section.seo_intent, f"all data relevant to {section.heading}")
    full_source = source_text
    if snippets and len(full_source) < 20000:
        full_source += f"\n\n=== Search Snippets ===\n{snippets}"

    if not full_source.strip():
        return {"facts": [], "tables": [], "user_questions": [], "data_shape": "prose-dominant"}

    client = GeminiClient()
    try:
        # Use explicit replace instead of .format() to avoid mangling JSON braces in template
        prompt = (_EXTRACT_PROMPT
                  .replace("{topic}", topic)
                  .replace("{heading}", section.heading)
                  .replace("{seo_intent}", section.seo_intent)
                  .replace("{what_to_answer}", what)
                  .replace("{source_text}", full_source[:28000]))
        return client.generate_json(
            prompt,
            temperature=0.0,
            max_tokens=8192,
        )
    except Exception as e:
        log.warning("Extraction failed '%s': %s", section.heading[:50], e)
        return {"facts": [], "tables": [], "user_questions": [], "data_shape": "prose-dominant"}


# ── Per-section HTML writing ──────────────────────────────────────────────────

_WRITE_PROMPT = """\
Write HTML for ONE article section using ONLY the verified data below.
Section heading (DO NOT include this in your output — it will be added automatically): {heading}
Data shape: {data_shape}
Focus keyword (use 1-2 times): {focus_keyword}

VERIFIED DATA:
{data_block}

FORMAT based on data_shape — start DIRECTLY with content (NO <h2> tag):
  table-dominant → <table class="data-table"> (ALL rows, proper <thead>/<tbody>),
                   then ONE <p> with key takeaway. Never two <p> in a row.
  list-dominant  → <p> (single most important fact, 1-2 sentences),
                   then <ul> with all key facts as <li><strong>field:</strong> value</li>
  prose-dominant → ALTERNATING: <p> (2-3 sentences, 1 data point)
                   then <ul> or <table> then <p> — NEVER two consecutive <p>

HARD RULES:
1. ONLY facts from VERIFIED DATA — zero invented statistics.
2. NEVER two consecutive <p> tags.
3. All numbers must match source exactly.
4. Tables need <thead><tr><th> headers + <tbody><tr><td> rows.
5. No <html>/<body>/<head>/<h2>. Raw content HTML only — heading is prepended automatically.

Write the content HTML now (no heading):"""


def _build_data_block(extracted: dict) -> str:
    """Convert extraction result to a data block string for the writer."""
    parts = []
    for f in extracted.get("facts", []):
        if f.get("value"):
            parts.append(f"  {f.get('field', '?')}: {f['value']}")

    for tbl in extracted.get("tables", []):
        rows = tbl.get("rows", [])
        cols = tbl.get("columns", [])
        if not cols or not rows:
            continue
        # Tables with <3 rows → render as key-value list in data block
        if len(rows) < 3:
            for row in rows:
                kv = " | ".join(str(c) for c in row)
                parts.append(f"  {tbl.get('title', 'Item')}: {kv}")
        else:
            parts.append(f"\nTable: {tbl.get('title', 'Data')}")
            parts.append("  Columns: " + " | ".join(cols))
            for row in rows[:30]:
                parts.append("  Row: " + " | ".join(str(c) for c in row))
            if len(rows) > 30:
                parts.append(f"  ... ({len(rows) - 30} more rows)")

    return "\n".join(parts) if parts else ""


def _write_section(section, extracted: dict, focus_keyword: str) -> str:
    """Write one section's HTML. Heading is always prepended from outline — LLM writes content only."""
    data_block = _build_data_block(extracted)
    if not data_block:
        log.info("  Section '%s': no data — skipping", section.heading[:50])
        return ""

    data_shape = extracted.get("data_shape", "prose-dominant")
    client = GeminiClient()
    try:
        html = client.generate(
            _WRITE_PROMPT.format(
                heading=section.heading,
                data_shape=data_shape,
                focus_keyword=focus_keyword,
                data_block=data_block,
            ),
            temperature=0.3,
            max_tokens=6000,
        )
        html = re.sub(r"^```[a-zA-Z]*\s*\n", "", html.strip())
        html = re.sub(r"\n```\s*$", "", html).strip()
        # Strip any h2/h3 the LLM added at the top (heading comes from outline, not LLM)
        html = re.sub(r"^\s*<h[2-6][^>]*>.*?</h[2-6]>\s*", "", html, count=1, flags=re.DOTALL | re.IGNORECASE)
        html = html.strip()
        # Always prepend the definitive section heading from the outline
        return f"<h2>{section.heading}</h2>\n{html}"
    except Exception as e:
        log.warning("Write failed '%s': %s", section.heading[:50], e)
        return f"<h2>{section.heading}</h2>\n<p>Content coming soon.</p>"


# ── FAQ Module (supplementary — intent-driven + researched answers) ───────────

_FAQ_QGEN_PROMPT = """\
Generate FAQ questions for an article about: TOPIC_PLACEHOLDER

Questions already found from Reddit/Quora research:
EXISTING_PLACEHOLDER

Generate 6-8 FAQ questions that real students or users actually ask about "TOPIC_PLACEHOLDER".
Cover these intent types (at least one each):
- what/definition: basic "what is" questions
- how-to: process or steps
- eligibility/requirement: who can, minimum marks, age limit
- comparison: vs, difference, better than
- outcome: after exam, career scope, next steps
- dates/schedule: when, registration, result timeline

Include the already-found questions above (deduplicated), then add more to reach 6-8 total.

Return ONLY valid JSON:
{"questions": ["Question 1?", "Question 2?"]}

Rules:
- Each question 8-15 words, must end with ?
- Specific to TOPIC_PLACEHOLDER — no generic questions
- No duplicate intent
"""

_FAQ_ANSWER_PROMPT = """\
Answer this FAQ question about TOPIC_PLACEHOLDER concisely.

Question: QUESTION_PLACEHOLDER

Research snippets (use as factual basis — do not invent data not present here):
SNIPPETS_PLACEHOLDER

Write a direct 2-4 sentence answer. Be specific. Use numbers/facts from snippets where available.
If the research lacks a specific answer, give a helpful general answer and recommend the official source.
Do NOT use bullet points. Plain prose only.
Do NOT start with "Based on the research" or "According to snippets".
"""


def _generate_faq_questions(topic: str, existing: list[str]) -> list[str]:
    """Use Gemini to generate 6-8 intent-driven FAQ questions."""
    client = GeminiClient()
    prompt = (_FAQ_QGEN_PROMPT
              .replace("TOPIC_PLACEHOLDER", topic)
              .replace("EXISTING_PLACEHOLDER",
                       "\n".join(f"- {q}" for q in existing) if existing else "None collected yet."))
    try:
        result = client.generate_json(prompt, temperature=0.3, max_tokens=800)
        if isinstance(result, dict) and "questions" in result:
            qs = [q.strip() for q in result["questions"] if isinstance(q, str) and len(q.strip()) > 10]
            return qs[:8]
    except Exception as e:
        log.warning("FAQ question generation failed: %s", e)
    base = list(existing[:4])
    if not any("what" in q.lower() for q in base):
        base.insert(0, f"What is {topic}?")
    return base


def _research_faq_questions(topic: str, questions: list[str]) -> dict[str, str]:
    """Run one You.com search per FAQ question, return question -> snippets text."""
    from researcher import _YouClient
    try:
        researcher = _YouClient()
        results = asyncio.run(researcher.batch_search(questions))
    except Exception as e:
        log.warning("FAQ research failed: %s", e)
        return {}

    out: dict[str, str] = {}
    for q, hits in results.items():
        snippets = []
        for r in hits[:5]:
            desc = r.get("description", "").strip()
            if desc and len(desc) > 30:
                snippets.append(desc)
            for s in r.get("snippets", [])[:2]:
                if s and len(s.strip()) > 30:
                    snippets.append(s.strip())
        out[q] = " ".join(snippets[:4])[:1800]
    return out


def _write_faq(topic: str, collected_questions: list[str]) -> str:
    """
    Supplementary FAQ module:
    1. Generate intent-driven questions from topic + collected signals
    2. Research each question with targeted You.com search
    3. Write each answer from researched snippets (no hallucination)
    4. Assemble HTML + FAQPage schema
    """
    questions = _generate_faq_questions(topic, collected_questions)
    log.info("[faq] %d questions to research+answer", len(questions))

    snippets_map = _research_faq_questions(topic, questions)

    gemini = GeminiClient()

    def _answer_one(q: str) -> tuple[str, str]:
        snippets = snippets_map.get(q, "")
        prompt = (_FAQ_ANSWER_PROMPT
                  .replace("TOPIC_PLACEHOLDER", topic)
                  .replace("QUESTION_PLACEHOLDER", q)
                  .replace("SNIPPETS_PLACEHOLDER", snippets or "No specific snippets available."))
        try:
            ans = gemini.generate(prompt, temperature=0.2, max_tokens=2000)
            return q, ans.strip()
        except Exception as e:
            log.warning("FAQ answer failed for '%s': %s", q[:40], e)
            return q, f"Please refer to the official website for the latest information on {topic}."

    q_to_ans: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(_answer_one, q): q for q in questions}
        for fut in concurrent.futures.as_completed(futs):
            try:
                q, ans = fut.result()
                q_to_ans[q] = ans
            except Exception:
                pass

    answered = [(q, q_to_ans[q]) for q in questions if q in q_to_ans]

    parts = ['<section class="faq-section">', '<h2>Frequently Asked Questions</h2>']
    schema_entities = []
    for q, ans in answered:
        clean_ans = re.sub(r"<[^>]+>", "", ans).strip()
        parts.append(
            f'<div class="faq-item">\n'
            f'  <h3 class="faq-question">{q}</h3>\n'
            f'  <div class="faq-answer"><p>{clean_ans}</p></div>\n'
            f'</div>'
        )
        schema_entities.append({
            "@type": "Question",
            "name": q,
            "acceptedAnswer": {"@type": "Answer", "text": clean_ans}
        })
    parts.append('</section>')
    schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": schema_entities,
    }
    parts.append(
        f'<script type="application/ld+json">\n{json.dumps(schema, ensure_ascii=False, indent=2)}\n</script>'
    )
    return "\n".join(parts)


# ── Intro paragraph (inverted pyramid) ───────────────────────────────────────

_INTRO_PROMPT = """\
Write an opening paragraph for an article about: TOPIC_PLACEHOLDER

Article title (H1): H1_PLACEHOLDER

This article covers these sections:
SECTIONS_PLACEHOLDER

Rules for the opening paragraph (inverted pyramid style):
- Lead with the MOST IMPORTANT fact or direct answer — not "In this article..."
- 2-4 sentences, 60-90 words total
- Weave in the focus keyword "KEYWORD_PLACEHOLDER" naturally in the first sentence
- Final sentence previews what the reader will find in this article (briefly)
- Conversational but authoritative — written for a student searching for this
- No generic openers: "Are you looking for...", "This comprehensive guide...", "Welcome to..."

Write ONLY the <p> tag:"""


def _write_intro(topic: str, h1: str, section_headings: list[str], focus_keyword: str) -> str:
    """Generate an inverted-pyramid SEO opening paragraph after sections are planned."""
    sections_list = "\n".join(f"- {h}" for h in section_headings)
    prompt = (_INTRO_PROMPT
              .replace("TOPIC_PLACEHOLDER", topic)
              .replace("H1_PLACEHOLDER", h1)
              .replace("SECTIONS_PLACEHOLDER", sections_list)
              .replace("KEYWORD_PLACEHOLDER", focus_keyword))
    client = GeminiClient()
    try:
        html = client.generate(prompt, temperature=0.3, max_tokens=1500)
        html = re.sub(r"^```[a-zA-Z]*\s*\n", "", html.strip())
        html = re.sub(r"\n```\s*$", "", html).strip()
        if not html.startswith("<p"):
            html = f"<p>{html}"
        # Auto-close if Gemini truncated before </p>
        if not html.rstrip().endswith("</p>"):
            html = html.rstrip() + "</p>"
        return html
    except Exception as e:
        log.warning("Intro generation failed: %s", e)
        return ""


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run(
    topic: str,
    entity_type: str = "exam",
    run_dir: Path | None = None,
    focus_keyword: str | None = None,
    primary_entity: str | None = None,
) -> str:
    """
    Run the fanout-driven section pipeline.
    Returns assembled article HTML.
    """
    from fanout import generate_outline
    from researcher import _YouClient

    if run_dir is None:
        import tempfile
        run_dir = Path(tempfile.mkdtemp(prefix="sp_"))
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    focus_keyword = focus_keyword or topic
    primary_entity = primary_entity or topic.split()[0]
    pages_dir = run_dir / "pages"

    # ── 1. Generate section plan ──────────────────────────────────────────────
    log.info("[section_pipeline] Generating outline for: %s", topic)
    outline = generate_outline(topic, entity_type)

    # Separate real content sections from FAQ placeholder
    content_sections = [s for s in outline.sections if s.query_type != "faq"]
    log.info("[section_pipeline] %d content sections + FAQ", len(content_sections))

    # ── 2. Generate targeted search queries (1 Gemini call) ───────────────────
    log.info("[section_pipeline] Generating section queries")
    section_queries = _generate_section_queries(topic, entity_type, content_sections)

    # ── 3. Batch search all queries at once ───────────────────────────────────
    all_queries: list[str] = []
    for qs in section_queries.values():
        all_queries.extend(qs)
    all_queries = list(dict.fromkeys(all_queries))  # deduplicate, preserve order

    log.info("[section_pipeline] Searching %d queries", len(all_queries))
    try:
        researcher = _YouClient()
        search_results = asyncio.run(researcher.batch_search(all_queries))
    except Exception as e:
        log.warning("[section_pipeline] Search failed: %s", e)
        search_results = {q: [] for q in all_queries}

    # ── 4. Per-section: fetch + extract + write (parallel, 3 workers) ─────────
    all_user_questions: list[str] = []
    section_html_map: dict[str, str] = {}
    section_questions_map: dict[str, list[str]] = {}

    def _process_section(section):
        queries = section_queries.get(section.heading, [f"{topic} {section.heading}"])
        section_sr = {q: search_results.get(q, []) for q in queries}

        # User questions from Reddit/Quora snippets
        user_qs = _extract_user_questions(section_sr)

        # Fetch pages
        log.info("  [%s] fetching", section.heading[:50])
        source_text, snippets = _fetch_pages_for_section(
            queries, section_sr, pages_dir, primary_entity
        )

        # Extract
        log.info("  [%s] extracting", section.heading[:50])
        extracted = _extract_section_data(topic, section, source_text, snippets)
        user_qs += extracted.get("user_questions", [])

        # Write
        data_shape = extracted.get("data_shape", "?")
        log.info("  [%s] writing (%s)", section.heading[:50], data_shape)
        html = _write_section(section, extracted, focus_keyword)

        return html, user_qs

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        fut_map = {pool.submit(_process_section, s): s for s in content_sections}
        for fut in concurrent.futures.as_completed(fut_map):
            section = fut_map[fut]
            try:
                html, user_qs = fut.result()
                section_html_map[section.heading] = html
                section_questions_map[section.heading] = user_qs
            except Exception as e:
                log.error("  Section '%s' crashed: %s", section.heading[:50], e)
                section_html_map[section.heading] = ""
                section_questions_map[section.heading] = []

    # Assemble in original order + collect questions
    written: list[str] = []
    for section in content_sections:
        html = section_html_map.get(section.heading, "")
        if html:
            written.append(html)
        all_user_questions.extend(section_questions_map.get(section.heading, []))

    # ── 5. Intro paragraph (inverted pyramid) ────────────────────────────────
    log.info("[section_pipeline] Writing intro paragraph")
    intro_html = _write_intro(
        topic, outline.h1,
        [s.heading for s in content_sections],
        focus_keyword,
    )

    # ── 6. FAQ ────────────────────────────────────────────────────────────────
    log.info("[section_pipeline] Writing FAQ (%d questions)", len(all_user_questions))
    written.append(_write_faq(topic, all_user_questions))

    # ── 7. Assemble ───────────────────────────────────────────────────────────
    header = f"<h1>{outline.h1}</h1>"
    if intro_html:
        header += f"\n{intro_html}"
    article_html = header + "\n\n" + "\n\n".join(written)

    out_path = run_dir / "article.html"
    out_path.write_text(article_html, encoding="utf-8")
    log.info("[section_pipeline] Done — %d chars → %s", len(article_html), out_path)

    return article_html


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    parser = argparse.ArgumentParser(description="Fanout-driven section pipeline")
    parser.add_argument("topic")
    parser.add_argument("--type", default="exam", help="Entity type: exam|college|course|scholarship")
    parser.add_argument("--keyword", default=None, help="Focus keyword (defaults to topic)")
    parser.add_argument("--entity", default=None, help="Primary entity name for page validation")
    parser.add_argument("--out", default="/tmp/sp_out", help="Output directory")
    args = parser.parse_args()

    html = run(
        topic=args.topic,
        entity_type=args.type,
        run_dir=Path(args.out),
        focus_keyword=args.keyword,
        primary_entity=args.entity,
    )
    print(f"\n--- DONE: {len(html)} chars ---")
    print(html[:3000])
