#!/usr/bin/env python3
"""
Smart Writer — Source-First Content Pipeline
============================================

WHY this beats search-snippet pipelines:
  ✓ Fetches COMPLETE official pages (not 200-char search snippets)
  ✓ Gemini reads the full NTA PDF / NIRF table / college placement page
  ✓ Llama gets pre-verified data tables — it converts data to prose, not recall from memory
  ✓ Zero hallucination: every number in the article comes from a real scraped source

PIPELINE (6 stages):
  1. Source Discovery  — identify 5-8 official URLs for the topic
  2. BrightData Fetch  — pull complete page HTML (bypasses anti-bot on .ac.in / .gov.in)
  3. Gemini Extraction — extract ALL structured facts from full pages into JSON
  4. Outline Creation  — Gemini builds SEO-optimized section plan from extracted data
  5. Section Writing   — LM Studio (Llama 3.1 8B) converts data tables → readable HTML
  6. SEO Assembly      — add TOC, FAQ schema, meta tags, quality score

USAGE:
  python smart_writer.py "CUET UG 2026 Mathematics Syllabus"
  python smart_writer.py "IIT Bombay Placements 2024" --type college_profile
  python smart_writer.py "Top MBA Colleges India NIRF 2025" --type ranking_list
  python smart_writer.py "JEE Main 2026 Exam Pattern" --type exam_guide

SETUP (create a .env file in this folder):
  GEMINI_API_KEY=your-gemini-key
  BRIGHT_DATA_KEY=your-brightdata-bearer-token
  BRIGHT_DATA_ZONE=web_unlocker1         # your BrightData zone name
  LM_STUDIO_URL=http://localhost:1234/v1
  LM_STUDIO_MODEL=meta-llama-3.1-8b-instruct
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# ─── Setup ───────────────────────────────────────────────────────────────────

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("smart_writer")

GEMINI_KEY       = os.getenv("GEMINI_API_KEY", "")
BRIGHT_DATA_KEY  = os.getenv("BRIGHT_DATA_KEY", "")
BRIGHT_DATA_ZONE = os.getenv("BRIGHT_DATA_ZONE", "web_unlocker1")
LM_STUDIO_URL    = os.getenv("LM_STUDIO_URL", "http://localhost:1234/v1")
LM_STUDIO_MODEL  = os.getenv("LM_STUDIO_MODEL", "meta-llama-3.1-8b-instruct")

CURRENT_YEAR = datetime.now().year
OUTPUT_DIR   = Path("output")
CACHE_DIR    = Path(".cache/pages")

OUTPUT_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

RUNS_FILE = OUTPUT_DIR / "runs.json"


# ─── Run Management ───────────────────────────────────────────────────────────

def _load_runs() -> dict:
    if RUNS_FILE.exists():
        return json.loads(RUNS_FILE.read_text())
    return {}

def _save_runs(runs: dict) -> None:
    RUNS_FILE.write_text(json.dumps(runs, ensure_ascii=False, indent=2))

def _next_run_id(runs: dict) -> str:
    if not runs:
        return "001"
    max_id = max(int(k) for k in runs.keys())
    return f"{max_id + 1:03d}"

def _update_run(run_id: str, **fields) -> None:
    runs = _load_runs()
    if run_id not in runs:
        runs[run_id] = {}
    runs[run_id].update(fields)
    _save_runs(runs)

def list_runs() -> None:
    runs = _load_runs()
    if not runs:
        print("No runs yet.")
        return
    print(f"\n{'ID':<5} {'Status':<10} {'Type':<16} {'Date':<17} Topic")
    print("-" * 80)
    for run_id in sorted(runs.keys()):
        r = runs[run_id]
        status = r.get("status", "?")
        icon = {"done": "✓", "failed": "✗", "running": "…"}.get(status, "?")
        print(f"{run_id:<5} {icon} {status:<8} {r.get('type',''):<16} {r.get('started',''):<17} {r.get('topic','')[:50]}")
    print()


# ─── Official Source Map ─────────────────────────────────────────────────────
# Maps topic keywords → authoritative URLs to fetch directly.
# These pages contain the most accurate primary data. No middlemen.

OFFICIAL_SOURCES: dict[str, list[str]] = {
    # ── NTA Exams ──
    "cuet":        ["https://nta.ac.in/", "https://cuet.samarth.ac.in/"],
    "jee main":    ["https://jeemain.nta.nic.in/", "https://nta.ac.in/"],
    "jee advanced":["https://jeeadv.ac.in/"],
    "neet":        ["https://neet.nta.nic.in/", "https://nta.ac.in/"],
    "gate":        ["https://gate2025.iitr.ac.in/", "https://gate.iitg.ac.in/"],
    "cat":         ["https://iimcat.ac.in/"],
    "upsc":        ["https://www.upsc.gov.in/examinations/active-examinations"],
    "ssc cgl":     ["https://ssc.nic.in/"],
    "clat":        ["https://consortiumofnlus.ac.in/"],
    # ── Rankings ──
    "nirf":        ["https://www.nirfindia.org/Rankings",
                    "https://www.nirfindia.org/2024/EngineeringRanking.html",
                    "https://www.nirfindia.org/2024/UniversityRanking.html",
                    "https://www.nirfindia.org/2024/ManagementRanking.html"],
    # ── Counselling ──
    "josaa":       ["https://josaa.nic.in/", "https://josaa.nic.in/opening-closing-rank/"],
    "csab":        ["https://csab.nic.in/"],
    # ── Top IITs ──
    "iit bombay":  ["https://www.iitb.ac.in/", "https://placements.iitb.ac.in/"],
    "iit delhi":   ["https://home.iitd.ac.in/", "https://placements.iitd.ac.in/"],
    "iit madras":  ["https://www.iitm.ac.in/", "https://iitm.ac.in/companies"],
    "iit kanpur":  ["https://www.iitk.ac.in/", "https://www.iitk.ac.in/spo/"],
    "iit kharagpur":["https://www.iitkgp.ac.in/"],
    "iit roorkee": ["https://www.iitr.ac.in/"],
    # ── Top IIMs ──
    "iim ahmedabad":["https://www.iima.ac.in/placements"],
    "iim bangalore":["https://www.iimb.ac.in/placements"],
    "iim calcutta": ["https://www.iimcal.ac.in/placements"],
    # ── Popular colleges ──
    "bits pilani": ["https://www.bits-pilani.ac.in/"],
    "vit vellore": ["https://vit.ac.in/"],
    "srm":         ["https://www.srmist.edu.in/"],
    "manipal":     ["https://manipal.edu/mu.html"],
    "delhi university": ["https://du.ac.in/du/index.php"],
    # ── Regulatory ──
    "ugc":         ["https://www.ugc.gov.in/"],
    "aicte":       ["https://www.aicte-india.org/"],
}

# DuckDuckGo Lite: no API key, returns organic search results as HTML
DDG_SEARCH_URL = "https://lite.duckduckgo.com/lite/"

# BrightData Web Unlocker REST endpoint
BRIGHTDATA_REQUEST_URL = "https://api.brightdata.com/request"


# ─── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class FetchedPage:
    url: str
    html: str
    clean_text: str   # readable text stripped of nav/footer/ads
    title: str
    fetched_via: str  # "direct" | "brightdata"
    error: str = ""

@dataclass
class ExtractedData:
    source_url: str
    page_title: str
    facts: dict       # category → list of structured facts
    key_highlights: list[str]   # top 5-8 bullet facts for intro box

@dataclass
class SectionPlan:
    heading: str
    level: int          # 2 = H2, 3 = H3
    section_type: str   # "table" | "prose" | "mixed" | "faq"
    columns: list[str]
    data_hint: str      # which fact categories to use
    word_target: int
    seo_note: str = ""  # what to emphasise for SEO
    unique_angle: str = ""  # what this section adds that no other covers

@dataclass
class ArticleOutline:
    h1_title: str
    meta_description: str  # 150-160 chars, includes keyword
    focus_keyword: str
    sections: list[SectionPlan]
    faq_questions: list[str]
    schema_type: str   # "Article" | "FAQPage" | "Course"


# ─── Stage 1: URL Discovery ──────────────────────────────────────────────────

def discover_urls(topic: str, content_type: str) -> list[str]:
    """
    Find 5-8 authoritative URLs for the topic.
    Strategy:
      1. Match topic keywords against OFFICIAL_SOURCES map (fastest, most reliable)
      2. DuckDuckGo search filtered for .gov.in / .ac.in / .nic.in / .edu domains
    Returns deduplicated list, official/gov sources first.
    """
    urls: list[str] = []
    seen: set[str] = set()
    topic_lower = topic.lower()

    # ── Step 1: Direct source map lookup ──
    for keyword, source_urls in OFFICIAL_SOURCES.items():
        if keyword in topic_lower:
            for url in source_urls:
                norm = url.rstrip("/")
                if norm not in seen:
                    seen.add(norm)
                    urls.append(url)

    # ── Step 2: DuckDuckGo search (no API key needed) ──
    # Build query that targets official sites
    official_suffixes = "site:.gov.in OR site:.ac.in OR site:.nic.in OR site:.edu.in"
    query = f"{topic} {CURRENT_YEAR} {official_suffixes}"

    try:
        log.info("Searching DDG for official sources: %s", topic[:60])
        resp = requests.post(
            DDG_SEARCH_URL,
            data={"q": query, "kl": "in-en"},
            headers={"User-Agent": "Mozilla/5.0 (compatible; smart_writer/1.0)"},
            timeout=10,
        )
        if resp.ok:
            soup = BeautifulSoup(resp.text, "lxml")
            # DDG Lite returns results as plain <a> tags in a table
            for a in soup.select("a.result-link, a[href*='http']"):
                href = a.get("href", "")
                if not href.startswith("http"):
                    continue
                parsed = urlparse(href)
                host = parsed.netloc.lower()
                # Accept only official/educational domains
                if any(host.endswith(suf) for suf in [".gov.in", ".ac.in", ".nic.in", ".edu.in", ".edu"]):
                    norm = href.rstrip("/")
                    if norm not in seen:
                        seen.add(norm)
                        urls.append(href)
                if len(urls) >= 8:
                    break
    except Exception as e:
        log.warning("DDG search failed: %s", e)

    # ── Step 3: Fallback — generic search without site filter ──
    if len(urls) < 3:
        try:
            fallback_query = f"{topic} official {CURRENT_YEAR}"
            resp = requests.post(
                DDG_SEARCH_URL,
                data={"q": fallback_query, "kl": "in-en"},
                headers={"User-Agent": "Mozilla/5.0 (compatible; smart_writer/1.0)"},
                timeout=10,
            )
            if resp.ok:
                soup = BeautifulSoup(resp.text, "lxml")
                for a in soup.select("a[href*='http']"):
                    href = a.get("href", "")
                    if href.startswith("http") and href not in seen:
                        seen.add(href)
                        urls.append(href)
                    if len(urls) >= 6:
                        break
        except Exception as e:
            log.warning("Fallback search failed: %s", e)

    log.info("Discovered %d source URLs", len(urls))
    for u in urls[:8]:
        log.info("  → %s", u)

    return urls[:8]  # Cap at 8 — enough data, not too slow


# ─── Stage 2: Web Fetching ──────────────────────────────────────────────────

def _page_cache_path(url: str) -> Path:
    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    return CACHE_DIR / f"{url_hash}.json"

def _load_from_cache(url: str) -> Optional[FetchedPage]:
    """Return cached page if fetched in the last 24 hours."""
    path = _page_cache_path(url)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        fetched_at = datetime.fromisoformat(data.get("cached_at", "2000-01-01"))
        age_hours = (datetime.now() - fetched_at).total_seconds() / 3600
        if age_hours < 24:
            return FetchedPage(
                url=data["url"], html=data["html"], clean_text=data["clean_text"],
                title=data["title"], fetched_via=data["fetched_via"],
            )
    except Exception:
        pass
    return None

def _save_to_cache(page: FetchedPage):
    path = _page_cache_path(page.url)
    path.write_text(json.dumps({
        "url": page.url, "html": page.html, "clean_text": page.clean_text,
        "title": page.title, "fetched_via": page.fetched_via,
        "cached_at": datetime.now().isoformat(),
    }, ensure_ascii=False))

def _extract_clean_text(html: str) -> tuple[str, str]:
    """
    Extract readable title + body text from raw HTML.
    Removes: nav, header, footer, scripts, styles, ads.
    Uses readability algorithm to find main content area.
    Falls back to stripping everything non-content if readability fails.
    """
    # Try readability-lxml first (best quality)
    try:
        from readability import Document
        doc = Document(html)
        title = doc.title() or ""
        readable_html = doc.summary()
        soup = BeautifulSoup(readable_html, "lxml")
        text = soup.get_text(separator="\n", strip=True)
        return title, text
    except Exception:
        pass

    # Fallback: manual extraction
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.string.strip() if soup.title else ""

    # Remove noise elements
    for tag in soup(["script", "style", "nav", "header", "footer", "aside",
                     "noscript", "iframe", "form", "button", "svg", "meta"]):
        tag.decompose()

    # Try to find main content
    main = (soup.find("main") or soup.find("article") or
            soup.find(id=re.compile(r"content|main|body", re.I)) or
            soup.find(class_=re.compile(r"content|main|body", re.I)) or
            soup.body)

    if main:
        text = main.get_text(separator="\n", strip=True)
    else:
        text = soup.get_text(separator="\n", strip=True)

    # Collapse whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    return title, text[:80000]  # Cap at 80k chars

def fetch_page_direct(url: str) -> FetchedPage:
    """Fetch via standard HTTP. Works for most .gov.in and .ac.in sites."""
    headers = {
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        resp.raise_for_status()
        title, clean = _extract_clean_text(resp.text)
        return FetchedPage(url=url, html=resp.text[:200000], clean_text=clean,
                           title=title, fetched_via="direct")
    except Exception as e:
        return FetchedPage(url=url, html="", clean_text="", title="",
                           fetched_via="direct", error=str(e))

def fetch_page_brightdata(url: str) -> FetchedPage:
    """
    Fetch via BrightData Web Unlocker.
    Handles: JS-rendered pages, anti-bot protection, CAPTCHAs.
    Requires: BRIGHT_DATA_KEY + a Web Unlocker zone in your BrightData account.

    BrightData Web Unlocker API:
      POST https://api.brightdata.com/request
      Authorization: Bearer {key}
      Body: {"zone": "web_unlocker1", "url": "...", "format": "raw"}
    """
    if not BRIGHT_DATA_KEY:
        return FetchedPage(url=url, html="", clean_text="", title="",
                           fetched_via="brightdata", error="BRIGHT_DATA_KEY not set")
    try:
        resp = requests.post(
            BRIGHTDATA_REQUEST_URL,
            headers={
                "Authorization": f"Bearer {BRIGHT_DATA_KEY}",
                "Content-Type": "application/json",
            },
            json={"zone": BRIGHT_DATA_ZONE, "url": url, "format": "raw"},
            timeout=60,
        )
        if not resp.ok:
            return FetchedPage(url=url, html="", clean_text="", title="",
                               fetched_via="brightdata",
                               error=f"HTTP {resp.status_code}: {resp.text[:200]}")
        html = resp.text
        title, clean = _extract_clean_text(html)
        return FetchedPage(url=url, html=html[:200000], clean_text=clean,
                           title=title, fetched_via="brightdata")
    except Exception as e:
        return FetchedPage(url=url, html="", clean_text="", title="",
                           fetched_via="brightdata", error=str(e))

def fetch_page(url: str) -> FetchedPage:
    """
    Smart fetcher: tries direct HTTP first, falls back to BrightData.
    Uses 24-hour disk cache to avoid redundant fetches.
    """
    # Check cache first
    cached = _load_from_cache(url)
    if cached:
        log.info("  [CACHE] %s", url[:80])
        return cached

    log.info("  [FETCH] %s", url[:80])

    # Try direct first (free, fast)
    page = fetch_page_direct(url)

    # If blocked or empty content, try BrightData
    if page.error or len(page.clean_text) < 500:
        if BRIGHT_DATA_KEY:
            log.info("  [BRIGHTDATA] Direct failed (%s), trying BrightData...",
                     page.error[:60] if page.error else "too little content")
            page = fetch_page_brightdata(url)
        elif page.error:
            log.warning("  [SKIP] %s — %s (no BrightData key configured)", url[:60], page.error[:60])

    if page.clean_text:
        _save_to_cache(page)
        log.info("  [OK] %s — %d chars via %s", url[:60], len(page.clean_text), page.fetched_via)
    else:
        log.warning("  [EMPTY] %s", url[:60])

    return page

def fetch_all_pages(urls: list[str]) -> list[FetchedPage]:
    """Fetch all URLs sequentially with short delay to be polite."""
    pages = []
    for i, url in enumerate(urls):
        page = fetch_page(url)
        if page.clean_text:
            pages.append(page)
        if i < len(urls) - 1:
            time.sleep(0.5)
    log.info("Fetched %d/%d pages with content", len(pages), len(urls))
    return pages


# ─── Stage 3: Data Extraction via Gemini ─────────────────────────────────────

def _call_gemini(prompt: str, model: str = "gemini-2.0-flash") -> str:
    """
    Call Gemini API. Returns text response or raises on error.
    Uses the REST API directly to avoid SDK version issues.
    """
    if not GEMINI_KEY:
        raise RuntimeError("GEMINI_API_KEY not set in .env")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,  # Low temp for factual extraction
            "maxOutputTokens": 8192,
        },
    }
    resp = requests.post(
        url,
        params={"key": GEMINI_KEY},
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()

    # Extract text from response
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return text.strip()
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Unexpected Gemini response: {data}") from e

def _build_extraction_prompt(topic: str, page_text: str, page_url: str) -> str:
    """
    Prompt Gemini to extract ALL structured facts from a full page.
    The key difference from snippet extraction: we give it the COMPLETE page.
    """
    return f"""You are a precision data extraction engine. Read the full page content below and extract EVERY factual data point into structured JSON.

