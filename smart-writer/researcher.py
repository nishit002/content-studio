"""
researcher.py — You.com research + page fetching for ATLAS.

Replaces Stages 3 (DDG source discovery) + 4 (fetch + entity validation)
with a You.com powered pipeline enhanced with trafilatura and markdownify.

What makes this better than the DDG approach:
  - You.com returns richer snippets, not just URLs
  - Intent-aware queries (exam → NTA official, placement → placement report PDFs)
  - Official site auto-targeting: NTA, NIRF, JOSAA, IIT/IIM official pages
  - trafilatura extracts clean article text better than readability-lxml
    (handles Indian .ac.in / .gov.in sites, sticky nav bars, JS-rendered content)
  - markdownify preserves HTML table structure as | col | col | markdown
    so Gemini in the indexer can read table rows accurately
  - BrightData fallback for JS-heavy pages (same as before)
  - PDF detection + pdfplumber extraction

Outputs (saved to run_dir):
  sources.json           — SourceList checkpoint (sub_topic_id → URLs)
  fetched_pages.json     — page metadata (title, entity_validated, lengths)
  pages/{hash}.txt       — clean_text per URL (trafilatura output)
  pages/{hash}_md.txt    — markdown_text per URL (BS4 + markdownify output)
"""

from __future__ import annotations

import asyncio
import hashlib
import threading
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("atlas.researcher")

BRIGHT_DATA_KEY  = os.getenv("BRIGHT_DATA_KEY", "")
BRIGHT_DATA_ZONE = os.getenv("BRIGHT_DATA_ZONE", "web_unlocker1")

FETCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# Skip aggregator / low-quality domains for source fetching
SKIP_DOMAINS = {
    "quora.com", "reddit.com", "youtube.com", "facebook.com",
    "twitter.com", "x.com", "linkedin.com", "wikipedia.org",
    "amazon.in", "flipkart.com", "instagram.com",
}

# Official source map: entity keyword → authoritative URLs to always include
OFFICIAL_SOURCES: dict[str, list[str]] = {
    "cuet":             ["https://nta.ac.in/", "https://cuet.samarth.ac.in/"],
    "jee main":         ["https://jeemain.nta.nic.in/", "https://nta.ac.in/"],
    "jee advanced":     ["https://jeeadv.ac.in/"],
    "neet":             ["https://neet.nta.nic.in/", "https://nta.ac.in/"],
    "gate":             ["https://gate2025.iitr.ac.in/"],
    "cat":              ["https://iimcat.ac.in/"],
    "upsc":             ["https://www.upsc.gov.in/"],
    "clat":             ["https://consortiumofnlus.ac.in/"],
    "nirf":             ["https://www.nirfindia.org/Rankings"],
    "josaa":            ["https://josaa.nic.in/"],
    "iit bombay":       ["https://www.iitb.ac.in/", "https://placements.iitb.ac.in/"],
    "iit delhi":        ["https://home.iitd.ac.in/", "https://placements.iitd.ac.in/"],
    "iit madras":       ["https://www.iitm.ac.in/"],
    "iit kanpur":       ["https://www.iitk.ac.in/spo/"],
    "iit kharagpur":    ["https://www.iitkgp.ac.in/"],
    "iit roorkee":      ["https://www.iitr.ac.in/"],
    "iim ahmedabad":    ["https://www.iima.ac.in/placements"],
    "iim bangalore":    ["https://www.iimb.ac.in/placements"],
    "iim calcutta":     ["https://www.iimcal.ac.in/placements"],
    "iim lucknow":      ["https://www.iiml.ac.in/placements"],
    "iim kozhikode":    ["https://www.iimk.ac.in/placements"],
    "iim indore":       ["https://www.iimidr.ac.in/placements"],
    "bits pilani":      ["https://www.bits-pilani.ac.in/"],
    "vit":              ["https://vit.ac.in/"],
    "srm":              ["https://www.srmist.edu.in/"],
    "manipal":          ["https://manipal.edu/"],
    "delhi university": ["https://du.ac.in/"],
}

# Authoritative domain patterns — prefer these in search results
AUTHORITATIVE = (
    ".gov.in", ".ac.in", ".nic.in", ".edu.in", ".res.in",
    ".iitb.ac.in", ".iitd.ac.in", ".iitm.ac.in", ".iitk.ac.in",
    ".iitkgp.ac.in", ".iitr.ac.in", ".iima.ac.in", ".iimb.ac.in",
    ".iimcal.ac.in", ".nirfindia.org",
)


