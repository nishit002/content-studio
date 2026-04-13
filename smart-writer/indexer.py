"""
indexer.py — Targeted extraction + verification (Gemini) for ATLAS.

Replaces Stages 5 (sub-topic extraction) + 6 (fact verification) with a
single Gemini pass per sub-topic that extracts AND verifies in one call.

Why one pass instead of two:
  - Stage 5 extracted from plain text (tables already lost by readability).
    Now we feed markdown text where tables are | col | col | rows — Gemini
    can read and extract full table data correctly.
  - Stage 6 was a second Gemini call to re-verify what Stage 5 extracted.
    With You.com research (not DDG + BrightData), source quality is higher
    so we can verify inline: "extract this field AND cite where you found it."
  - 50% fewer Gemini calls, better accuracy.

Fallback chain (per sub-topic):
  1. Markdown text from pages (tables preserved) — primary
  2. Clean text from pages (trafilatura output) — if no markdown
  3. You.com snippets (from you_snippets.json) — if no validated pages

Sanity checks baked into the Gemini prompt (from content-generator):
  - Impossible exam scores blocked (CUET max 250, JEE max 300, NEET max 720)
  - No invented weightage percentages
  - India-only book recommendations (NCERT, Arihant, MTG, Oswaal, RD Sharma)
  - Numbers must appear verbatim in source text (no "approximately")

Output: list[VerifiedSubTopic] + extracted/ + verified_data.json checkpoints
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from llm_client import GeminiClient
from models import (
    Blueprint,
    FetchedPage,
    SourceList,
    VerifiedFact,
    VerifiedSubTopic,
)

log = logging.getLogger("atlas.indexer")

# ── Extraction + verification prompt ─────────────────────────────────────────

EXTRACT_PROMPT = """\
You are extracting data from official Indian education source pages to populate one
section of an article. You extract AND verify in the same step.

Topic: {topic}
Sub-topic to extract: {sub_topic_name}
Data fields required: {data_needed}

SOURCE TEXT (from official pages — may include markdown tables):
{source_text}

YOUR TASK:
1. Extract each required data field from the source text above.
2. For every extracted value, record the exact quote from the source that confirms it.
3. Only mark a fact as verified=true if the EXACT value (number, name, date) appears in the source text.
4. Do NOT paraphrase. "approximately 24 LPA" does NOT verify "24.2 LPA".
5. Extract ALL rows from any table you find — do not summarise tables.
6. If a field is not in the source text, set value to null (not an empty string).

SANITY CHECKS — violating any of these means do NOT extract the value:
- CUET UG scores: maximum possible = 250 (50 questions × 5 marks). Any cutoff > 250 is impossible.
- JEE Main scores: maximum = 300 (90 questions × 4 marks). Any score > 300 is impossible.
- NEET scores: maximum = 720 (180 questions × 4 marks). Any score > 720 is impossible.
- Subject weightages (%): ONLY extract if a percentage is EXPLICITLY stated in the source.
  Do NOT calculate or estimate weightages.
- Books: ONLY recommend Indian books (NCERT, Arihant, MTG, Oswaal, RD Sharma, HC Verma, DC Pandey).
  NEVER recommend Spivak, Rudin, Apostol, Zill or other international university textbooks.
- Dates: if a date is not confirmed for this year, prefix with "Expected:".

YEAR FLEXIBILITY — universities publish placement data with a 6-12 month lag:
- If the topic requests 2026 data but only 2024-25 or 2025 data is available, extract it.
- Append the actual year to the value, e.g. "18.5 LPA (2024-25)" or "Top: TCS (Batch 2025)".
- Do NOT return null just because the year does not match exactly — recent data is valid.
- If 2026 data IS present, prefer it and do not append the year suffix.

RETURN JSON:
{{
  "extracted_facts": [
    {{
      "field": "<field_name>",
      "value": "<exact value as it appears in source>",
      "verified": true | false,
      "source_snippet": "<10-30 word quote from source confirming this, empty string if not found>"
    }}
  ],
  "extracted_tables": [
    {{
      "title": "<table heading or sub-topic>",
      "columns": ["col1", "col2", ...],
      "rows": [
        ["val1", "val2", ...],
        ...
      ],
      "verified": true
    }}
  ],
  "extraction_notes": "<any caveats, missing data, or sanity check rejections>"
}}

