"""
stage3_sources.py — Targeted Source Discovery (per sub-topic DDG search)

Input:  Blueprint (sub_topics with search_queries)
Output: SourceList dataclass + sources.json checkpoint

Strategy:
  For each sub-topic in the blueprint:
    - Run its specific DDG search queries
    - Filter results to official/authoritative domains (.gov.in, .ac.in, .nic.in, .edu.in)
    - Also try known official sources from the OFFICIAL_SOURCES map
    - Prioritise PDF URLs (placement reports, official bulletins)

  Dedup across sub-topics so we don't fetch the same URL twice.
  Final sources.json maps sub_topic_id → list of URLs.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from models import Blueprint, SourceList

log = logging.getLogger("atlas.stage3")

DDG_SEARCH_URL = "https://lite.duckduckgo.com/lite/"

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

# Authoritative domain suffixes to prefer in DDG results
AUTHORITATIVE_SUFFIXES = (
    ".gov.in", ".ac.in", ".nic.in", ".edu.in", ".res.in",
    ".iitb.ac.in", ".iitd.ac.in", ".iitm.ac.in", ".iitk.ac.in",
    ".iitkgp.ac.in", ".iitr.ac.in", ".iima.ac.in", ".iimb.ac.in",
    ".iimcal.ac.in", ".nirfindia.org",
)


def _ddg_search(query: str, max_results: int = 5) -> list[str]:
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
            if len(urls) >= max_results * 3:  # over-fetch, then filter
                break
        return urls
    except Exception as e:
        log.debug(f"DDG search failed for '{query}': {e}")
        return []


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

    # Always include official sources for this entity
    official_urls = _official_urls_for_entity(blueprint.primary_entity)
    if official_urls:
        log.info(f"Stage 3: adding {len(official_urls)} pre-mapped official URLs")

    for st in blueprint.sub_topics:
        st_urls: list[str] = []

        # Start with official sources for every sub-topic (they often have all data)
        for u in official_urls:
            if u not in seen_urls:
                st_urls.append(u)
                seen_urls.add(u)

        # Run DDG queries for this sub-topic
        for query in st.search_queries:
            log.info(f"  DDG: {query}")
            results = _ddg_search(query, max_results=6)
            time.sleep(0.5)  # polite delay

            # Sort: PDFs first, then authoritative domains, then rest
            pdfs = [u for u in results if _is_pdf(u)]
            auth = [u for u in results if _is_authoritative(u) and not _is_pdf(u)]
            rest = [u for u in results if not _is_pdf(u) and not _is_authoritative(u)]
            ordered = pdfs + auth + rest

            for url in ordered:
                if url not in seen_urls and len(st_urls) < 6:
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