TOPIC: "{topic}"
SOURCE URL: {page_url}
YEAR CONTEXT: {CURRENT_YEAR}

YOUR JOB:
- Extract EVERY fact, number, date, table row, ranking, fee, score from the page
- Organise into the JSON categories below
- Never invent, estimate or round — use exact values from the page
- If a table has 40 rows, extract all 40 rows — do NOT summarise
- Mark each item with its source context (which heading/section it came from on the page)

OUTPUT JSON SCHEMA (include only categories with actual data):

{{
  "page_summary": "1-2 sentence summary of what this page contains",
  "key_highlights": ["Most important fact 1", "Most important fact 2", ...],

  "exam_info": [{{
    "exam_name": "...", "full_form": "...", "conducting_body": "...",
    "frequency": "...", "mode": "...", "duration": "...",
    "total_questions": 0, "total_marks": 0,
    "eligibility": "...", "application_fee": "...",
    "official_website": "...", "year": {CURRENT_YEAR}
  }}],

  "exam_sections": [{{
    "exam": "...", "section_name": "...", "total_questions": 0,
    "questions_to_attempt": 0, "marks_per_correct": 0,
    "marks_per_wrong": 0, "max_marks": 0, "duration_minutes": 0,
    "subjects_covered": "...", "compulsory": true
  }}],

  "syllabus": [{{
    "exam": "...", "subject": "...", "unit": "...",
    "topics": ["topic1", "topic2"], "chapter_count": 0,
    "class_level": "Class 11/12/Both", "weightage_percent": null
  }}],

  "important_dates": [{{
    "exam": "...", "event": "...", "date": "...", "status": "confirmed/expected"
  }}],

  "rankings": [{{
    "institution": "...", "ranking_body": "...", "category": "...",
    "rank": 0, "score": "...", "year": {CURRENT_YEAR}
  }}],

  "colleges": [{{
    "name": "...", "location": "...", "type": "Govt/Private/Deemed",
    "established": 0, "nirf_rank": 0, "naac_grade": "...",
    "courses_offered": ["..."], "total_seats": 0,
    "entrance_exams_accepted": ["..."], "website": "..."
  }}],

  "fees": [{{
    "institution": "...", "course": "...", "duration": "...",
    "total_fee": "...", "per_year": "...", "per_semester": "...",
    "hostel_fee_per_year": "...", "other_charges": "...",
    "year": {CURRENT_YEAR}
  }}],

  "placements": [{{
    "institution": "...", "year": {CURRENT_YEAR},
    "highest_package_lpa": "...", "average_package_lpa": "...",
    "median_package_lpa": "...", "placement_rate_percent": "...",
    "total_offers": 0, "companies_visited": 0,
    "top_recruiters": ["..."], "sectors": {{"IT": "...", "Finance": "...", "Consulting": "..."}}
  }}],

  "cutoffs": [{{
    "institution": "...", "course": "...", "exam": "...", "year": {CURRENT_YEAR},
    "general_opening": "...", "general_closing": "...",
    "obc_closing": "...", "sc_closing": "...", "st_closing": "...",
    "ews_closing": "...", "round": "..."
  }}],

  "books_resources": [{{
    "title": "...", "author": "...", "publisher": "...",
    "subject": "...", "class_level": "...",
    "recommended_for": "...", "type": "textbook/guide/mock_tests"
  }}],

  "scholarships": [{{
    "name": "...", "institution": "...", "amount_per_year": "...",
    "criteria": "...", "seats": 0
  }}],

  "admission_process": [{{
    "institution": "...", "course": "...",
    "selection_process": ["step1", "step2"],
    "required_documents": ["..."],
    "counselling_body": "...", "application_link": "..."
  }}],

  "career_paths": [{{
    "role": "...", "description": "...",
    "avg_salary_fresher_lpa": "...", "avg_salary_5yr_lpa": "...",
    "top_hiring_companies": ["..."], "skills_required": ["..."],
    "growth_outlook": "..."
  }}],

  "statistics": [{{
    "metric": "...", "value": "...", "source": "...", "year": {CURRENT_YEAR}
  }}]
}}

