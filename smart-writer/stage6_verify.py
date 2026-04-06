"""
stage6_verify.py — Data Verification (Gemini)

Input:  list[SubTopicExtraction], validated pages dict
Output: list[VerifiedSubTopic] + verified_data.json checkpoint

What Gemini does here:
  - For each sub-topic, re-reads the source page text alongside the extracted data
  - For each extracted fact: "does this number/name/date actually appear in the source?"
  - YES → verified=True, saves source_snippet
  - NO  → verified=False, fact is dropped
  - Drops unverified data points ENTIRELY — they never reach the writer

This is the hard anti-hallucination gate.
Hallucination can only happen if:
  a) A false fact appears verbatim in an official source (extremely rare)
  b) Gemini confabulates during verification (temperature=0.0 minimises this)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from llm_client import GeminiClient
from models import (
    FetchedPage,
    SubTopicExtraction,
    VerifiedFact,
    VerifiedSubTopic,
    Blueprint,
)

log = logging.getLogger("atlas.stage6")

VERIFY_PROMPT = """\
You are a fact-checker for a high-accuracy publishing system. Every data point you approve will be published. False positives cause reputational damage. Be strict.

Sub-topic: {sub_topic_name}
Source text (from official pages):
{source_text}

Extracted data to verify:
{extracted_data}

Return a JSON object:
{{
  "verified_facts": [
    {{
      "field": "<field_name>",
      "value": "<the extracted value, with full context intact>",
      "verified": true | false,
      "source_snippet": "<exact quote from source that confirms BOTH the number AND its context>",
      "conflict_note": "<if sources give conflicting values, describe both here — else empty string>"
    }}
  ],
  "verified_tables": [
    {{
      "title": "table title",
      "columns": ["col1", ...],
      "rows": [["val1", ...], ...],
      "verified": true | false,
      "context_note": "<what this table covers: course, year, batch — extracted from table title or surrounding text>"
    }}
  ]
}}

═══ VERIFICATION RULES ═══
1. Verify the NUMBER and its CONTEXT together — not just the number alone.
   - The source says "B.Tech annual fee: ₹3.07 lakh"
   - Extracted value: "₹3.07 lakh per year for B.Tech"  → verified=true ✓
   - Extracted value: "₹3.07 lakh total fees"           → verified=false ✗  (context is wrong)
   - Extracted value: "₹3.07 lakh"                      → verified=false ✗  (context is missing)

2. Do NOT accept paraphrases as verified. "approximately 24 LPA" ≠ "24.2 LPA".

3. For fee values: source_snippet must quote the FULL sentence that mentions both the amount AND what it is for (course + annual/total/semester).

4. For tables: mark verified=true only if >80% of rows appear in source_text AND the table's context (which course/batch/year it covers) is also present in the source.

5. Null values → skip entirely.

6. CONFLICT DETECTION — if the source text contains TWO DIFFERENT values for the same concept:
   (e.g. page says "annual fee ₹3.07 lakh" in one place and "₹2.95 lakh" in another section)
   - Set verified=false
   - Describe both values in conflict_note
   - Do NOT pick one — flag it for human review

7. CURRENCY & UNITS — if the source does not explicitly state annual/total/semester for a fee:
   - Set verified=false
   - Note in source_snippet: "(amount found but duration not specified in source)"

8. OUTDATED DATA — if the source mentions a year for the data AND it is 2 or more years before the current year:
   - Append "(data from [year] — may be outdated)" to the value
   - Still mark verified=true if the number is correct