Rules:
- Include only facts where verified=true OR where you explicitly flag verified=false (caller decides).
- Tables: extract ALL rows present in the markdown. If source has 20 rows, return 20 rows.
- Numbers must be exact as they appear in source (do not round or approximate).
- For tables marked as | col | col | format: parse them as structured rows.
"""

# ── Source text builder ───────────────────────────────────────────────────────

def _build_source_text(
    st_urls:      list[str],
    pages:        dict[str, FetchedPage],
    pages_dir:    Path,
    snippets_text: str,
    max_chars:    int = 30000,
) -> str:
    """
    Build the best possible source text for a sub-topic.
    Priority: markdown_text (tables preserved) > clean_text > You.com snippets.

    Each page gets at most PER_PAGE_MAX chars so multiple sources can contribute.
    This prevents one large page (e.g. a 74k-char Collegedunia page) from
    consuming the entire budget and leaving no room for PDFs with exact stats.
    """
    PER_PAGE_MAX = 8000  # max chars to take from any single page
    parts: list[str] = []
    total_used = 0

    for url in st_urls:
        if total_used >= max_chars:
            break
        page = pages.get(url)
        if not page:
            continue

        # Try markdown first (preserves tables as | col | col | rows)
        url_hash = __import__("hashlib").md5(url.encode()).hexdigest()[:12]
        md_file  = pages_dir / f"{url_hash}_md.txt"

        if md_file.exists():
            text = md_file.read_text(encoding="utf-8")
            source_type = "markdown"
        elif page.clean_text:
            text = page.clean_text
            source_type = "text"
        else:
            continue

        remaining_budget = max_chars - total_used
        chunk_size = min(PER_PAGE_MAX, remaining_budget)
        chunk = text[:chunk_size]
        parts.append(f"=== Source: {page.title or url[:60]} ({source_type}) ===\n{chunk}")
        total_used += len(chunk)

    # Fallback: You.com snippets (always useful even if no validated pages)
    remaining = max_chars - total_used
    if snippets_text and remaining > 500:
        parts.append(f"=== You.com Research Snippets ===\n{snippets_text[:remaining]}")

    if not parts:
        return ""
    return "\n\n".join(parts)


# ── Response parser ───────────────────────────────────────────────────────────

def _parse_response(
    result:        dict,
    sub_topic_id:  str,
    sub_topic_name: str,
    source_urls:   list[str],
) -> VerifiedSubTopic:
    """Parse a Gemini extraction response into a VerifiedSubTopic."""
    verified_facts: list[VerifiedFact] = []
    verified_tables: list[dict] = []

    for item in result.get("extracted_facts", []):
        value = item.get("value")
        if value is None:
            continue
        verified_facts.append(VerifiedFact(
            field=item.get("field", ""),
            value=str(value),
            verified=bool(item.get("verified", True)),
            source_url=source_urls[0] if source_urls else "",
            source_snippet=item.get("source_snippet", ""),
        ))

    for tbl in result.get("extracted_tables", []):
        cols = tbl.get("columns", [])
        rows = tbl.get("rows", [])
        if not cols or not rows:
            continue
        # Filter out empty rows
        rows = [r for r in rows if any(str(c).strip() for c in r)]
        if rows:
            verified_tables.append({
                "title":   tbl.get("title", sub_topic_name),
                "columns": cols,
                "rows":    rows[:50],  # cap at 50 rows per table
            })

    has_data = bool(verified_facts or verified_tables)
    return VerifiedSubTopic(
        sub_topic_id=sub_topic_id,
        sub_topic_name=sub_topic_name,
        verified_facts=verified_facts,
        verified_tables=verified_tables,
        has_data=has_data,
    )


# ── Serialisation (matches stage6 checkpoint format) ─────────────────────────

def _serialise(vst: VerifiedSubTopic) -> dict:
    return {
        "sub_topic_id":   vst.sub_topic_id,
        "sub_topic_name": vst.sub_topic_name,
        "verified_facts": [
            {
                "field":          f.field,
                "value":          f.value,
                "verified":       f.verified,
                "source_url":     f.source_url,
                "source_snippet": f.source_snippet,
            }
            for f in vst.verified_facts
        ],
        "verified_tables": vst.verified_tables,
        "has_data":        vst.has_data,
    }


def _deserialise(data: dict) -> VerifiedSubTopic:
    facts = [
        VerifiedFact(
            field=f["field"],
            value=f["value"],
            verified=f["verified"],
            source_url=f.get("source_url", ""),
            source_snippet=f.get("source_snippet", ""),
        )
        for f in data.get("verified_facts", [])
    ]
    return VerifiedSubTopic(
        sub_topic_id=data["sub_topic_id"],
        sub_topic_name=data.get("sub_topic_name", ""),
        verified_facts=facts,
        verified_tables=data.get("verified_tables", []),
        has_data=data.get("has_data", False),
    )


# ── Main run function ─────────────────────────────────────────────────────────

def run(
    blueprint:    Blueprint,
    source_list:  SourceList,
    pages:        dict[str, FetchedPage],
    run_dir:      Path,
) -> list[VerifiedSubTopic]:
    """
    Run the indexer. Replaces Stages 5 + 6.

    For each sub-topic:
      - Builds source text from markdown pages (tables preserved) or clean text fallback
      - Calls Gemini with targeted extraction + inline verification
      - Outputs VerifiedSubTopic directly

    Returns list[VerifiedSubTopic]. Saves:
      extracted/{sub_topic_id}.json  — per sub-topic extraction checkpoint
      verified_data.json             — full list checkpoint (Stage 6 format)
    """
    verified_ckpt = run_dir / "verified_data.json"

    # Load from checkpoint
    if verified_ckpt.exists():
        log.info("Indexer: loading from checkpoint")
        raw = json.loads(verified_ckpt.read_text(encoding="utf-8"))
        return [_deserialise(item) for item in raw]

    extracted_dir = run_dir / "extracted"
    extracted_dir.mkdir(exist_ok=True)
    pages_dir = run_dir / "pages"

    # Load You.com snippets (fallback when pages are thin)
    snippets_file = run_dir / "you_snippets.json"
    all_snippets: dict[str, str] = {}
    if snippets_file.exists():
        all_snippets = json.loads(snippets_file.read_text(encoding="utf-8"))
    entity_snippets = all_snippets.get("_entity", "")

    client  = GeminiClient()
    results: list[VerifiedSubTopic] = []

    for st in blueprint.sub_topics:
        st_ckpt = extracted_dir / f"{st.id}.json"

        # Per sub-topic checkpoint
        if st_ckpt.exists():
            log.info("  Indexer [%s]: loading from checkpoint", st.id)
            results.append(_deserialise(json.loads(st_ckpt.read_text(encoding="utf-8"))))
            continue

        log.info("  Indexer [%s]: extracting — %s", st.id, st.name[:50])

        # Get pages for this sub-topic
        st_urls      = source_list.by_sub_topic.get(st.id, [])
        st_snippets  = all_snippets.get(st.id, "")
        combined_snip = f"{st_snippets}\n\n{entity_snippets}" if st_snippets else entity_snippets

        source_text = _build_source_text(
            st_urls, pages, pages_dir, combined_snip, max_chars=30000
        )

        if not source_text.strip():
            log.warning("  Indexer [%s]: no source text available — marking empty", st.id)
            vst = VerifiedSubTopic(
                sub_topic_id=st.id,
                sub_topic_name=st.name,
                verified_facts=[],
                verified_tables=[],
                has_data=False,
            )
            st_ckpt.write_text(json.dumps(_serialise(vst), ensure_ascii=False, indent=2), encoding="utf-8")
            results.append(vst)
            continue

        prompt = EXTRACT_PROMPT.format(
            topic=blueprint.topic,
            sub_topic_name=st.name,
            data_needed=", ".join(st.data_needed) if st.data_needed else "all relevant facts",
            source_text=source_text,
        )

        try:
            result = client.generate_json(prompt, temperature=0.0, max_tokens=8192)
        except Exception as e:
            log.warning("  Indexer [%s]: Gemini failed: %s — marking empty", st.id, e)
            result = {"extracted_facts": [], "extracted_tables": [], "extraction_notes": str(e)}

        # Log any sanity-check rejections
        notes = result.get("extraction_notes", "")
        if notes:
            log.info("  Indexer [%s] notes: %s", st.id, notes[:120])

        vst = _parse_response(result, st.id, st.name, st_urls)

        # Save per-sub-topic checkpoint
        st_ckpt.write_text(json.dumps(_serialise(vst), ensure_ascii=False, indent=2), encoding="utf-8")

        n_facts  = len(vst.verified_facts)
        n_tables = len(vst.verified_tables)
        log.info("  Indexer [%s]: %d facts, %d tables, has_data=%s",
                 st.id, n_facts, n_tables, vst.has_data)
        results.append(vst)

    # Save verified_data.json (Stage 6 format — stage 7 reads this)
    verified_ckpt.write_text(
        json.dumps([_serialise(v) for v in results], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with_data = sum(1 for v in results if v.has_data)
    log.info("Indexer: %d/%d sub-topics have data", with_data, len(results))
    return results