# ── You.com client (adapted from content-generator search_client.py) ──────────

from models import Blueprint, FetchedPage, SourceList  # noqa: E402

_STATS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "key_stats.json")
_stats_lock = threading.Lock()

def _record_you_request(key: str, success: bool) -> None:
    suffix = key[-8:] if len(key) >= 8 else key
    try:
        with _stats_lock:
            try:
                with open(_STATS_FILE) as _f:
                    _stats = json.load(_f)
            except (FileNotFoundError, json.JSONDecodeError):
                _stats = {}
            from datetime import datetime, timezone
            _e = _stats.setdefault(suffix, {"provider": "you_search", "requests": 0, "errors": 0, "last_used": ""})
            _e["requests"] += 1
            if not success:
                _e["errors"] += 1
            _e["last_used"] = datetime.now(timezone.utc).isoformat()
            os.makedirs(os.path.dirname(_STATS_FILE), exist_ok=True)
            with open(_STATS_FILE, "w") as _f:
                json.dump(_stats, _f)
    except Exception:
        pass


class _YouClient:
    """
    Async You.com search client with key rotation.
    Reads keys from YOU_API_KEYS (comma-separated) in .env.
    Uses the official youdotcom SDK.
    """

    def __init__(self, max_concurrent: int = 4):
        raw = os.getenv("YOU_API_KEYS", "") or os.getenv("YOU_API_KEY", "")
        self._keys          = [k.strip() for k in raw.split(",") if k.strip()]
        self._idx           = 0
        self._max_concurrent = max_concurrent
        # NOTE: Semaphore is NOT created here — asyncio.Semaphore must be created
        # inside the running event loop (Python 3.9 requirement). Created in batch_search.
        if not self._keys:
            raise EnvironmentError(
                "YOU_API_KEYS not set in .env. "
                "Add your You.com API key(s) to use You.com research."
            )
        log.info("YouClient: %d key(s) loaded", len(self._keys))

    def _next_key(self) -> str:
        key = self._keys[self._idx % len(self._keys)]
        self._idx += 1
        return key

    async def _search_one(self, query: str, sem: asyncio.Semaphore, count: int = 20) -> list[dict]:
        """Single query with semaphore passed in from the running loop."""
        from youdotcom import You  # type: ignore
        async with sem:
            key = self._next_key()
            try:
                async with You(key) as you:
                    res = await you.search.unified_async(query=query, count=count, country="IN")
                results = []
                if res.results and res.results.web:
                    for r in res.results.web:
                        results.append({
                            "url":         getattr(r, "url", "") or "",
                            "title":       getattr(r, "title", "") or "",
                            "description": getattr(r, "description", "") or "",
                            "snippets":    list(getattr(r, "snippets", []) or []),
                        })
                _record_you_request(key, True)
                return results
            except Exception as e:
                log.warning("You.com search failed for '%s': %s", query[:50], e)
                _record_you_request(key, False)
                return []

    async def batch_search(self, queries: list[str]) -> dict[str, list[dict]]:
        """Run all queries concurrently. Semaphore created here inside the loop."""
        sem = asyncio.Semaphore(self._max_concurrent)  # created inside the loop — Python 3.9 safe
        tasks = {q: asyncio.create_task(self._search_one(q, sem)) for q in queries}
        out = {}
        for q, task in tasks.items():
            try:
                out[q] = await task
            except Exception as e:
                log.warning("batch_search task failed for '%s': %s", q[:50], e)
                out[q] = []
        return out


# ── Query builder ─────────────────────────────────────────────────────────────

