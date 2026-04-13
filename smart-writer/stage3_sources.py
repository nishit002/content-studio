"""
stage3_sources.py — Targeted Source Discovery (per sub-topic You.com search)

Input:  Blueprint (sub_topics with search_queries)
Output: SourceList dataclass + sources.json checkpoint

Strategy:
  For each sub-topic in the blueprint:
    - Run its specific You.com search queries (17 rotating keys)
    - Include ALL results (not just official domains) — the system picks the best
    - Priority ordering: PDFs > official (.gov.in/.ac.in) > known portals > rest
    - Also run a broad "top sources" search per article type to surface aggregators

  A broad "top results" search for the full topic is run first. Whatever ranks
  well for the topic is included — Collegedunia, Shiksha, Careers360,
  official PDFs, news articles — all of it. No domain filtering at this stage.
  Entity validation (Stage 4) handles quality control.

  Dedup across sub-topics so we don't fetch the same URL twice.
  Final sources.json maps sub_topic_id → list of URLs.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import threading
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from models import Blueprint, SourceList

load_dotenv()
log = logging.getLogger("atlas.stage3")

DDG_SEARCH_URL = "https://lite.duckduckgo.com/lite/"

# You.com search keys — same pool as content-generator pipeline
_YOU_KEYS: list[str] = [k.strip() for k in os.getenv("YOU_API_KEYS", "").split(",") if k.strip()]
_you_key_index = 0
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

# Official source map: entity keyword → authoritative domains to always include
OFFICIAL_SOURCES: dict[str, list[str]] = {
    "cuet":             ["https://nta.ac.in/", "https://cuet.samarth.ac.in/"],
    "jee main":         ["https://jeemain.nta.nic.in/", "https://nta.ac.in/"],
    "jee advanced":     ["https://jeeadv.ac.in/"],
    "neet":             ["https://neet.nta.nic.in/", "https://nta.ac.in/"],
    "gate":             ["https://gate2025.iitr.ac.in/", "https://gate.iitg.ac.in/"],
    "cat":              ["https://iimcat.ac.in/"],
    "upsc":             ["https://www.upsc.gov.in/examinations/active-examinations"],
    "ssc":              ["https://ssc.nic.in/"],
    "clat":             ["https://consortiumofnlus.ac.in/"],
    "nirf":             ["https://www.nirfindia.org/Rankings",
                         "https://www.nirfindia.org/2024/EngineeringRanking.html",
                         "https://www.nirfindia.org/2024/ManagementRanking.html"],
    "josaa":            ["https://josaa.nic.in/"],
    "iit bombay":       ["https://www.iitb.ac.in/", "https://placements.iitb.ac.in/"],
    "iit delhi":        ["https://home.iitd.ac.in/", "https://placements.iitd.ac.in/"],
    "iit madras":       ["https://www.iitm.ac.in/"],
    "iit kanpur":       ["https://www.iitk.ac.in/", "https://www.iitk.ac.in/spo/"],
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
    "manipal":          ["https://manipal.edu/mu.html"],
    "delhi university": ["https://du.ac.in/"],
    "ugc":              ["https://www.ugc.gov.in/"],
    "aicte":            ["https://www.aicte-india.org/"],
}

# Authoritative domain suffixes to prefer in results
AUTHORITATIVE_SUFFIXES = (
    ".gov.in", ".ac.in", ".nic.in", ".edu.in", ".res.in",
    ".iitb.ac.in", ".iitd.ac.in", ".iitm.ac.in", ".iitk.ac.in",
    ".iitkgp.ac.in", ".iitr.ac.in", ".iima.ac.in", ".iimb.ac.in",
    ".iimcal.ac.in", ".nirfindia.org",
)

# Known low-quality domains to skip
SKIP_DOMAINS = {
    "quora.com", "reddit.com", "youtube.com", "facebook.com",
    "twitter.com", "linkedin.com", "amazon.com", "flipkart.com",
    "snapdeal.com", "justdial.com", "indiamart.com",
}


def _is_low_quality(url: str) -> bool:
    from urllib.parse import urlparse
    domain = urlparse(url).netloc.lower().lstrip("www.")
    return any(bad in domain for bad in SKIP_DOMAINS)


def _broad_topic_queries(entity: str, article_type: str, year: str | None) -> list[str]:
    """
    Generate 2-3 broad search queries that will surface the best pages
    for this topic regardless of domain. The system decides which sources rank.
    """
    y = year or "2025"
    if article_type == "college_placement":
        return [
            f"{entity} placement {y} average package top recruiters",
            f"{entity} campus placement statistics {y}",
        ]
    elif article_type == "fee_reference":
        return [
            f"{entity} fees {y} total cost structure",
            f"{entity} tuition fees hostel charges {y}",
        ]
    elif article_type == "admission_guide":
        return [
            f"{entity} admission {y} eligibility process",
            f"{entity} cutoff {y} merit list",
        ]
    elif article_type == "college_profile":
        return [
            f"{entity} overview courses ranking {y}",
            f"{entity} admission fees placement {y}",
        ]
    elif article_type == "exam_guide":
        return [
            f"{entity} syllabus exam pattern {y}",
            f"{entity} eligibility important dates {y}",
        ]
    elif article_type == "ranking_list":
        return [
            f"{entity} {y} complete ranking list",
        ]
    else:
        return [
            f"{entity} {y}",
        ]


def _you_search(query: str, max_results: int = 5) -> list[str]:
    """Search via You.com REST API with key rotation. Returns list of URLs."""
    global _you_key_index
    if not _YOU_KEYS:
        return []
    key = _YOU_KEYS[_you_key_index % len(_YOU_KEYS)]
    _you_key_index = (_you_key_index + 1) % len(_YOU_KEYS)
    try:
        resp = requests.get(
            "https://ydc-index.io/v1/search",
            params={"query": query, "count": max_results * 2, "country": "IN", "language": "EN"},
            headers={"X-API-Key": key},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        hits = data.get("results", {}).get("web", [])
        _record_you_request(key, True)
        return [h["url"] for h in hits if h.get("url", "").startswith("http")][:max_results * 3]
    except Exception as e:
        _record_you_request(key, False)
        log.debug(f"You.com search failed for '{query}': {e}")
        return []


def _ddg_search(query: str, max_results: int = 5) -> list[str]:
    """Fallback: DuckDuckGo Lite scrape. Used only if You.com returns nothing."""
    try:
        resp = requests.post(
            DDG_SEARCH_URL,
            data={"q": query, "kl": "in-en"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        urls = []
        for a in soup.select("a.result-link"):
            href = a.get("href", "")
            if href.startswith("http") and "duckduckgo.com" not in href:
                urls.append(href)
            if len(urls) >= max_results * 3:
                break
        return urls
    except Exception as e:
        log.debug(f"DDG search failed for '{query}': {e}")
        return []


def _search(query: str, max_results: int = 5) -> list[str]:
    """Primary: You.com (17 rotating keys). Fallback: DDG."""
    results = _you_search(query, max_results)
    if results:
        return results
    log.debug(f"You.com returned nothing for '{query[:50]}', trying DDG fallback")
    return _ddg_search(query, max_results)


def _is_authoritative(url: str) -> bool:
    """Prefer .gov.in / .ac.in / .nic.in / known official domains."""
    lower = url.lower()
    return any(suf in lower for suf in AUTHORITATIVE_SUFFIXES)


def _is_pdf(url: str) -> bool:
    return url.lower().endswith(".pdf") or "filetype=pdf" in url.lower()


def _official_urls_for_entity(entity: str) -> list[str]:
    """Return pre-mapped official URLs if entity matches any key."""
    entity_lower = entity.lower()
    for key, urls in OFFICIAL_SOURCES.items():
        if key in entity_lower:
            return urls
    return []


def run(blueprint: Blueprint, run_dir: Path) -> SourceList:
    """
    Run Stage 3. Returns SourceList and saves sources.json to run_dir.
    Loads from checkpoint if already exists.
    """
    checkpoint = run_dir / "sources.json"

    if checkpoint.exists():
        log.info("Stage 3: loading from checkpoint")
        data = json.loads(checkpoint.read_text(encoding="utf-8"))
        sl = SourceList(
            by_sub_topic=data.get("by_sub_topic", {}),
            all_urls=data.get("all_urls", []),
        )
        return sl

    log.info(f"Stage 3: discovering sources for {len(blueprint.sub_topics)} sub-topics")

    by_sub_topic: dict[str, list[str]] = {}
    seen_urls: set[str] = set()

    # ── Step A: Broad topic search — surfaces whatever ranks best (no domain filter) ──
    broad_queries = _broad_topic_queries(
        blueprint.primary_entity, blueprint.article_type, blueprint.year
    )
    broad_urls: list[str] = []
    log.info(f"Stage 3: running {len(broad_queries)} broad topic searches")
    for query in broad_queries:
        log.info(f"  Broad: {query}")
        results = _search(query, max_results=8)
        for url in results:
            if url not in seen_urls and not _is_low_quality(url):
                broad_urls.append(url)
                seen_urls.add(url)
    log.info(f"Stage 3: broad search found {len(broad_urls)} URLs")

    # ── Step B: Always include official pre-mapped sources for this entity ────
    official_urls = _official_urls_for_entity(blueprint.primary_entity)
    if official_urls:
        log.info(f"Stage 3: adding {len(official_urls)} pre-mapped official URLs")

    # ── Step C: Per sub-topic search ──────────────────────────────────────────
    for st in blueprint.sub_topics:
        st_urls: list[str] = []

        # Broad search URLs first — includes any high-ranking page for this topic
        for u in broad_urls:
            if u not in st_urls:
                st_urls.append(u)

        # Official pre-mapped sources
        for u in official_urls:
            if u not in seen_urls:
                st_urls.append(u)
                seen_urls.add(u)

        # Run queries specific to this sub-topic
        for query in st.search_queries:
            log.info(f"  Search: {query}")
            results = _search(query, max_results=6)

            # Sort: PDFs first, then official domains, then everything else (no exclusions)
            pdfs = [u for u in results if _is_pdf(u)]
            auth = [u for u in results if _is_authoritative(u) and not _is_pdf(u)]
            rest = [u for u in results if not _is_pdf(u) and not _is_authoritative(u)
                    and not _is_low_quality(u)]
            ordered = pdfs + auth + rest

            for url in ordered:
                if url not in seen_urls and len(st_urls) < 10:
                    st_urls.append(url)
                    seen_urls.add(url)

        by_sub_topic[st.id] = st_urls
        log.info(f"  {st.id}: {len(st_urls)} sources")

    all_urls = list(seen_urls)
    source_list = SourceList(by_sub_topic=by_sub_topic, all_urls=all_urls)

    checkpoint.write_text(
        json.dumps({"by_sub_topic": by_sub_topic, "all_urls": all_urls}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info(f"Stage 3: {len(all_urls)} unique URLs across all sub-topics")
    return source_list
