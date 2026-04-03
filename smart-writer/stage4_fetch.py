"""
stage4_fetch.py — Targeted Fetch with Entity Validation

Input:  SourceList (all_urls) + Blueprint (primary_entity)
Output: dict[url → FetchedPage] + fetched_pages.json checkpoint

Key behaviour:
  - Fetches every URL from Stage 3 using PageFetcher (direct → BrightData → cache)
  - Entity validation: page must contain primary_entity name or it is dropped
  - Saves clean_text per URL to disk for Stage 5 to read
  - Skips URLs already fetched (checkpoint-based resume)

Entity validation example:
  Topic "IIM Ahmedabad Placements" → primary_entity "IIM Ahmedabad"
  If DDG returned iimb.ac.in (IIM Bangalore) → that page is DROPPED, never reaches extractor.
  This was the #1 failure mode in v1.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fetcher import PageFetcher
from models import Blueprint, FetchedPage, SourceList

log = logging.getLogger("atlas.stage4")


def run(
    blueprint: Blueprint,
    source_list: SourceList,
    run_dir: Path,
) -> dict[str, FetchedPage]:
    """
    Run Stage 4. Returns dict[url → FetchedPage] (validated pages only).
    Saves fetched_pages.json (metadata, not full HTML) to run_dir.
    Loads from checkpoint if already exists.
    """
    checkpoint = run_dir / "fetched_pages.json"
    pages_dir = run_dir / "pages"
    pages_dir.mkdir(exist_ok=True)

    # Build URL list from source_list
    urls = source_list.all_urls
    if not urls:
        log.warning("Stage 4: no URLs to fetch")
        return {}

    # Load existing checkpoint metadata
    existing_meta: dict = {}
    if checkpoint.exists():
        existing_meta = json.loads(checkpoint.read_text(encoding="utf-8"))

    # Check if all URLs already fetched
    all_done = all(url in existing_meta for url in urls)
    if all_done:
        log.info("Stage 4: loading all pages from checkpoint")
        return _load_from_checkpoint(existing_meta, pages_dir, blueprint.primary_entity)

    log.info(f"Stage 4: fetching {len(urls)} URLs (entity='{blueprint.primary_entity}')")
    fetcher = PageFetcher(primary_entity=blueprint.primary_entity)

    results: dict[str, FetchedPage] = {}
    meta: dict = dict(existing_meta)  # preserve already-fetched

    for i, url in enumerate(urls):
        if url in meta:
            log.info(f"  [{i+1}/{len(urls)}] SKIP (cached): {url[:80]}")
            continue

        log.info(f"  [{i+1}/{len(urls)}] Fetching: {url[:80]}")
        page = fetcher.fetch(url)

        # Save page text to disk (pages/{hash}.txt)
        page_file = pages_dir / f"{_slug(url)}.txt"
        page_file.write_text(page.clean_text, encoding="utf-8")

        meta[url] = {
            "url": url,
            "title": page.title,
            "fetched_via": page.fetched_via,
            "entity_validated": page.entity_validated,
            "error": page.error,
            "text_file": str(page_file.relative_to(run_dir)),
            "text_len": len(page.clean_text),
        }

        if page.entity_validated and not page.error:
            results[url] = page
            log.info(f"    ✓ validated ({len(page.clean_text)} chars, via {page.fetched_via})")
        elif not page.entity_validated and not page.error:
            log.warning(f"    ✗ entity validation failed — dropped")
        else:
            log.warning(f"    ✗ fetch error: {page.error}")

    # Save checkpoint
    checkpoint.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # Also load previously validated pages from checkpoint
    for url, info in existing_meta.items():
        if url not in results and info.get("entity_validated") and not info.get("error"):
            text_file = run_dir / info["text_file"]
            if text_file.exists():
                clean_text = text_file.read_text(encoding="utf-8")
                results[url] = FetchedPage(
                    url=url,
                    html="",  # not stored to save disk
                    clean_text=clean_text,
                    title=info.get("title", ""),
                    fetched_via=info.get("fetched_via", "cached"),
                    entity_validated=True,
                )

    validated = len(results)
    total = len(urls)
    log.info(f"Stage 4: {validated}/{total} pages passed entity validation")

    if validated == 0:
        log.warning("Stage 4: WARNING — no pages passed entity validation. "
                    "Check primary_entity spelling or widen entity check.")

    return results


def _load_from_checkpoint(
    meta: dict,
    pages_dir: Path,
    primary_entity: str,
) -> dict[str, FetchedPage]:
    results = {}
    for url, info in meta.items():
        if not info.get("entity_validated") or info.get("error"):
            continue
        text_file = pages_dir / Path(info["text_file"]).name
        if text_file.exists():
            clean_text = text_file.read_text(encoding="utf-8")
            results[url] = FetchedPage(
                url=url,
                html="",
                clean_text=clean_text,
                title=info.get("title", ""),
                fetched_via=info.get("fetched_via", "cached"),
                entity_validated=True,
            )
    return results


def _slug(url: str) -> str:
    """Short deterministic filename for a URL."""
    import hashlib
    return hashlib.md5(url.encode()).hexdigest()[:12]