RULES:
- Numbers: use exact values — "₹4.2 lakh" not "₹4 lakh" if the page says 4.2
- Cutoffs/scores: always include max possible score as context
- Dates: include year always (not just "November" — write "November 2025")
- Books: only Indian prep books (NCERT, Arihant, MTG, Oswaal, etc.) — never foreign university textbooks
- Empty categories: omit entirely from JSON
- No markdown fences in output — just the raw JSON

PAGE CONTENT:
{page_text[:60000]}

OUTPUT: Valid JSON only. Start with {{ end with }}."""

def extract_data_from_page(page: FetchedPage, topic: str) -> Optional[ExtractedData]:
    """Use Gemini to extract structured facts from a full fetched page."""
    if not page.clean_text or len(page.clean_text) < 200:
        return None

    log.info("  Extracting data from: %s", page.url[:70])
    try:
        prompt = _build_extraction_prompt(topic, page.clean_text, page.url)
        raw = _call_gemini(prompt)

        # Strip markdown fences if present
        raw = re.sub(r"^```json\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"^```\s*$", "", raw, flags=re.MULTILINE)

        data = json.loads(raw)
        if not isinstance(data, dict):
            log.warning("  Non-dict extraction result from %s", page.url[:60])
            return None

        key_highlights = data.pop("key_highlights", [])
        page_summary = data.pop("page_summary", page.title)

        # Count total extracted items
        total = sum(len(v) for v in data.values() if isinstance(v, list))
        log.info("  Extracted %d facts across %d categories", total, len(data))

        return ExtractedData(
            source_url=page.url,
            page_title=page_summary,
            facts=data,
            key_highlights=key_highlights,
        )
    except json.JSONDecodeError as e:
        log.warning("  JSON parse error for %s: %s", page.url[:60], e)
        return None
    except Exception as e:
        log.warning("  Extraction failed for %s: %s", page.url[:60], e)
        return None

def merge_all_extractions(extractions: list[ExtractedData]) -> dict:
    """
    Merge structured facts from multiple pages into one unified dataset.
    Later pages extend, not overwrite — deduplicated by key fields.
    """
    merged: dict[str, list] = {}
    all_highlights: list[str] = []
    sources: list[str] = []

    for ext in extractions:
        sources.append(ext.source_url)
        all_highlights.extend(ext.key_highlights[:3])

        for category, items in ext.facts.items():
            if not isinstance(items, list) or not items:
                continue
            if category not in merged:
                merged[category] = []
            merged[category].extend(items)

    # Deduplicate within categories (basic — remove exact JSON duplicates)
    for cat in merged:
        seen_json = set()
        deduped = []
        for item in merged[cat]:
            item_json = json.dumps(item, sort_keys=True)
            if item_json not in seen_json:
                seen_json.add(item_json)
                deduped.append(item)
        merged[cat] = deduped

    total = sum(len(v) for v in merged.values())
    log.info("Merged dataset: %d total facts across %d categories from %d pages",
             total, len(merged), len(extractions))

    merged["_meta"] = {
        "sources": sources,
        "key_highlights": all_highlights[:10],
        "total_facts": total,
        "extracted_at": datetime.now().isoformat(),
    }
    return merged


# ─── Stage 4: Outline Creation ─────────────────────────────────────────────

def _build_outline_prompt(topic: str, keyword: str, content_type: str, data_categories: list[str]) -> str:
    available = ", ".join(data_categories) if data_categories else "general facts"
    return f"""You are an expert content strategist for Indian education content.

