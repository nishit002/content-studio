"""
stage5_extract.py — Sub-topic Extraction (Gemini, per sub-topic)

Input:  Blueprint (sub_topics), SourceList (by_sub_topic), validated pages dict
Output: list[SubTopicExtraction] + extracted/{sub_topic_id}.json checkpoints

What Gemini does here:
  - For each sub-topic, receives ONLY the pages assigned to that sub-topic
  - Receives ONLY the data_needed field list from the blueprint
  - Targeted extraction: extracts exactly what the blueprint asked for, nothing else
  - Full tables extracted verbatim (not summarised)

Why targeted extraction beats "extract everything":
  - "Extract everything" → huge noisy JSON → extractor invents data to fill gaps
  - "Extract avg_package, median_package, top_recruiter_count" → extractor focuses
    on those exact fields → much higher accuracy
"""

from __future__ import annotations
import concurrent.futures
import threading as _threading

import json
import logging
from pathlib import Path

from llm_client import GeminiClient
from models import Blueprint, FetchedPage, SourceList, SubTopicExtraction

log = logging.getLogger("atlas.stage5")

EXTRACT_PROMPT = """\
You are extracting data from official web pages to populate a specific section of an article.

Sub-topic: {sub_topic_name}
Data fields required: {data_needed}

Pages to extract from:
{pages_text}

Extract ONLY the data fields listed above. Return a JSON object:
{{
  "data": {{
    "<field_name>": "<value WITH full qualifying context>",
    ...
  }},
  "raw_tables": [
    {{
      "title": "table heading if any",
      "columns": ["col1", "col2", "..."],
      "rows": [
        ["val1", "val2", "..."],
        ...
      ]
    }}
  ],
  "extraction_notes": "anything unusual, missing data, conflicting sources, caveats"
}}

═══ CORE EXTRACTION RULES ═══
1. Extract ONLY facts EXPLICITLY PRESENT in the page text. Do NOT infer or estimate.
2. For tables: extract ALL rows verbatim. Do NOT summarise.
3. If a required field is not found: set its value to null.
4. If a page is from the wrong institution, ignore it entirely.
5. raw_tables: only include tables where >50% of rows contain numbers or named entities.

═══ CONTEXTUAL DATA RULES (critical — missing context = useless data) ═══

FEES — every fee value MUST include:
  - The specific programme/course it applies to (B.Tech CSE, MBA, MCA, etc.)
  - Whether it is annual / per semester / total for full programme duration
  - The academic year it is valid for (e.g. "2024-25")
  BAD:  "total_fees": "₹12.23 lakh"
  GOOD: "total_fees": "₹3.07 lakh per year for B.Tech (4-year total: ₹12.28 lakh) — as per 2024-25 fee structure"
  If the source does not specify per-year vs total, write exactly what the source says and append "(duration unspecified)"

PACKAGES / SALARY — every package value MUST include:
  - Batch year (e.g. "Batch of 2024")
  - Whether it is average / median / highest / minimum
  - The branch or stream if specified
  BAD:  "avg_package": "24.2 LPA"
  GOOD: "avg_package": "24.2 LPA average CTC — Batch 2024, all branches combined"

DATES — every date MUST include:
  - What the date is for (application start, exam date, result date, etc.)
  - Whether it is confirmed or expected/tentative
  BAD:  "exam_date": "May 15, 2025"
  GOOD: "exam_date": "May 15, 2025 (tentative — official notification pending)"

RANKINGS / SCORES — every rank MUST include:
  - Which ranking body (NIRF, QS, Times, etc.)
  - The year of the ranking
  - The category (Engineering, Overall, Management, etc.)
  BAD:  "nirf_rank": "42"
  GOOD: "nirf_rank": "42 in Engineering — NIRF Rankings 2024"

CONFLICTING SOURCES — if two sources give DIFFERENT values for the same field:
  - Report BOTH values in extraction_notes with their source URLs
  - Use the official institution website value in data{{}} if available; otherwise use the more recent value
  - Mark the field with "(verify: sources conflict)" appended to the value
"""