9. Be strict. A false positive is worse than a false negative.
"""


def run(
    blueprint: Blueprint,
    extractions: list[SubTopicExtraction],
    pages: dict[str, FetchedPage],
    run_dir: Path,
) -> list[VerifiedSubTopic]:
    """
    Run Stage 6. Returns list[VerifiedSubTopic].
    Saves verified_data.json to run_dir.
    Loads from checkpoint if already exists.
    """
    checkpoint = run_dir / "verified_data.json"

    if checkpoint.exists():
        log.info("Stage 6: loading from checkpoint")
        raw = json.loads(checkpoint.read_text(encoding="utf-8"))
        return [_parse_verified_subtopic(item) for item in raw]

    if not extractions:
        log.warning("Stage 6: no extractions to verify")
        return []

    client = GeminiClient()
    results: list[VerifiedSubTopic] = []

    # Build a lookup: sub_topic_id → SubTopic (for names)
    st_name_map = {st.id: st.name for st in blueprint.sub_topics}

    for extraction in extractions:
        st_name = st_name_map.get(extraction.sub_topic_id, extraction.sub_topic_id)
        log.info(f"  Stage 6 [{extraction.sub_topic_id}]: verifying")

        # Skip if nothing was extracted
        extracted_fields = {k: v for k, v in extraction.data.items() if v is not None}
        if not extracted_fields and not extraction.raw_tables:
            log.info(f"  Stage 6 [{extraction.sub_topic_id}]: nothing to verify — marking empty")
            results.append(VerifiedSubTopic(
                sub_topic_id=extraction.sub_topic_id,
                sub_topic_name=st_name,
                verified_facts=[],
                verified_tables=[],
                has_data=False,
            ))
            continue

        # Build source text for verification
        source_pages = [pages[u] for u in extraction.source_urls if u in pages]
        source_text = _build_source_text(source_pages, max_chars=5000)

        if not source_text:
            log.warning(f"  Stage 6 [{extraction.sub_topic_id}]: no source text available — marking unverified")
            results.append(VerifiedSubTopic(
                sub_topic_id=extraction.sub_topic_id,
                sub_topic_name=st_name,
                verified_facts=[],
                verified_tables=[],
                has_data=False,
            ))
            continue

        # Format extracted data for Gemini
        extracted_text = json.dumps(extracted_fields, ensure_ascii=False, indent=2)

        prompt = VERIFY_PROMPT.format(
            sub_topic_name=st_name,
            source_text=source_text.replace("{", "{{").replace("}", "}}"),
            extracted_data=extracted_text.replace("{", "{{").replace("}", "}}"),
        )

        try:
            result = client.generate_json(prompt, temperature=0.0, max_tokens=8192)
        except Exception as e:
            log.warning(f"  Stage 6 [{extraction.sub_topic_id}]: Gemini verify failed: {e}")
            result = {"verified_facts": [], "verified_tables": []}

        # Parse verified facts — log conflicts even for verified items
        verified_facts = []
        conflicts_found = 0
        for item in result.get("verified_facts", []):
            conflict = item.get("conflict_note", "").strip()
            if conflict:
                conflicts_found += 1
                log.warning(f"  Stage 6 [{extraction.sub_topic_id}] CONFLICT in '{item.get('field')}': {conflict[:120]}")
            if item.get("verified") and item.get("value"):
                verified_facts.append(VerifiedFact(
                    field=item.get("field", ""),
                    value=str(item.get("value", "")),
                    verified=True,
                    source_url=extraction.source_urls[0] if extraction.source_urls else "",
                    source_snippet=item.get("source_snippet", ""),
                ))

        if conflicts_found:
            log.warning(f"  Stage 6 [{extraction.sub_topic_id}]: {conflicts_found} conflicting data points dropped")

        # Parse verified tables — preserve context_note in title
        verified_tables = []
        for tbl in result.get("verified_tables", []):
            if tbl.get("verified"):
                # Append context_note to table title so writer knows what the table covers
                title = tbl.get("title", "")
                ctx = tbl.get("context_note", "").strip()
                if ctx and ctx.lower() not in title.lower():
                    title = f"{title} ({ctx})" if title else ctx
                verified_tables.append({
                    "title": title,
                    "columns": tbl.get("columns", []),
                    "rows": tbl.get("rows", []),
                })

        has_data = bool(verified_facts or verified_tables)
        vst = VerifiedSubTopic(
            sub_topic_id=extraction.sub_topic_id,
            sub_topic_name=st_name,
            verified_facts=verified_facts,
            verified_tables=verified_tables,
            has_data=has_data,
        )
        results.append(vst)

        total_extracted = len(extracted_fields)
        total_verified = len(verified_facts)
        log.info(f"  Stage 6 [{extraction.sub_topic_id}]: "
                 f"{total_verified}/{total_extracted} facts verified, "
                 f"{len(verified_tables)} tables, has_data={has_data}")

    # Save checkpoint
    checkpoint.write_text(
        json.dumps([_serialise_vst(v) for v in results], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with_data = sum(1 for v in results if v.has_data)
    log.info(f"Stage 6: {with_data}/{len(results)} sub-topics have verified data")
    return results


def _build_source_text(pages: list[FetchedPage], max_chars: int = 5000) -> str:
    parts = []
    budget = max_chars
    for page in pages:
        chunk = page.clean_text[:budget]
        parts.append(chunk)
        budget -= len(chunk)
        if budget <= 0:
            break
    return "\n\n---\n\n".join(parts)


def _serialise_vst(vst: VerifiedSubTopic) -> dict:
    return {
        "sub_topic_id": vst.sub_topic_id,
        "sub_topic_name": vst.sub_topic_name,
        "verified_facts": [
            {
                "field": f.field,
                "value": f.value,
                "verified": f.verified,
                "source_url": f.source_url,
                "source_snippet": f.source_snippet,
            }
            for f in vst.verified_facts
        ],
        "verified_tables": vst.verified_tables,
        "has_data": vst.has_data,
    }


def _parse_verified_subtopic(data: dict) -> VerifiedSubTopic:
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