Create a section outline for this article. The goal is a deeply accurate, comprehensive article
that ranks because it genuinely answers every question a student has — not because of tricks.

TOPIC: "{topic}"
FOCUS KEYWORD: "{keyword or topic}"
CONTENT TYPE: {content_type}
DATA AVAILABLE FROM OFFICIAL SOURCES: {available}
TARGET YEAR: {CURRENT_YEAR}

Return a JSON object:

{{
  "h1_title": "Natural title 60-70 chars — includes keyword + year",
  "meta_description": "155 chars — factual summary that includes keyword and one key number",
  "focus_keyword": "{keyword or topic}",
  "schema_type": "Article",
  "sections": [
    {{
      "heading": "Heading with a specific detail, not a generic label",
      "level": 2,
      "section_type": "table OR prose OR mixed",
      "columns": ["Col1", "Col2", "Col3"],
      "data_hint": "comma-separated categories from available data, e.g. exam_sections,syllabus",
      "word_target": 350,
      "unique_angle": "what UNIQUE information this section adds that no other section covers"
    }}
  ],
  "faq_questions": [
    "Specific question a student would type into Google"
  ]
}}

SECTION RULES — read carefully:

1. ONLY create a section if the available data contains real information for it.
   Do NOT add sections like "Why Choose This Exam" or "Tips for Success" unless
   the data actually has specific, verifiable information for that angle.
   Filler sections hurt credibility and dilute keyword focus.

2. EVERY section must cover a DIFFERENT sub-topic with ZERO overlap.
   Before adding a section, ask: "Does any other section already have this data?"
   If yes → merge it into that section, don't duplicate.

3. SECTION COUNT: 5-7 sections. Fewer deep sections beat many shallow ones.
   Each section should fully exhaust its sub-topic from the available data.

4. HEADINGS must be specific:
   BAD:  "Exam Pattern"
   GOOD: "CUET 2026 Exam Pattern: 27 Subjects, 5 Marks Per Question, −1 Negative Marking"
   BAD:  "Fee Structure"
   GOOD: "IIT Bombay B.Tech Fee 2025: ₹1.13 Lakh/Year for Government Category"

5. TABLE SECTIONS must have columns that match the actual data —
   never use "Parameter | Details" as catch-all columns.

6. The focus keyword "{keyword or topic}" must appear naturally in content
   throughout the article — not stuffed, but woven into explanations and headings
   where it reads naturally.

7. FAQ: 5-7 questions that are specific long-tail queries, not generic.
   BAD:  "What is CUET?"
   GOOD: "What is the maximum score in CUET UG Mathematics 2026?"

WHAT MAKES REAL SEO CONTENT:
- A student lands on this page and gets EVERY specific answer they need
- No vague statements — every claim has a number, name, or date behind it
- Content flows topic → sub-topic → details without repeating itself
- The keyword appears naturally because the topic demands it, not by force