def run(
    blueprint: Blueprint,
    source_list: SourceList,
    pages: dict[str, FetchedPage],
    run_dir: Path,
) -> list[SubTopicExtraction]:
    """
    Run Stage 5. Returns list of SubTopicExtraction (one per sub-topic).
    Saves extracted/{sub_topic_id}.json per sub-topic.
    Loads from checkpoint if already exists.
    """
    extracted_dir = run_dir / "extracted"
    extracted_dir.mkdir(exist_ok=True)

    if not pages:
        log.warning("Stage 5: no validated pages to extract from")
        return []

    # ── Parallel extraction: one GeminiClient per thread (key rotation is module-level) ──
    _ckpt_lock = _threading.Lock()

    def _extract_one(st) -> SubTopicExtraction:
        checkpoint = extracted_dir / f"{st.id}.json"
        if checkpoint.exists():
            log.info(f"  Stage 5 [{st.id}]: loading from checkpoint")
            data = json.loads(checkpoint.read_text(encoding="utf-8"))
            return SubTopicExtraction(
                sub_topic_id=data["sub_topic_id"],
                source_urls=data["source_urls"],
                data=data["data"],
                raw_tables=data.get("raw_tables", []),
                extraction_notes=data.get("extraction_notes", ""),
            )

        st_urls = source_list.by_sub_topic.get(st.id, [])
        st_pages = [pages[u] for u in st_urls if u in pages]

        if not st_pages:
            log.warning(f"  Stage 5 [{st.id}]: no validated pages — skipping")
            return SubTopicExtraction(
                sub_topic_id=st.id, source_urls=[],
                data={f: None for f in st.data_needed},
                raw_tables=[], extraction_notes="No validated pages available",
            )

        log.info(f"  Stage 5 [{st.id}]: extracting from {len(st_pages)} pages")
        pages_text = _build_pages_text(st_pages, max_chars_per_page=3000)
        prompt = EXTRACT_PROMPT.format(
            sub_topic_name=st.name,
            data_needed=", ".join(st.data_needed),
            pages_text=pages_text.replace("{", "{{").replace("}", "}}"),
        )

        client = GeminiClient()  # each thread gets own client; key rotation is module-level+thread-safe
        try:
            result = client.generate_json(prompt, temperature=0.1, max_tokens=8192)
        except Exception as e:
            log.warning(f"  Stage 5 [{st.id}]: Gemini failed: {e}")
            result = {"data": {}, "raw_tables": [], "extraction_notes": f"Gemini error: {e}"}

        extraction = SubTopicExtraction(
            sub_topic_id=st.id,
            source_urls=[p.url for p in st_pages],
            data=result.get("data", {}),
            raw_tables=result.get("raw_tables", []),
            extraction_notes=result.get("extraction_notes", ""),
        )
        with _ckpt_lock:
            checkpoint.write_text(
                json.dumps({
                    "sub_topic_id": st.id,
                    "source_urls": extraction.source_urls,
                    "data": extraction.data,
                    "raw_tables": extraction.raw_tables,
                    "extraction_notes": extraction.extraction_notes,
                }, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        non_null = sum(1 for v in extraction.data.values() if v is not None)
        log.info(f"  Stage 5 [{st.id}]: {non_null}/{len(st.data_needed)} fields, {len(extraction.raw_tables)} tables")
        return extraction

    # Run all sub-topics in parallel (max 3 workers = one per Gemini key)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(_extract_one, st): st.id for st in blueprint.sub_topics}
        # Preserve original sub-topic order
        id_to_result = {}
        for fut in concurrent.futures.as_completed(futures):
            st_id = futures[fut]
            try:
                id_to_result[st_id] = fut.result()
            except Exception as e:
                log.error(f"  Stage 5 [{st_id}]: worker crashed: {e}")

    results = [id_to_result[st.id] for st in blueprint.sub_topics if st.id in id_to_result]
    log.info(f"Stage 5: done — {len(results)}/{len(blueprint.sub_topics)} sub-topics extracted")
    return results


def _build_pages_text(pages: list[FetchedPage], max_chars_per_page: int = 3000) -> str:
    """Build a combined text block from multiple pages for a single Gemini call."""
    parts = []
    for i, page in enumerate(pages):
        text = page.clean_text[:max_chars_per_page]
        parts.append(f"=== Source {i+1}: {page.title or page.url} ===\n{text}")
    return "\n\n".join(parts)