def _build_queries(blueprint: Blueprint) -> dict[str, list[str]]:
    """
    Build a query list per sub_topic, plus entity-level queries.
    Returns dict: sub_topic_id → list[query].
    Also returns key "_entity" for queries shared across all sub-topics.
    """
    topic    = blueprint.topic
    entity   = blueprint.primary_entity
    etype    = blueprint.entity_type
    year     = blueprint.year or str(time.localtime().tm_year)
    base     = topic.lower()

    # Entity-level queries — always run regardless of sub_topics
    entity_queries: list[str] = [f"{topic} India {year}"]

    # Official site queries for known entities
    for key, urls in OFFICIAL_SOURCES.items():
        if key in base or key in entity.lower():
            entity_queries.append(f"site:{urlparse(urls[0]).netloc} {topic}")

    # Intent queries per entity type (same patterns as content-generator/researcher.py)
    if etype == "exam":
        entity_queries += [
            f"{topic} official syllabus exam pattern {year}",
            f"{topic} section wise questions marks duration",
            f"{topic} information bulletin filetype:pdf {year}",
            f"{topic} cutoff score university admission {year}",
            f"{topic} best books preparation NCERT India {year}",
        ]
    elif etype in ("college_placement", "business_school", "iit"):
        entity_queries += [
            f"{topic} placement stats average package {year}",
            f"{topic} placement report filetype:pdf {year}",
            f"{topic} top recruiters sector wise {year}",
            f"{entity} official website placements",
            # Broad queries — surface whatever ranks best for this topic (portals, news, PDFs)
            f"{topic} {year} complete placement data",
            f"{topic} highest package companies visited {year}",
        ]
    elif etype == "ranking":
        entity_queries += [
            f"{topic} NIRF ranking {year}",
            f"site:nirfindia.org {base}",
            f"{topic} ranking parameters score year wise",
        ]
    elif etype == "college_profile":
        entity_queries += [
            f"{topic} fees eligibility admission {year}",
            f"{topic} courses placements NIRF rank {year}",
            f"{topic} prospectus brochure filetype:pdf {year}",
            f"{topic} complete overview {year}",
        ]
    elif blueprint.article_type == "admission_guide":
        entity_queries += [
            f"{entity} admission process eligibility {year}",
            f"{entity} entrance exam cutoff merit list {year}",
            f"{entity} application form last date {year}",
            f"{entity} admission notification official site:{entity.split()[0].lower()}.ac.in",
            f"{entity} seat matrix counselling schedule {year}",
        ]
    elif blueprint.article_type == "fee_reference":
        entity_queries += [
            f"{entity} fee structure {year}",
            f"{entity} tuition hostel mess charges {year}",
            f"{entity} scholarship fee waiver {year}",
            f"{entity} fee filetype:pdf {year}",
        ]
    elif blueprint.article_type == "ranking_list":
        entity_queries += [
            f"{entity} NIRF ranking {year}",
            f"site:nirfindia.org {entity}",
            f"{entity} ranking parameters score year wise",
        ]
    elif etype == "career":
        entity_queries += [
            f"{topic} salary scope India {year}",
            f"{topic} job roles top companies hiring",
        ]

    # PDF queries (placement reports, info bulletins are the best sources)
    entity_queries += [
        f"{topic} filetype:pdf {year}",
        f"{entity} annual report placement brochure PDF",
    ]

    # Per-sub_topic: use queries from blueprint (Stage 1 already built these)
    by_sub_topic: dict[str, list[str]] = {"_entity": entity_queries}
    for st in blueprint.sub_topics:
        by_sub_topic[st.id] = list(st.search_queries)  # Stage 1 queries

    return by_sub_topic


# ── HTML extraction ───────────────────────────────────────────────────────────

def _extract_text(html: str, url: str) -> tuple[str, str]:
    """
    Returns (clean_text, markdown_text).

    clean_text:    trafilatura extract → plain text, nav/ads stripped, good for entity validation
    markdown_text: BS4 strip nav/footer → markdownify → markdown with tables as | col | rows
    """
    clean_text    = _extract_clean(html, url)
    markdown_text = _extract_markdown(html)
    return clean_text, markdown_text


def _extract_clean(html: str, url: str) -> str:
    """trafilatura → clean article text. Falls back to BeautifulSoup."""
    try:
        import trafilatura  # type: ignore
        text = trafilatura.extract(
            html,
            include_tables=True,
            include_links=False,
            no_fallback=False,
            url=url,
        )
        if text and len(text) > 200:
            return text.strip()
    except ImportError:
        pass
    except Exception as e:
        log.debug("trafilatura failed for %s: %s", url, e)

    # BeautifulSoup fallback
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.title
    title = title_tag.string.strip() if title_tag and title_tag.string else ""
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()
    body = soup.find("body")
    text = (body or soup).get_text(separator="\n", strip=True)
    return text.strip()