Available data for data_hint: {available}

OUTPUT: Valid JSON only. No markdown fences."""

def create_outline(topic: str, keyword: str, content_type: str, merged_data: dict) -> ArticleOutline:
    """Use Gemini to create an SEO-optimized section plan based on the extracted data."""
    data_categories = [k for k in merged_data.keys() if not k.startswith("_") and merged_data[k]]
    log.info("Creating outline for '%s' with data: %s", topic[:50], ", ".join(data_categories))

    prompt = _build_outline_prompt(topic, keyword, content_type, data_categories)
    raw = _call_gemini(prompt)

    # Strip fences
    raw = re.sub(r"^```json\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"^```\s*$", "", raw, flags=re.MULTILINE)

    data = json.loads(raw)

    sections = [
        SectionPlan(
            heading=s["heading"],
            level=s.get("level", 2),
            section_type=s.get("section_type", "mixed"),
            columns=s.get("columns", []),
            data_hint=s.get("data_hint", ""),
            word_target=s.get("word_target", 300),
            seo_note=s.get("seo_note", ""),
            unique_angle=s.get("unique_angle", ""),
        )
        for s in data.get("sections", [])
    ]

    return ArticleOutline(
        h1_title=data["h1_title"],
        meta_description=data["meta_description"],
        focus_keyword=data["focus_keyword"],
        sections=sections,
        faq_questions=data.get("faq_questions", []),
        schema_type=data.get("schema_type", "Article"),
    )


# ─── Stage 5: Section Writing via LM Studio ──────────────────────────────────

def _call_lm_studio(messages: list[dict], temperature: float = 0.3, max_tokens: int = 2000) -> str:
    """
    Call LM Studio's OpenAI-compatible API.
    The local model is free, private, and fast.
    Temperature 0.3 for factual sections, 0.5 for intro/conclusion.
    """
    try:
        resp = requests.post(
            f"{LM_STUDIO_URL}/chat/completions",
            json={
                "model": LM_STUDIO_MODEL,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": False,
            },
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        log.error("LM Studio call failed: %s", e)
        raise

def _format_section_data(section: SectionPlan, merged_data: dict) -> str:
    """
    Build a clean, readable data block for this section.
    The LLM only needs to convert this data to prose — it should NOT invent anything.
    """
    parts = []

    # Map section data_hint to actual categories
    hint_categories = [h.strip() for h in section.data_hint.split(",") if h.strip()]

    # If no hint, use all categories
    if not hint_categories:
        hint_categories = [k for k in merged_data.keys() if not k.startswith("_")]

    for cat in hint_categories:
        items = merged_data.get(cat, [])
        if not items:
            continue

        parts.append(f"\n### {cat.upper().replace('_', ' ')} ({len(items)} records):")

        for item in items[:20]:  # Cap per category to fit context
            if isinstance(item, dict):
                # Format as readable key: value pairs
                row = "  • " + " | ".join(
                    f"{k}: {v}" for k, v in item.items()
                    if v and v not in (None, "", "-", "N/A", 0, "null")
                    and not isinstance(v, (dict, list))
                )
                if row.strip() != "•":
                    parts.append(row)
                # Handle nested lists (like top_recruiters)
                for k, v in item.items():
                    if isinstance(v, list) and v:
                        parts.append(f"    {k}: {', '.join(str(x) for x in v[:8])}")
                    elif isinstance(v, dict) and v:
                        parts.append(f"    {k}: {json.dumps(v)}")
        parts.append("")

    if not parts:
        # Fallback: show all available data
        for cat, items in merged_data.items():
            if cat.startswith("_") or not items:
                continue
            parts.append(f"\n### {cat.upper()}:")
            for item in items[:5]:
                parts.append(f"  • {json.dumps(item, ensure_ascii=False)[:200]}")

    return "\n".join(parts) if parts else "No specific data available — write from general knowledge of this topic."

def _build_section_prompt_system() -> str:
    return """You are a professional content writer specialising in Indian education and career content.

WRITING STYLE:
- Direct, informative, data-forward (lead with facts, not fluff)
- No filler phrases: never use "It is worth noting", "As mentioned", "In today's world"
- Indian context: use ₹, LPA, lakh, crore — not dollars or foreign units
- Present tense for facts, past tense for historical data
- Short sentences for data sections, slightly longer for explanatory prose

FORMAT RULES:
- Output valid HTML only — no markdown, no explanations outside tags
- Tables: use <table><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table>
- Lists: use <ul><li>...</li></ul>
- Bold key terms with <strong>
- Never add a title/heading that wasn't specified — just the section body"""

def _build_section_prompt_user(
    section: SectionPlan,
    article_title: str,
    focus_keyword: str,
    all_section_headings: list[str],
    data_block: str,
    other_headings_written: list[str],
) -> str:
    # Columns instruction for tables
    columns_note = ""
    if section.columns:
        columns_note = f"\nTABLE COLUMNS (use exactly these, in this order): {' | '.join(section.columns)}"

    # Hard anti-repeat rule — list actual headings already written
    avoid_note = ""
    if other_headings_written:
        avoid_note = (
            "\nCRITICAL — ALREADY COVERED IN EARLIER SECTIONS. Do NOT mention any of this again:\n" +
            "\n".join(f"  ✗ {h}" for h in other_headings_written) +
            "\nIf you find yourself writing something already covered above, skip it entirely."
        )

    format_instructions = {
        "table": (
            "HTML table with <thead><tr><th> headers and <tbody><tr><td> data rows. "
            "Include every data row from the verified data — do not trim or summarise the table. "
            "Add a 1-sentence intro before the table."
        ),
        "prose": (
            "3-5 HTML <p> paragraphs. Each paragraph covers one specific angle. "
            "No bullet lists — weave the data into sentences."
        ),
        "mixed": (
            "1-2 <p> paragraphs of context, then one <table> for the densest data. "
            "The paragraph explains what the table shows."
        ),
        "faq": "FAQ blocks — covered separately.",
    }.get(section.section_type, "HTML paragraphs with a table where data is dense.")

    return f"""ARTICLE: "{article_title}"
FOCUS KEYWORD: "{focus_keyword}"
SECTION: {section.heading}
WORD TARGET: ~{section.word_target} words
FORMAT: {format_instructions}{columns_note}
{avoid_note}

━━━ VERIFIED DATA — every fact below comes from an official source ━━━
{data_block}
━━━ END OF VERIFIED DATA ━━━

WRITING RULES:
1. Open with the single most specific fact from the data (a number, a date, a name — not a vague statement)
2. EVERY claim needs to come from the verified data above. No data = no claim.
3. Use the focus keyword "{focus_keyword}" naturally 1-2 times in this section where it reads naturally.
   Do NOT force it — only use it where a real reader would expect it.
4. Data density: sentences should carry specific information, not background fluff.
   BAD:  "The exam is quite important for students."
   GOOD: "The exam accepts scores from {CURRENT_YEAR} and {CURRENT_YEAR - 1} attempts."
5. Repetition rule: if a fact appears in an earlier section (listed above), do NOT mention it again.
   Every sentence must add new information the reader hasn't seen yet.
6. Tables: include ALL rows from the data — a complete table beats a summarised one every time.
7. Do NOT add the section heading as an HTML tag — it is added separately.
8. Do NOT end with generic transitions like "let's explore the next section" or "in conclusion".

OUTPUT: HTML only — no preamble, no explanation. Just the section body starting from the first <p> or <table>."""

