"""
fetcher.py — HTTP fetching with BrightData fallback, 24-hour disk cache, and entity validation.

Key behaviours:
  - Direct HTTP first (free, works for most .gov.in / .ac.in)
  - BrightData Web Unlocker fallback for JS-heavy / anti-bot pages
  - 24-hour disk cache keyed by URL hash (saves BrightData credits)
  - Entity validation: page text must contain the primary_entity string
    (drops "IIM Bangalore" pages when article is about "IIT Bombay")
  - readability-lxml used to strip nav/footer/ads → clean_text

Usage:
    fetcher = PageFetcher(primary_entity="IIM Ahmedabad")
    page = fetcher.fetch("https://www.iima.ac.in/placements")
    if page.entity_validated:
        ...
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("atlas.fetcher")

BRIGHT_DATA_KEY  = os.getenv("BRIGHT_DATA_KEY", "")
BRIGHT_DATA_ZONE = os.getenv("BRIGHT_DATA_ZONE", "web_unlocker1")
BRIGHTDATA_URL   = "https://api.brightdata.com/request"

CACHE_DIR  = Path(".cache/pages")
CACHE_TTL  = 86400  # 24 hours in seconds

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


# ─── Cache helpers ────────────────────────────────────────────────────────────

def _cache_path(url: str) -> Path:
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / f"{key}.json"


def _read_cache(url: str) -> Optional[dict]:
    path = _cache_path(url)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        age = time.time() - data.get("cached_at", 0)
        if age > CACHE_TTL:
            log.debug(f"Cache expired for {url}")
            return None
        return data
    except Exception:
        return None


def _write_cache(url: str, html: str, title: str, clean_text: str, via: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(url)
    path.write_text(
        json.dumps(
            {"url": url, "html": html, "title": title, "clean_text": clean_text,
             "via": via, "cached_at": time.time()},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


# ─── HTML → clean text ────────────────────────────────────────────────────────

def _extract_clean_text(html: str, url: str) -> tuple[str, str]:
    """
    Returns (title, clean_text).
    Tries readability-lxml first; falls back to BeautifulSoup body text.
    """
    # Try readability-lxml (Firefox Reader algorithm)
    try:
        from readability import Document  # type: ignore
        doc = Document(html)
        title = doc.title() or ""
        summary_html = doc.summary()
        soup = BeautifulSoup(summary_html, "html.parser")
        clean_text = soup.get_text(separator="\n", strip=True)
        return title.strip(), clean_text.strip()
    except ImportError:
        pass
    except Exception as e:
        log.debug(f"readability failed for {url}: {e}")

    # Fallback: BeautifulSoup — remove script/style/nav/footer tags
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()
    body = soup.find("body")
    clean_text = (body or soup).get_text(separator="\n", strip=True)
    return title, clean_text


# ─── Entity validation ────────────────────────────────────────────────────────

def _validate_entity(clean_text: str, primary_entity: str) -> bool:
    """
    Returns True if the primary entity name appears at least TWICE in the page text.
    Requiring 2+ occurrences prevents ranking/list pages (where an entity appears once
    in a table row) from passing validation as a source about that entity.
    E.g. "Top 50 Medical Institutes" page lists RUHS once → rejected.
    RUHS's own admission page has it in title + heading + intro → passes.
    Also checks common abbreviations (acronym, compact form).
    """
    if not primary_entity:
        return True  # no validation configured
    entity_lower = primary_entity.lower()
    text_lower = clean_text.lower()

    # Full name must appear at least twice
    if text_lower.count(entity_lower) >= 2:
        return True
    # Try with commas stripped (e.g. "Amity University, Noida" → "Amity University Noida")
    text_no_comma = text_lower.replace(",", " ").replace("  ", " ")
    if text_no_comma.count(entity_lower) >= 2:
        return True
    # Try without spaces (e.g. "IIM Ahmedabad" → "iimahmedabad") — existence check only
    compact = entity_lower.replace(" ", "")
    if compact in text_lower:
        return True
    # Try acronym: first letter of each meaningful word, skipping stop words
    # e.g. "Rajasthan University of Health Sciences" → "RUHS" (not "RUOHS")
    # e.g. "Indian Institute of Technology" → "IIT" (not "IIOT")
    _STOP = {"of", "the", "for", "and", "in", "a", "an", "at", "by", "to"}
    words = primary_entity.split()
    if len(words) >= 2:
        acronym = "".join(w[0] for w in words if w.lower() not in _STOP).lower()
        if len(acronym) >= 2 and acronym in text_lower:
            return True
        # Also try full acronym including stop words as fallback
        full_acronym = "".join(w[0] for w in words).lower()
        if full_acronym != acronym and full_acronym in text_lower:
            return True
    # Try without the trailing location/campus word (e.g. "SRM... Kanchipuram" →
    # "SRM Institute of Technology" — pages use canonical name without city qualifier)
    if len(words) >= 3:
        short_entity = " ".join(words[:-1]).lower()
        if text_lower.count(short_entity) >= 2:
            return True
        # Also try compact of short entity
        short_compact = short_entity.replace(" ", "")
        if short_compact in text_lower:
            return True
    # Try compact of first 3 words (handles initial-separated names like "G L Bajaj",
    # "C.V. Raman" where page may write "GL Bajaj", "CV Raman" without spaces/dots)
    if len(words) >= 3:
        first3_compact = "".join(w.replace(".", "") for w in words[:3]).lower()
        if len(first3_compact) >= 4:
            # Strip spaces and dots from page text for this check
            text_compact = text_lower.replace(" ", "").replace(".", "")
            if first3_compact in text_compact:
                return True
    return False


# ─── Main fetcher ─────────────────────────────────────────────────────────────

from models import FetchedPage  # noqa: E402


class PageFetcher:
    """
    Fetches a URL and returns a FetchedPage.
    Falls back to BrightData if direct HTTP returns empty/blocked content.
    """

    def __init__(self, primary_entity: str = ""):
        self.primary_entity = primary_entity

    def fetch(self, url: str) -> FetchedPage:
        # 1. Check cache
        cached = _read_cache(url)
        if cached:
            log.info(f"[CACHE] {url}")
            title = cached.get("title", "")
            clean_text = cached.get("clean_text", "")
            validated = _validate_entity(clean_text, self.primary_entity)
            return FetchedPage(
                url=url,
                html=cached.get("html", ""),
                clean_text=clean_text,
                title=title,
                fetched_via="cached",
                entity_validated=validated,
            )

        # 2. Direct HTTP
        page = self._fetch_direct(url)
        if page and not page.error and len(page.clean_text) > 300:
            _write_cache(url, page.html, page.title, page.clean_text, "direct")
            return page

        # 3. BrightData fallback
        if BRIGHT_DATA_KEY:
            log.info(f"[BRIGHTDATA] direct failed or thin — using BrightData for {url}")
            page = self._fetch_brightdata(url)
            if page and not page.error:
                _write_cache(url, page.html, page.title, page.clean_text, "brightdata")
                return page

        # 4. Return whatever we have (possibly error page)
        if page:
            return page
        return FetchedPage(
            url=url, html="", clean_text="", title="",
            fetched_via="failed", entity_validated=False,
            error="All fetch methods failed",
        )

    def _fetch_direct(self, url: str) -> Optional[FetchedPage]:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20, allow_redirects=True)
            if resp.status_code >= 400:
                return FetchedPage(
                    url=url, html="", clean_text="", title="",
                    fetched_via="direct", entity_validated=False,
                    error=f"HTTP {resp.status_code}",
                )
            html = resp.text
            title, clean_text = _extract_clean_text(html, url)
            validated = _validate_entity(clean_text, self.primary_entity)
            if not validated:
                log.warning(f"[ENTITY FAIL] '{self.primary_entity}' not found in {url}")
            return FetchedPage(
                url=url, html=html, clean_text=clean_text, title=title,
                fetched_via="direct", entity_validated=validated,
            )
        except Exception as e:
            log.debug(f"Direct fetch failed for {url}: {e}")
            return FetchedPage(
                url=url, html="", clean_text="", title="",
                fetched_via="direct", entity_validated=False,
                error=str(e),
            )

    def _fetch_brightdata(self, url: str) -> Optional[FetchedPage]:
        if not BRIGHT_DATA_KEY:
            return None
        try:
            resp = requests.post(
                BRIGHTDATA_URL,
                headers={
                    "Authorization": f"Bearer {BRIGHT_DATA_KEY}",
                    "Content-Type": "application/json",
                },
                json={"zone": BRIGHT_DATA_ZONE, "url": url, "format": "raw"},
                timeout=60,
            )
            resp.raise_for_status()
            html = resp.text
            title, clean_text = _extract_clean_text(html, url)
            validated = _validate_entity(clean_text, self.primary_entity)
            if not validated:
                log.warning(f"[ENTITY FAIL via BD] '{self.primary_entity}' not found in {url}")
            return FetchedPage(
                url=url, html=html, clean_text=clean_text, title=title,
                fetched_via="brightdata", entity_validated=validated,
            )
        except Exception as e:
            log.warning(f"BrightData fetch failed for {url}: {e}")
            return FetchedPage(
                url=url, html="", clean_text="", title="",
                fetched_via="brightdata", entity_validated=False,
                error=str(e),
            )

    def fetch_many(self, urls: list[str], delay: float = 1.0) -> list[FetchedPage]:
        """
        Fetch a list of URLs sequentially with a small delay.
        Returns all pages (including failed ones — callers filter by entity_validated + error).
        """
        results = []
        for i, url in enumerate(urls):
            log.info(f"Fetching {i+1}/{len(urls)}: {url}")
            page = self.fetch(url)
            results.append(page)
            if i < len(urls) - 1:
                time.sleep(delay)
        return results