def _extract_markdown(html: str) -> str:
    """
    BS4 (strip nav/footer) → markdownify.
    Tables come out as | col | col | markdown rows — Gemini reads these much better
    than flat plain text where table structure has been lost.
    """
    try:
        from markdownify import markdownify as md  # type: ignore

        # Strip noisy structural elements before converting
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header",
                         "aside", "noscript", "iframe", "form"]):
            tag.decompose()

        clean_html = str(soup)
        markdown = md(
            clean_html,
            heading_style="ATX",       # ## style headings
            bullets="-",
            strip=["img", "a"],        # remove image + link noise
        )
        # Collapse excessive blank lines
        markdown = re.sub(r"\n{3,}", "\n\n", markdown)
        return markdown.strip()
    except ImportError:
        log.debug("markdownify not installed — falling back to clean_text for markdown")
        return ""
    except Exception as e:
        log.debug("markdownify failed: %s", e)
        return ""


# ── PDF extraction ────────────────────────────────────────────────────────────

def _extract_pdf(url: str) -> tuple[str, str]:
    """
    Download + extract a PDF. Returns (clean_text, markdown_text).
    Uses pdfplumber if available, otherwise returns empty.
    """
    try:
        import pdfplumber  # type: ignore
        import io

        resp = requests.get(url, headers=FETCH_HEADERS, timeout=30)
        resp.raise_for_status()

        with pdfplumber.open(io.BytesIO(resp.content)) as pdf:
            pages_text: list[str] = []
            tables_md:  list[str] = []

            for page in pdf.pages[:20]:  # cap at 20 pages
                text = page.extract_text() or ""
                if text:
                    pages_text.append(text)
                for tbl in page.extract_tables():
                    if tbl and len(tbl) > 1:
                        # Convert to markdown table
                        header = " | ".join(str(c or "") for c in tbl[0])
                        sep    = " | ".join("---" for _ in tbl[0])
                        rows   = [" | ".join(str(c or "") for c in row) for row in tbl[1:]]
                        tables_md.append(f"| {header} |\n| {sep} |\n" +
                                         "\n".join(f"| {r} |" for r in rows))

        clean    = "\n\n".join(pages_text)
        markdown = "\n\n".join(pages_text) + "\n\n" + "\n\n".join(tables_md)
        log.info("  PDF extracted: %d chars, %d tables from %s", len(clean), len(tables_md), url[:60])
        return clean.strip(), markdown.strip()

    except ImportError:
        log.debug("pdfplumber not installed — skipping PDF extraction for %s", url[:60])
        return "", ""
    except Exception as e:
        log.debug("PDF extraction failed for %s: %s", url[:60], e)
        return "", ""


# ── Entity validation ─────────────────────────────────────────────────────────

def _entity_valid(text: str, primary_entity: str) -> bool:
    if not primary_entity:
        return True
    el = primary_entity.lower()
    tl = text.lower()
    if el in tl:
        return True
    # Try with commas stripped from text (e.g. "Amity University, Noida" → "Amity University Noida")
    tl_no_comma = tl.replace(",", " ").replace("  ", " ")
    if el in tl_no_comma:
        return True
    # Try with & replaced by "and" (e.g. "Technology & Science" → "Technology and Science")
    el_and = el.replace(" & ", " and ")
    if el_and in tl or el_and in tl_no_comma:
        return True
    if el.replace(" ", "") in tl:
        return True
    words = primary_entity.split()
    if len(words) >= 2:
        stop = {"&", "and", "of", "the"}
        acronym = "".join(w[0] for w in words if w.lower() not in stop).lower()
        if len(acronym) >= 3 and acronym in tl:
            return True
    return False


# ── URL fetcher ───────────────────────────────────────────────────────────────

def _is_pdf_url(url: str) -> bool:
    return url.lower().endswith(".pdf") or "filetype=pdf" in url.lower()


def _should_skip(url: str) -> bool:
    domain = urlparse(url).netloc.lower().lstrip("www.")
    return any(domain == s or domain.endswith("." + s) for s in SKIP_DOMAINS)