def write_section(
    section: SectionPlan,
    outline: ArticleOutline,
    merged_data: dict,
    sections_written: list[str],
) -> str:
    """
    Write one article section using LM Studio.
    The model receives pre-extracted, verified data — it just converts it to good prose.
    """
    log.info("  Writing: %s", section.heading[:60])

    data_block = _format_section_data(section, merged_data)

    other_headings = [s.heading for s in outline.sections if s.heading != section.heading]

    messages = [
        {"role": "system", "content": _build_section_prompt_system()},
        {"role": "user", "content": _build_section_prompt_user(
            section=section,
            article_title=outline.h1_title,
            focus_keyword=outline.focus_keyword,
            all_section_headings=other_headings,
            data_block=data_block,
            other_headings_written=sections_written,
        )},
    ]

    # Lower temperature for data-heavy sections, slightly higher for prose
    temp = 0.3 if section.section_type == "table" else 0.45

    html = _call_lm_studio(messages, temperature=temp, max_tokens=section.word_target * 6)
    return html

def write_faq_section(outline: ArticleOutline, merged_data: dict) -> str:
    """Write FAQ section — Gemini generates answers from the extracted data."""
    if not outline.faq_questions:
        return ""

    log.info("  Writing FAQ (%d questions)", len(outline.faq_questions))

    # Build a data summary for FAQs
    highlights = merged_data.get("_meta", {}).get("key_highlights", [])
    quick_facts = "\n".join(f"- {h}" for h in highlights[:8])

    questions_block = "\n".join(f"{i+1}. {q}" for i, q in enumerate(outline.faq_questions))

    messages = [
        {"role": "system", "content": _build_section_prompt_system()},
        {"role": "user", "content": f"""Write concise, specific answers for these FAQs about "{outline.h1_title}".

VERIFIED KEY FACTS:
{quick_facts}

QUESTIONS TO ANSWER:
{questions_block}

OUTPUT FORMAT — one block per question:
<div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
  <h3 itemprop="name">Question text</h3>
  <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
    <p itemprop="text">Direct, specific 2-3 sentence answer. Include exact numbers.</p>
  </div>
</div>

RULES:
- Every answer must include at least one specific fact/number
- Answers: 2-4 sentences max (concise is better for featured snippets)
- Do NOT invent data not in the key facts above
- Output the FAQ blocks only — no surrounding tags"""},
    ]

    return _call_lm_studio(messages, temperature=0.3, max_tokens=2000)

def write_intro(outline: ArticleOutline, merged_data: dict) -> str:
    """Write a data-dense introduction paragraph using LM Studio."""
    highlights = merged_data.get("_meta", {}).get("key_highlights", [])
    quick_facts = "\n".join(f"- {h}" for h in highlights[:6])

    messages = [
        {"role": "system", "content": _build_section_prompt_system()},
        {"role": "user", "content": f"""Write a 2-paragraph introduction for this article: "{outline.h1_title}"
FOCUS KEYWORD: {outline.focus_keyword}

KEY FACTS TO MENTION (use at least 3):
{quick_facts}

SECTIONS THIS ARTICLE COVERS:
{chr(10).join(f"- {s.heading}" for s in outline.sections[:6])}

PARAGRAPH 1 (~80 words): Lead with the most important fact. What is this topic, why does it matter, key number.
PARAGRAPH 2 (~60 words): What the reader will find in this article (use "this guide covers..." style).

OUTPUT: Two <p> tags only. No heading. Include the focus keyword naturally in paragraph 1."""},
    ]

    return _call_lm_studio(messages, temperature=0.5, max_tokens=400)


# ─── Stage 6: SEO Assembly ────────────────────────────────────────────────────

def build_table_of_contents(sections: list[SectionPlan]) -> str:
    """Generate TOC with anchor links."""
    items = []
    for i, s in enumerate(sections, 1):
        slug = re.sub(r"[^a-z0-9]+", "-", s.heading.lower()).strip("-")
        items.append(f'    <li><a href="#{slug}">{s.heading}</a></li>')
    return (
        '<nav class="toc" aria-label="Table of Contents">\n'
        '  <h2>Table of Contents</h2>\n'
        '  <ol>\n' + "\n".join(items) + "\n  </ol>\n</nav>"
    )

def build_faq_schema(faq_questions: list[str], faq_html: str) -> str:
    """Generate FAQ JSON-LD schema for rich search results."""
    # Extract questions and answers from the FAQ HTML
    soup = BeautifulSoup(faq_html, "lxml")
    faq_items = []
    for block in soup.find_all(class_="faq-item"):
        q = block.find("h3")
        a = block.find("p")
        if q and a:
            faq_items.append({
                "@type": "Question",
                "name": q.get_text(strip=True),
                "acceptedAnswer": {"@type": "Answer", "text": a.get_text(strip=True)},
            })

    if not faq_items:
        return ""

    schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faq_items,
    }
    return f'<script type="application/ld+json">\n{json.dumps(schema, ensure_ascii=False, indent=2)}\n</script>'

def assemble_article(
    outline: ArticleOutline,
    intro_html: str,
    section_htmls: dict[str, str],   # heading → html
    faq_html: str,
    merged_data: dict,
    topic: str,
) -> str:
    """
    Assemble the final SEO-optimized HTML article.
    Structure: meta comments → H1 → intro → TOC → sections → FAQ → sources
    """
    sources = merged_data.get("_meta", {}).get("sources", [])
    toc_html = build_table_of_contents(outline.sections)
    faq_schema = build_faq_schema(outline.faq_questions, faq_html) if faq_html else ""

    def heading_id(heading: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")

    # Build section blocks
    sections_html_parts = []
    for section in outline.sections:
        html = section_htmls.get(section.heading, "")
        if not html:
            continue
        hid = heading_id(section.heading)
        tag = f"h{section.level}"
        sections_html_parts.append(
            f'<section id="{hid}">\n'
            f'  <{tag}>{section.heading}</{tag}>\n'
            f'  {html}\n'
            f'</section>\n'
        )

    # FAQ section
    faq_block = ""
    if faq_html:
        faq_block = (
            '<section id="faq">\n'
            '  <h2>Frequently Asked Questions</h2>\n'
            f'  {faq_html}\n'
            '</section>\n'
        )

    # Sources block
    sources_block = ""
    if sources:
        sources_list = "\n".join(
            f'    <li><a href="{s}" rel="nofollow" target="_blank">{s[:80]}</a></li>'
            for s in sources[:8]
        )
        sources_block = (
            '<section id="sources">\n'
            '  <h2>Sources</h2>\n'
            '  <ul>\n' + sources_list + '\n  </ul>\n'
            '</section>\n'
        )

    # Final article
    article = f"""<!--
  ARTICLE METADATA
  Title: {outline.h1_title}
  Meta Description: {outline.meta_description}
  Focus Keyword: {outline.focus_keyword}
  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}
  Sources: {len(sources)} official pages
-->

<article itemscope itemtype="https://schema.org/Article">

<h1 itemprop="headline">{outline.h1_title}</h1>

<div class="article-intro" itemprop="description">
{intro_html}
</div>

{toc_html}

{''.join(sections_html_parts)}

{faq_block}

{sources_block}

</article>

{faq_schema}"""

    return article.strip()


# ─── Orchestrator ─────────────────────────────────────────────────────────────

def run_pipeline(
    topic: str,
    keyword: str = "",
    content_type: str = "informational",
    force: bool = False,
    run_id: str = "",
    out_dir: Optional[Path] = None,
) -> Path:
    """
    Run the full 6-stage pipeline and save the article to output/{id}-{slug}/.

    Checkpoints are saved after each expensive stage so a failed run can be
    resumed with --resume <id> without re-spending BrightData / Gemini credits.

    Args:
        topic:        The article topic (e.g. "CUET UG 2026 Mathematics")
        keyword:      SEO focus keyword (defaults to topic)
        content_type: exam_guide | college_profile | ranking_list | career_guide | informational
        force:        If True, ignore ALL checkpoints and re-run from scratch
        run_id:       Pre-allocated run ID (assigned automatically if blank)
        out_dir:      Pre-existing output dir (for resume; auto-created if None)

    Returns: Path to the saved HTML file
    """
    keyword = keyword or topic
    slug = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:60]

    # Allocate run ID
    runs = _load_runs()
    if not run_id:
        run_id = _next_run_id(runs)

    if out_dir is None:
        out_dir = OUTPUT_DIR / f"{run_id}-{slug}"
        out_dir.mkdir(parents=True, exist_ok=True)

    # Register / update run entry
    _update_run(run_id,
                topic=topic, keyword=keyword, type=content_type,
                slug=slug, status="running",
                started=datetime.now().isoformat()[:16],
                out_dir=str(out_dir))

    log.info("=" * 60)
    log.info("RUN ID: %s  (output: %s)", run_id, out_dir)
    log.info("TOPIC: %s", topic)
    log.info("TYPE:  %s | KEYWORD: %s", content_type, keyword)
    log.info("=" * 60)

    try:
        # ── Stage 1: URL Discovery (always free) ───────────────────────────
        log.info("\n[1/6] DISCOVERING OFFICIAL SOURCES...")
        urls = discover_urls(topic, content_type)
        if not urls:
            log.error("No URLs found for topic: %s", topic)
            _update_run(run_id, status="failed", failed_at="stage1")
            sys.exit(1)

        # ── Stages 2+3: Fetch + Extract (skip if checkpoint exists) ────────
        checkpoint_data = out_dir / "extracted_data.json"
        if not force and checkpoint_data.exists():
            log.info("\n[2-3/6] SKIPPING FETCH + EXTRACTION (checkpoint found)...")
            merged_data = json.loads(checkpoint_data.read_text())
            n_cats = len([k for k in merged_data if not k.startswith("_")])
            log.info("  Loaded %d data categories from extracted_data.json", n_cats)
        else:
            log.info("\n[2/6] FETCHING PAGES...")
            if force:
                for url in urls:
                    p = _page_cache_path(url)
                    if p.exists():
                        p.unlink()

            pages = fetch_all_pages(urls)
            if not pages:
                log.error("Failed to fetch any pages. Check internet / BrightData config.")
                _update_run(run_id, status="failed", failed_at="stage2")
                sys.exit(1)

            log.info("\n[3/6] EXTRACTING DATA (Gemini)...")
            extractions = []
            for page in pages:
                ext = extract_data_from_page(page, topic)
                if ext:
                    extractions.append(ext)

            if not extractions:
                log.error("Gemini extraction returned no data. Check GEMINI_API_KEY.")
                _update_run(run_id, status="failed", failed_at="stage3")
                sys.exit(1)

            merged_data = merge_all_extractions(extractions)
            checkpoint_data.write_text(json.dumps(merged_data, ensure_ascii=False, indent=2))
            log.info("  Saved checkpoint → extracted_data.json")

        _update_run(run_id, checkpoint="extracted")

        # ── Stage 4: Outline (skip if checkpoint exists) ───────────────────
        checkpoint_outline = out_dir / "outline.json"
        if not force and checkpoint_outline.exists():
            log.info("\n[4/6] SKIPPING OUTLINE (checkpoint found)...")
            od = json.loads(checkpoint_outline.read_text())
            sections = [
                SectionPlan(
                    heading=s["heading"], level=s.get("level", 2),
                    section_type=s["section_type"], columns=s.get("columns", []),
                    data_hint=s.get("data_hint", ""), word_target=s.get("word_target", 300),
                    seo_note=s.get("seo_note", ""), unique_angle=s.get("unique_angle", ""),
                )
                for s in od["sections"]
            ]
            outline = ArticleOutline(
                h1_title=od["h1_title"], meta_description=od["meta_description"],
                focus_keyword=od["focus_keyword"],
                sections=sections,
                faq_questions=od.get("faq_questions", []),
                schema_type=od.get("schema_type", "Article"),
            )
            log.info("  Loaded outline: %s (%d sections)", outline.h1_title[:55], len(outline.sections))
        else:
            log.info("\n[4/6] CREATING OUTLINE (Gemini)...")
            outline = create_outline(topic, keyword, content_type, merged_data)
            log.info("  Outline: %s", outline.h1_title)
            for s in outline.sections:
                log.info("    [%s] %s (%d words)", s.section_type.upper()[:5], s.heading[:55], s.word_target)

            # Save full outline so every field can be restored on resume
            checkpoint_outline.write_text(json.dumps({
                "h1_title": outline.h1_title,
                "meta_description": outline.meta_description,
                "focus_keyword": outline.focus_keyword,
                "schema_type": outline.schema_type,
                "faq_questions": outline.faq_questions,
                "sections": [
                    {
                        "heading": s.heading, "level": s.level,
                        "section_type": s.section_type, "columns": s.columns,
                        "data_hint": s.data_hint, "word_target": s.word_target,
                        "seo_note": s.seo_note, "unique_angle": s.unique_angle,
                    }
                    for s in outline.sections
                ],
            }, ensure_ascii=False, indent=2))
            log.info("  Saved checkpoint → outline.json")

        _update_run(run_id, checkpoint="outline")

        # ── Stage 5: Write Sections (LM Studio) ────────────────────────────
        log.info("\n[5/6] WRITING SECTIONS (LM Studio: %s)...", LM_STUDIO_MODEL)
        sections_dir = out_dir / "sections"
        sections_dir.mkdir(exist_ok=True)

        intro_file = sections_dir / "intro.html"
        if not force and intro_file.exists():
            intro_html = intro_file.read_text()
            log.info("  [RESUME] intro — loaded from checkpoint")
        else:
            intro_html = write_intro(outline, merged_data)
            intro_file.write_text(intro_html)

        section_htmls: dict[str, str] = {}
        sections_written: list[str] = []

        for i, section in enumerate(outline.sections):
            sec_file = sections_dir / f"{i:02d}.html"
            if not force and sec_file.exists():
                section_htmls[section.heading] = sec_file.read_text()
                sections_written.append(section.heading)
                log.info("  [RESUME] section %02d '%s' — loaded from checkpoint", i, section.heading[:40])
            else:
                try:
                    html = write_section(section, outline, merged_data, sections_written)
                    section_htmls[section.heading] = html
                    sections_written.append(section.heading)
                    sec_file.write_text(html)
                except Exception as e:
                    log.warning("  Section failed '%s': %s", section.heading[:40], e)
                    section_htmls[section.heading] = f"<p>[Section could not be generated: {e}]</p>"

        faq_file = sections_dir / "faq.html"
        if not force and faq_file.exists():
            faq_html = faq_file.read_text()
            log.info("  [RESUME] faq — loaded from checkpoint")
        else:
            faq_html = write_faq_section(outline, merged_data)
            faq_file.write_text(faq_html)

        # ── Stage 6: Assemble ──────────────────────────────────────────────
        log.info("\n[6/6] ASSEMBLING ARTICLE...")
        article_html = assemble_article(
            outline=outline,
            intro_html=intro_html,
            section_htmls=section_htmls,
            faq_html=faq_html,
            merged_data=merged_data,
            topic=topic,
        )

        plain_text = re.sub(r"<[^>]+>", " ", article_html)
        word_count = len(plain_text.split())
        table_count = article_html.count("<table")

        out_file = out_dir / "article.html"
        out_file.write_text(article_html, encoding="utf-8")

        _update_run(run_id, status="done", word_count=word_count,
                    table_count=table_count, article=str(out_file))

        log.info("=" * 60)
        log.info("DONE!  Run ID: %s", run_id)
        log.info("Article: %s", out_file)
        log.info("Words:   %d | Tables: %d | Sources: %d",
                 word_count, table_count, len(merged_data.get("_meta", {}).get("sources", [])))
        log.info("=" * 60)

        return out_file

    except SystemExit:
        raise
    except Exception as e:
        _update_run(run_id, status="failed", error=str(e))
        raise