def _fetch_url(
    url: str,
    primary_entity: str,
    pages_dir: Path,
) -> Optional[tuple[FetchedPage, str]]:
    """
    Fetch a URL. Returns (FetchedPage, markdown_text) or None on hard failure.
    Saves clean_text and markdown_text to pages_dir.
    """
    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    clean_file = pages_dir / f"{url_hash}.txt"
    md_file    = pages_dir / f"{url_hash}_md.txt"

    # Serve from disk cache if already fetched this run
    if clean_file.exists():
        clean_text    = clean_file.read_text(encoding="utf-8")
        markdown_text = md_file.read_text(encoding="utf-8") if md_file.exists() else ""
        validated     = _entity_valid(clean_text, primary_entity)
        return FetchedPage(
            url=url, html="", clean_text=clean_text, title="",
            fetched_via="cached", entity_validated=validated,
        ), markdown_text

    # PDF: use pdfplumber
    if _is_pdf_url(url):
        clean_text, markdown_text = _extract_pdf(url)
        if not clean_text:
            return None
        clean_file.write_text(clean_text, encoding="utf-8")
        md_file.write_text(markdown_text, encoding="utf-8")
        validated = _entity_valid(clean_text, primary_entity)
        return FetchedPage(
            url=url, html="", clean_text=clean_text, title="[PDF]",
            fetched_via="pdf", entity_validated=validated,
        ), markdown_text

    # Direct HTTP
    html = ""
    via  = "direct"
    try:
        resp = requests.get(url, headers=FETCH_HEADERS, timeout=20, allow_redirects=True)
        if resp.status_code < 400:
            html = resp.text
    except Exception as e:
        log.debug("Direct fetch failed for %s: %s", url[:60], e)

    # BrightData fallback for JS-heavy / blocked pages
    if (not html or len(html) < 500) and BRIGHT_DATA_KEY:
        log.info("  BrightData fallback for %s", url[:60])
        try:
            resp = requests.post(
                "https://api.brightdata.com/request",
                headers={
                    "Authorization": f"Bearer {BRIGHT_DATA_KEY}",
                    "Content-Type":  "application/json",
                },
                json={"zone": BRIGHT_DATA_ZONE, "url": url, "format": "raw"},
                timeout=60,
            )
            resp.raise_for_status()
            html = resp.text
            via  = "brightdata"
        except Exception as e:
            log.debug("BrightData failed for %s: %s", url[:60], e)

    if not html or len(html) < 300:
        return None

    # Extract text
    title = ""
    try:
        soup  = BeautifulSoup(html[:2000], "html.parser")
        title = soup.title.string.strip() if soup.title and soup.title.string else ""
    except Exception:
        pass

    clean_text, markdown_text = _extract_text(html, url)

    # Save to disk
    clean_file.write_text(clean_text, encoding="utf-8")
    if markdown_text:
        md_file.write_text(markdown_text, encoding="utf-8")

    validated = _entity_valid(clean_text, primary_entity)
    if not validated:
        log.warning("  Entity validation failed: '%s' not found in %s", primary_entity, url[:60])

    return FetchedPage(
        url=url, html="", clean_text=clean_text, title=title,
        fetched_via=via, entity_validated=validated,
    ), markdown_text


# ── Snippet collection ────────────────────────────────────────────────────────

def _snippets_to_text(results: list[dict]) -> str:
    """Combine You.com snippets from a result set into a text block."""
    parts = []
    for r in results:
        title   = r.get("title", "")
        url     = r.get("url", "")
        desc    = r.get("description", "")
        snips   = r.get("snippets", [])
        text    = " ".join(snips) or desc
        if text.strip():
            parts.append(f"[{title[:60]}] ({url[:80]})\n{text[:600]}")
    return "\n\n".join(parts)


# ── Main run function ─────────────────────────────────────────────────────────