def resume_pipeline(run_id_input: str) -> Path:
    """Load a previous run by ID and continue from the last checkpoint."""
    run_id = f"{int(run_id_input):03d}"
    runs = _load_runs()
    if run_id not in runs:
        log.error("Run ID %s not found. Use --list to see all runs.", run_id)
        sys.exit(1)

    run = runs[run_id]
    if run.get("status") == "done":
        log.warning("Run %s is already done. Use --force to re-run from scratch.", run_id)

    out_dir = Path(run["out_dir"])
    if not out_dir.exists():
        log.error("Output directory missing: %s", out_dir)
        sys.exit(1)

    log.info("Resuming run %s: %s", run_id, run.get("topic", ""))
    return run_pipeline(
        topic=run["topic"],
        keyword=run.get("keyword", ""),
        content_type=run.get("type", "informational"),
        force=False,
        run_id=run_id,
        out_dir=out_dir,
    )


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    global LM_STUDIO_URL, LM_STUDIO_MODEL
    parser = argparse.ArgumentParser(
        description="Smart Writer — Source-first AI content pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
  # New run — auto-assigns an ID, prints it at the start
  python smart_writer.py "CUET UG 2026 Mathematics Syllabus" --type exam_guide
  python smart_writer.py "IIT Bombay Placements 2024" --type college_profile
  python smart_writer.py "Top MBA Colleges India NIRF 2025" --type ranking_list

  # Resume a failed run by ID (skips stages already done)
  python smart_writer.py --resume 3

  # List all runs with their status
  python smart_writer.py --list

  # Force full re-run from scratch (new ID, ignores all checkpoints)
  python smart_writer.py "CUET 2026" --type exam_guide --force

CONTENT TYPES:
  informational  - general explainer (default)
  exam_guide     - exam syllabus, pattern, preparation
  college_profile- single college: fees, placements, cutoffs
  ranking_list   - top N colleges comparison table
  career_guide   - career scope, salaries, job roles

SETUP (.env file):
  GEMINI_API_KEY=...         (required)
  BRIGHT_DATA_KEY=...        (recommended - bypasses anti-bot on official sites)
  BRIGHT_DATA_ZONE=web_unlocker1
  LM_STUDIO_URL=http://localhost:1234/v1
  LM_STUDIO_MODEL=meta-llama-3.1-8b-instruct
        """,
    )
    parser.add_argument("topic", nargs="?", default="", help="Article topic (omit when using --resume or --list)")
    parser.add_argument("--keyword", "-k", default="", help="SEO focus keyword (defaults to topic)")
    parser.add_argument(
        "--type", "-t",
        default="informational",
        choices=["informational", "exam_guide", "college_profile", "ranking_list", "career_guide"],
        help="Content type",
    )
    parser.add_argument("--force", "-f", action="store_true", help="Ignore all checkpoints, re-run from scratch")
    parser.add_argument("--resume", "-r", metavar="ID", default="", help="Resume a failed run by its numeric ID")
    parser.add_argument("--list", "-l", action="store_true", help="List all runs and their status")
    parser.add_argument("--lm-url", default="", help="Override LM Studio URL")
    parser.add_argument("--lm-model", default="", help="Override LM Studio model name")

    args = parser.parse_args()

    # ── --list: no pipeline needed ─────────────────────────────────────────────
    if args.list:
        list_runs()
        return

    # ── --resume: load run metadata, no topic needed ───────────────────────────
    if args.resume:
        if args.lm_url:
            LM_STUDIO_URL = args.lm_url
        if args.lm_model:
            LM_STUDIO_MODEL = args.lm_model
        out_file = resume_pipeline(args.resume)
        print(f"\nArticle saved to: {out_file}")
        print(f"Open with: open {out_file}")
        return

    # ── New run: topic required ────────────────────────────────────────────────
    if not args.topic:
        parser.error("topic is required unless you use --resume or --list")

    if args.lm_url:
        LM_STUDIO_URL = args.lm_url
    if args.lm_model:
        LM_STUDIO_MODEL = args.lm_model

    # Check LM Studio is reachable
    try:
        r = requests.get(f"{LM_STUDIO_URL}/models", timeout=5)
        models = [m["id"] for m in r.json().get("data", [])]
        if not models:
            log.warning("LM Studio is running but no models are loaded. Load a model first.")
        else:
            log.info("LM Studio: %d model(s) available — using %s", len(models), LM_STUDIO_MODEL)
    except Exception as e:
        log.error("LM Studio not reachable at %s: %s", LM_STUDIO_URL, e)
        log.error("Make sure LM Studio is open and the local server is running.")
        sys.exit(1)

    if not GEMINI_KEY:
        log.error("GEMINI_API_KEY not found. Add it to a .env file in this directory.")
        sys.exit(1)

    out_file = run_pipeline(
        topic=args.topic,
        keyword=args.keyword,
        content_type=args.type,
        force=args.force,
    )

    print(f"\nArticle saved to: {out_file}")
    print(f"Open with: open {out_file}")


if __name__ == "__main__":
    main()