def run(blueprint: Blueprint, run_dir: Path) -> tuple[SourceList, dict[str, FetchedPage]]:
    """
    Run the You.com researcher. Replaces Stages 3 + 4.

    Returns:
        source_list: SourceList (sub_topic_id → list of fetched URLs)
        pages:       dict[url → FetchedPage] (entity-validated pages only)

    Saves checkpoints to run_dir:
        sources.json, fetched_pages.json, pages/
    Also saves you_snippets.json (raw You.com snippets for indexer fallback)
    """
    sources_ckpt  = run_dir / "sources.json"
    pages_ckpt    = run_dir / "fetched_pages.json"
    pages_dir     = run_dir / "pages"
    pages_dir.mkdir(exist_ok=True)

    # ── Load from checkpoint if already done ──────────────────────────────────
    if sources_ckpt.exists() and pages_ckpt.exists():
        log.info("Researcher: loading from checkpoint")
        sl_data = json.loads(sources_ckpt.read_text(encoding="utf-8"))
        source_list = SourceList(
            by_sub_topic=sl_data.get("by_sub_topic", {}),
            all_urls=sl_data.get("all_urls", []),
        )
        pages = _load_pages_from_checkpoint(pages_ckpt, pages_dir, blueprint.primary_entity)
        return source_list, pages

    log.info("Researcher: '%s'  entity_type=%s", blueprint.topic[:60], blueprint.entity_type)

    # ── Step 1: Build queries ──────────────────────────────────────────────────
    queries_by_st = _build_queries(blueprint)
    all_queries: list[str] = []
    seen_q: set[str] = set()
    for qs in queries_by_st.values():
        for q in qs:
            if q not in seen_q:
                all_queries.append(q)
                seen_q.add(q)
    log.info("Researcher: %d unique queries to run", len(all_queries))

    # ── Step 2: You.com batch search ──────────────────────────────────────────
    client = _YouClient()
    search_results: dict[str, list[dict]] = asyncio.run(client.batch_search(all_queries))

    total_results = sum(len(v) for v in search_results.values())
    log.info("Researcher: %d results across %d queries", total_results, len(all_queries))

    # Save raw snippets for indexer (used as fallback when fetched pages are thin)
    snippets_by_st: dict[str, str] = {}
    for st in blueprint.sub_topics:
        st_snippets: list[dict] = []
        for q in queries_by_st.get(st.id, []):
            st_snippets.extend(search_results.get(q, []))
        snippets_by_st[st.id] = _snippets_to_text(st_snippets[:40])

    # Also collect entity-level snippets
    entity_snippets: list[dict] = []
    for q in queries_by_st.get("_entity", []):
        entity_snippets.extend(search_results.get(q, []))
    snippets_by_st["_entity"] = _snippets_to_text(entity_snippets[:50])

    (run_dir / "you_snippets.json").write_text(
        json.dumps(snippets_by_st, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ── Step 3: Collect URLs per sub-topic ────────────────────────────────────
    # ORDER MATTERS for the indexer: first URLs in the list get read first.
    # We build a shared "base" from entity-level queries (these surface the best
    # overview pages — portals, main placement PDFs) and add them to EVERY
    # sub-topic BEFORE sub-topic-specific results.
    by_sub_topic: dict[str, list[str]] = {}
    seen_urls: set[str] = set()

    # ── 3a: Entity-level results → base for ALL sub-topics ──────────────────
    # These come from broad queries like "{topic} placement stats average package 2026"
    # and surface the best overview pages (Collegedunia, Careers360, main PDFs).
    entity_results: list[dict] = []
    for q in queries_by_st.get("_entity", []):
        entity_results.extend(search_results.get(q, []))

    # Sort entity results to put the most data-rich sources first:
    # 1. Portals (Shiksha, Careers360, Collegedunia) — aggregated student-facing data
    # 2. Placement/topic-specific PDFs — direct placement reports
    # 3. Other official PDFs — may have relevant data
    # 4. Other official pages
    # 5. Rest
    _PORTALS = ("shiksha.com", "careers360.com", "collegedunia.com", "collegedekho.com", "getmyuni.com")
    _topic_kw = blueprint.article_type.replace("_", " ").split()[0]  # e.g. "college" → "placement"

    def _entity_priority(r: dict) -> int:
        url = r.get("url", "").lower()
        if any(p in url for p in _PORTALS):
            return 0  # portals first
        if _is_pdf_url(url) and any(k in url for k in ("placement", "recruit", "package", "salary")):
            return 1  # placement-specific PDFs
        if _is_pdf_url(url):
            return 2  # other PDFs
        if _is_authoritative_url(url):
            return 3  # other official pages
        return 4      # everything else

    entity_ordered = sorted(entity_results, key=_entity_priority)

    entity_base_urls: list[str] = []
    for r in entity_ordered:
        url = r.get("url", "")
        if url and url not in seen_urls and not _should_skip(url):
            seen_urls.add(url)
            entity_base_urls.append(url)
    log.info("Researcher: %d entity-level base URLs (portals, key PDFs)", len(entity_base_urls))

    # ── 3b: Pre-mapped official URLs for this entity ─────────────────────────
    official_urls = []
    for key, urls in OFFICIAL_SOURCES.items():
        if key in blueprint.primary_entity.lower() or key in blueprint.topic.lower():
            for u in urls:
                if u not in seen_urls:
                    official_urls.append(u)
                    seen_urls.add(u)
    if official_urls:
        log.info("Researcher: %d pre-mapped official URLs", len(official_urls))

    # ── 3c: Per sub-topic: entity base first, then official, then specific ───
    for st in blueprint.sub_topics:
        # Start with entity-level base URLs (portals + key PDFs for this topic)
        st_urls: list[str] = list(entity_base_urls)

        # Add official pre-mapped URLs
        for u in official_urls:
            if u not in st_urls:
                st_urls.append(u)

        # Add per-sub-topic query results (fills remaining slots)
        st_results: list[dict] = []
        for q in queries_by_st.get(st.id, []):
            st_results.extend(search_results.get(q, []))

        pdfs  = [r for r in st_results if _is_pdf_url(r.get("url", ""))]
        auth  = [r for r in st_results if _is_authoritative_url(r.get("url", "")) and not _is_pdf_url(r.get("url", ""))]
        rest  = [r for r in st_results if not _is_authoritative_url(r.get("url", "")) and not _is_pdf_url(r.get("url", ""))]
        ordered = pdfs + auth + rest

        url_limit = 14  # generous limit — quality filtered by entity validation + indexer
        for r in ordered:
            url = r.get("url", "")
            if url and url not in seen_urls and not _should_skip(url) and len(st_urls) < url_limit:
                st_urls.append(url)
                seen_urls.add(url)

        by_sub_topic[st.id] = st_urls

    all_urls = list(seen_urls)
    log.info("Researcher: %d unique URLs to fetch", len(all_urls))

    # ── Step 4: Fetch all URLs ─────────────────────────────────────────────────
    pages: dict[str, FetchedPage] = {}
    page_meta: dict[str, dict]    = {}

    for i, url in enumerate(all_urls):
        log.info("  [%d/%d] %s", i + 1, len(all_urls), url[:80])
        result = _fetch_url(url, blueprint.primary_entity, pages_dir)
        if result is None:
            log.warning("  → fetch failed")
            page_meta[url] = {"url": url, "entity_validated": False, "error": "fetch failed"}
            continue

        page, _md = result
        page_meta[url] = {
            "url":              url,
            "title":            page.title,
            "fetched_via":      page.fetched_via,
            "entity_validated": page.entity_validated,
            "text_len":         len(page.clean_text),
        }
        if page.entity_validated:
            pages[url] = page
            log.info("  → ✓ validated (%d chars, via %s)", len(page.clean_text), page.fetched_via)
        else:
            log.info("  → ✗ entity mismatch (kept snippets as fallback)")

        time.sleep(0.3)  # polite

    # ── Step 5: Save checkpoints ───────────────────────────────────────────────
    source_list = SourceList(by_sub_topic=by_sub_topic, all_urls=all_urls)

    sources_ckpt.write_text(
        json.dumps({"by_sub_topic": by_sub_topic, "all_urls": all_urls}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    pages_ckpt.write_text(
        json.dumps(page_meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    validated = len(pages)
    log.info("Researcher: %d/%d URLs passed entity validation", validated, len(all_urls))
    if validated == 0:
        log.warning("Researcher: WARNING — no pages validated. "
                    "You.com snippets will be used as fallback in indexer.")

    return source_list, pages


def _is_authoritative_url(url: str) -> bool:
    lower = url.lower()
    return any(suf in lower for suf in AUTHORITATIVE)


def _load_pages_from_checkpoint(
    pages_ckpt: Path,
    pages_dir:  Path,
    primary_entity: str,
) -> dict[str, FetchedPage]:
    meta = json.loads(pages_ckpt.read_text(encoding="utf-8"))
    pages: dict[str, FetchedPage] = {}
    for url, info in meta.items():
        if not info.get("entity_validated"):
            continue
        url_hash   = hashlib.md5(url.encode()).hexdigest()[:12]
        clean_file = pages_dir / f"{url_hash}.txt"
        if clean_file.exists():
            clean_text = clean_file.read_text(encoding="utf-8")
            pages[url] = FetchedPage(
                url=url,
                html="",
                clean_text=clean_text,
                title=info.get("title", ""),
                fetched_via=info.get("fetched_via", "cached"),
                entity_validated=True,
            )
    return pages
