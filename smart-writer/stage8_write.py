"""
stage8_write.py — Section Writing (Llama via LM Studio, Gemini fallback)

Input:  ArticleOutline, list[VerifiedSubTopic], focus_keyword
Output: list[WrittenSection] + sections/{heading_slug}.html checkpoints

Rules:
  - Each section receives ONLY its verified data block (no section sees another's data)
  - HARD RULE: no verified data for a section → section is DROPPED, not written from memory
  - 700-900 words per section
  - Format (table/bullet/prose) from outline's format_hint
  - focus_keyword threaded naturally 1-2× per section
  - Anti-repetition: each section receives a "what earlier sections already covered" list
  - Temperature 0.3 for table-heavy sections, 0.45 for prose
"""

from __future__ import annotations
import concurrent.futures
import threading as _threading

import json
import logging
import re
from pathlib import Path

from llm_client import QwenClient
from models import (
    ArticleOutline,
    SectionPlan,
    VerifiedSubTopic,
    WrittenSection,
)

log = logging.getLogger("atlas.stage8")

from stage8_styles import WRITER_SYSTEMS, FORMAT_RULES

# Backward compat
WRITER_SYSTEM = WRITER_SYSTEMS["comprehensive"]

def run(
    outline: ArticleOutline,
    verified_subtopics: list[VerifiedSubTopic],
    run_dir: Path,
    writing_style: str = "comprehensive",
) -> list[WrittenSection]:
    """
    Run Stage 8. Returns list[WrittenSection].
    Saves sections/{slug}.html per section.
    Loads from checkpoint if already written.
    """
    sections_dir = run_dir / "sections"
    sections_dir.mkdir(exist_ok=True)

    # Build lookup: sub_topic_id → VerifiedSubTopic
    vst_map: dict[str, VerifiedSubTopic] = {v.sub_topic_id: v for v in verified_subtopics}

    # Pre-compute already_covered for each section from outline headings
    # (topic-level anti-repetition — safe to pre-compute since we know the full outline)
    # Cross-section fact dedup: track fact values already written (session 17)
    _used_fact_values: set[str] = set()
    _dedup_lock = _threading.Lock()

    # Section 0 (first) gets "None — this is the first section." for article intro trigger
    def _already_covered_for(i: int) -> str:
        if i == 0:
            return "None — this is the first section."
        return "\n".join(
            f"Section {j+1}: {outline.sections[j].heading} — covered: " + ", ".join(outline.sections[j].sub_topic_ids)
            for j in range(i)
        )

    _write_lock = _threading.Lock()

    def _write_section(args) -> tuple[int, WrittenSection | None]:
        i, section = args
        slug = _heading_slug(section.heading)
        checkpoint = sections_dir / f"{i:02d}_{slug}.html"

        if checkpoint.exists():
            log.info(f"  Stage 8 [{i+1}]: loading from checkpoint: {section.heading[:50]}")
            html = checkpoint.read_text(encoding="utf-8")
            return i, WrittenSection(heading=section.heading, level=section.level,
                                     html=html, word_count=_word_count(html))

        data_block = _build_data_block(section, vst_map, _used_fact_values, _dedup_lock)
        if not data_block.strip() or data_block == "No verified data available.":
            log.warning(f"  Stage 8 [{i+1}]: NO verified data — DROPPING: {section.heading}")
            return i, None

        log.info(f"  Stage 8 [{i+1}]: writing: {section.heading[:60]}")

        # Fix B: thin-section short-circuit (session 18)
        facts_parsed, tables_parsed = _parse_data_block_structure(data_block)
        is_first_section = (i == 0)
        if not is_first_section and len(facts_parsed) <= 3 and len(tables_parsed) == 0:
            log.info(f"  Stage 8 [{i+1}]: THIN ({len(facts_parsed)} facts, 0 tables) — Python assembly")
            html = _assemble_thin_section(section.heading, section.level, facts_parsed)
            with _write_lock:
                checkpoint.write_text(html, encoding="utf-8")
            return i, WrittenSection(heading=section.heading, level=section.level,
                                     html=html, word_count=_word_count(html))

        temp = 0.3 if section.section_type == "table" else 0.45
        already_covered_str = _already_covered_for(i)
        style = writing_style
        sys_prompt = WRITER_SYSTEMS.get(style, WRITER_SYSTEMS["comprehensive"])
        fmt_rules = FORMAT_RULES.get(style, FORMAT_RULES["comprehensive"])

        # Fix A: skeleton-fill for non-first sections with data (session 18)
        use_skeleton = (not is_first_section and (len(facts_parsed) >= 4 or len(tables_parsed) >= 1))
        client = QwenClient()
        if use_skeleton:
            skeleton_html, slot_descs = _build_skeleton(section.heading, section.level, facts_parsed, tables_parsed)
            slot_instr = "\n".join("  - " + d for d in slot_descs)
            prompt = (
                "Fill every {{SLOT_*}} in the skeleton. Replace each placeholder with real HTML.\n"
                "Use ONLY verified data. Do NOT add <p> or <ul> outside the existing slot tags.\n\n"
                "SLOT INSTRUCTIONS:\n" + slot_instr + "\n\n"
                "SKELETON (fill {{SLOT_*}} only — keep all other tags exactly as-is):\n"
                + skeleton_html + "\n\n"
                "VERIFIED DATA:\n" + data_block + "\n\n"
                "ALREADY COVERED in earlier sections (do NOT repeat):\n" + already_covered_str + "\n\n"
                f'Focus keyword (1-2 times naturally): "{outline.focus_keyword}"\n\n'
                "Return completed HTML only. No markdown fences, no explanation.\n"
            )
            html = client.generate(system=sys_prompt, user=prompt, temperature=temp, max_tokens=8000)
            html_c = html.strip()
            import re as _re
            html_c = _re.sub(r"^```[a-zA-Z]*\s*\n", "", html_c)
            html_c = _re.sub(r"\n```\s*$", "", html_c).strip()
            if _validate_skeleton_output(html_c, len(slot_descs)):
                log.info(f"  Stage 8 [{i+1}]: skeleton-fill OK")
                html = html_c
            else:
                log.warning(f"  Stage 8 [{i+1}]: skeleton invalid — free-form fallback")
                fmt_rules_formatted = fmt_rules.format(heading=section.heading)
                html = client.generate(
                    system=sys_prompt,
                    user=(
                        "Write the HTML for ONE article section using ONLY the verified data below.\n\n"
                        f"Section heading: {section.heading}\n"
                        "VERIFIED DATA:\n" + data_block + "\n\n"
                        + fmt_rules_formatted + "\n\nWrite the HTML now:\n"
                    ),
                    temperature=temp, max_tokens=8000,
                )
        else:
            fmt_rules_formatted = fmt_rules.format(heading=section.heading)
            prompt = (
                "Write the HTML for ONE article section using ONLY the verified data below.\n\n"
                f"Section heading: {section.heading}\n"
                f"Data target: cover ALL facts DIRECTLY RELEVANT to the section heading. Stop when all facts covered.\n"
                f"HEADING RELEVANCE: Only write content that answers \"{section.heading}\". Skip facts for other headings.\n"
                f"Section type: {section.section_type}\n"
                f"Outline instruction: {section.format_hint or section.section_type}\n\n"
                "VERIFIED DATA (use ONLY this):\n" + data_block.replace("{", "{{").replace("}", "}}") + "\n\n"
                "ALREADY COVERED:\n" + already_covered_str.replace("{", "{{").replace("}", "}}") + "\n\n"
                f'Focus keyword (use 1-2 times): "{outline.focus_keyword}"\n\n'
                + fmt_rules_formatted + "\n\nWrite the HTML now:\n"
            )
            html = client.generate(system=sys_prompt, user=prompt, temperature=temp, max_tokens=8000)

        html = _clean_html(html, section.heading, section.level)
        if not html.strip().startswith("<h"):
            tag = f"h{section.level}"
            html = f"<{tag}>{section.heading}</{tag}>\n{html}"

        with _write_lock:
            checkpoint.write_text(html, encoding="utf-8")

        wc = _word_count(html)
        log.info(f"  Stage 8 [{i+1}]: written {wc} words")
        return i, WrittenSection(heading=section.heading, level=section.level, html=html, word_count=wc)

    # Parallel: 2 workers — submit() so a single failure doesn't crash the whole stage (session 16 fix)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fut_map = {pool.submit(_write_section, item): item[0] for item in enumerate(outline.sections)}
        results: dict[int, WrittenSection] = {}
        for fut in concurrent.futures.as_completed(fut_map):
            idx = fut_map[fut]
            try:
                _i, ws = fut.result()
                results[idx] = ws
            except Exception as e:
                log.error(f"  Stage 8 section {idx+1} failed: {e} — placeholder")
                section = outline.sections[idx]
                tag = f"h{section.level}"
                results[idx] = WrittenSection(
                    heading=section.heading, level=section.level,
                    html=f"<{tag}>{section.heading}</{tag}>\n<p>Data unavailable.</p>",
                    word_count=4,
                )

    written = [results[i] for i in sorted(results) if results.get(i) is not None]

    total_words = sum(s.word_count for s in written)
    log.info(f"Stage 8: {len(written)} sections written, {total_words} total words")
    return written


def _parse_data_block_structure(data_block: str) -> tuple:
    """
    Parse a data_block string into (facts, tables).
    facts: list of (field, value) tuples from 'field: value' lines
    tables: list of {title, columns, rows} dicts
    """
    facts = []
    tables = []
    current_table = None

    for line in data_block.splitlines():
        stripped = line.strip()
        if line.startswith("  ") and ": " in stripped and not stripped.startswith("Row:") and not stripped.startswith("Columns:"):
            parts = stripped.split(": ", 1)
            if len(parts) == 2 and parts[0] and parts[1]:
                facts.append((parts[0].strip(), parts[1].strip()))
        elif stripped.startswith("Table:"):
            title = stripped[6:].strip()
            current_table = {"title": title, "columns": [], "rows": []}
            tables.append(current_table)
        elif stripped.startswith("Columns:") and current_table is not None:
            current_table["columns"] = [c.strip() for c in stripped[8:].split("|") if c.strip()]
        elif stripped.startswith("Row:") and current_table is not None:
            current_table["rows"].append([c.strip() for c in stripped[4:].split("|")])
        elif stripped.startswith("===") or stripped == "Key facts:":
            current_table = None

    return facts, tables


def _assemble_thin_section(heading: str, level: int, facts: list) -> str:
    """
    Fix B: Directly assemble HTML for thin sections (<=3 facts, 0 tables).
    Zero hallucination — only uses verified facts.
    """
    tag = "h%d" % level
    parts = ["<%s>%s</%s>" % (tag, heading, tag)]
    if facts:
        first_field, first_val = facts[0]
        parts.append("<p><strong>%s:</strong> %s</p>" % (first_field, first_val))
        if len(facts) > 1:
            items = "\n".join("  <li><strong>%s:</strong> %s</li>" % (f, v) for f, v in facts[1:])
            parts.append("<ul>\n%s\n</ul>" % items)
    return "\n".join(parts)


def _build_skeleton(heading: str, level: int, facts: list, tables: list) -> tuple:
    """
    Fix A: Build an HTML skeleton with SLOT placeholders enforcing strict alternation.
    Returns (skeleton_html, slot_descriptions).
    LLM fills the slots — cannot add rogue <p> tags outside them.
    """
    tag = "h%d" % level
    parts = ["<%s>%s</%s>" % (tag, heading, tag)]
    slot_descs = []

    # Group facts into chunks of 3 per <p> slot
    FACTS_PER_P = 3
    fact_chunks = [facts[i:i + FACTS_PER_P] for i in range(0, len(facts), FACTS_PER_P)]
    table_idx = 0
    used_fact_set = set()  # track facts consumed by ul slots

    ci = 0
    while ci < len(fact_chunks):
        chunk = fact_chunks[ci]
        # Skip facts already assigned to a ul slot
        chunk = [(f, v) for f, v in chunk if (f, v) not in used_fact_set]
        if not chunk:
            ci += 1
            continue

        slot_n = len(slot_descs) + 1
        field_list = "; ".join("%s: %s" % (f, v) for f, v in chunk)
        slot_descs.append("SLOT_P%d: 2-3 sentences (30-60 words) using ONLY: %s" % (slot_n, field_list))
        parts.append("<p>{{SLOT_P%d}}</p>" % slot_n)

        # After each p-slot, add a table or ul slot
        if table_idx < len(tables):
            tbl = tables[table_idx]
            table_idx += 1
            tbl_rows = tbl.get("rows", [])
            col_list = " | ".join(tbl["columns"])
            if len(tbl_rows) < 3:
                slot_ln = len(slot_descs) + 1
                row_items = "; ".join(" | ".join(str(c) for c in r) for r in tbl_rows)
                slot_descs.append(
                    "SLOT_L%d: <ul> list for '%s'. One <li><strong>label:</strong> value</li> per item. Data: %s" % (
                        slot_ln, tbl["title"], row_items or col_list
                    )
                )
                parts.append("<ul>{{SLOT_L%d}}</ul>" % slot_ln)
            else:
                slot_tn = len(slot_descs) + 1
                row_preview = "; ".join(" | ".join(str(c) for c in r) for r in tbl_rows[:3])
                slot_descs.append(
                    "SLOT_T%d: Fill <table class=\"data-table\"> ALL rows from '%s'. Columns: %s. Sample rows: %s" % (
                        slot_tn, tbl["title"], col_list, row_preview
                    )
                )
                parts.append('<table class="data-table">{{SLOT_T%d}}</table>' % slot_tn)
        elif ci + 1 < len(fact_chunks):
            # Use next chunk as a ul to break prose
            next_chunk = [(f, v) for f, v in fact_chunks[ci + 1] if (f, v) not in used_fact_set]
            if next_chunk:
                slot_ln = len(slot_descs) + 1
                bullet_list = "; ".join("%s: %s" % (f, v) for f, v in next_chunk)
                slot_descs.append(
                    "SLOT_L%d: <ul> list — one <li><strong>field:</strong> value</li> per fact: %s" % (slot_ln, bullet_list)
                )
                parts.append("<ul>{{SLOT_L%d}}</ul>" % slot_ln)
                for fv in next_chunk:
                    used_fact_set.add(fv)
        ci += 1

    # Any remaining tables — thin (<3 rows) become ul
    while table_idx < len(tables):
        tbl = tables[table_idx]
        table_idx += 1
        tbl_rows = tbl.get("rows", [])
        col_list = " | ".join(tbl["columns"])
        if len(tbl_rows) < 3:
            slot_ln = len(slot_descs) + 1
            row_items = "; ".join(" | ".join(str(c) for c in r) for r in tbl_rows)
            slot_descs.append(
                "SLOT_L%d: <ul> list for '%s'. One <li><strong>label:</strong> value</li> per item. Data: %s" % (
                    slot_ln, tbl["title"], row_items or col_list
                )
            )
            parts.append("<ul>{{SLOT_L%d}}</ul>" % slot_ln)
        else:
            slot_tn = len(slot_descs) + 1
            slot_descs.append(
                "SLOT_T%d: Fill <table class=\"data-table\"> ALL rows from '%s'. Columns: %s." % (
                    slot_tn, tbl["title"], col_list
                )
            )
            parts.append('<table class="data-table">{{SLOT_T%d}}</table>' % slot_tn)

    return "\n".join(parts), slot_descs


def _validate_skeleton_output(html: str, expected_slot_count: int) -> bool:
    """Verify LLM filled all slots and output is usable."""
    import re as _re
    if _re.search(r"\{\{SLOT_", html):
        return False
    if not html.strip():
        return False
    if not _re.search(r"<h[2-6]", html, _re.IGNORECASE):
        return False
    return True


def _build_data_block(section: SectionPlan, vst_map: dict[str, VerifiedSubTopic], used_fact_values: set | None = None, lock=None) -> str:
    """
    Build a structured text block of verified data for a section's sub-topics.
    This is what the writer sees — no hallucination possible from here.
    Cross-section dedup: skips fact values already written in an earlier section.
    """
    parts = []
    for st_id in section.sub_topic_ids:
        vst = vst_map.get(st_id)
        if not vst or not vst.has_data:
            continue

        parts.append(f"=== {vst.sub_topic_name} ===")

        if vst.verified_facts:
            parts.append("Key facts:")
            for fact in vst.verified_facts:
                fact_key = str(fact.value).strip()[:200]
                if used_fact_values is not None and fact_key in used_fact_values:
                    log.debug("  _build_data_block dedup skip '%s'", fact.field[:40])
                    continue
                parts.append(f"  {fact.field}: {fact.value}")
                if used_fact_values is not None and lock is not None:
                    with lock:
                        used_fact_values.add(fact_key)

        if vst.verified_tables:
            for tbl in vst.verified_tables:
                title = tbl.get("title", "Data table")
                cols = tbl.get("columns", [])
                rows = tbl.get("rows", [])
                parts.append(f"\nTable: {title}")
                parts.append("  Columns: " + " | ".join(cols))
                for row in rows[:30]:  # cap at 30 rows per table
                    parts.append("  Row: " + " | ".join(str(c) for c in row))
                if len(rows) > 30:
                    parts.append(f"  ... ({len(rows) - 30} more rows)")

    return "\n".join(parts) if parts else "No verified data available."


def _heading_slug(heading: str) -> str:
    """Convert heading to a safe filename slug."""
    slug = heading.lower()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    return slug[:40].strip("_")


def _word_count(html: str) -> int:
    """Approximate word count from HTML."""
    text = re.sub(r"<[^>]+>", " ", html)
    return len(text.split())


def _clean_html(html: str, heading: str, level: int) -> str:
    """
    Strip common LLM output artifacts from section HTML:
      - Markdown code fences (```html ... ```)
      - [Insert X] / [Image] / [Chart] placeholders
      - Bare text lines outside any tag (wrap in <p>)
      - Empty <tbody> tables
      - Duplicate heading tags
      - Editor "Note:" comments
      - None values and empty cells in tables
      - Tables incorrectly wrapped in <p> tags
    """
    # Strip code fences — handle both surrounding the whole output and inline blocks
    html = html.strip()
    # Remove opening fence (```html or ``` at start)
    html = re.sub(r"^```[a-zA-Z]*\s*\n", "", html)
    # Remove closing fence (``` at end)
    html = re.sub(r"\n```\s*$", "", html)
    # Remove any remaining fences that wrap a whole section mid-string
    html = re.sub(r"```[a-zA-Z]*\n(.*?)```", r"\1", html, flags=re.DOTALL)

    # Remove [Insert ...] / [Add ...] / [Chart] / [Image] placeholders
    html = re.sub(r"\[Insert[^\]]*\]", "", html, flags=re.IGNORECASE)
    html = re.sub(r"\[Add[^\]]*\]", "", html, flags=re.IGNORECASE)
    html = re.sub(r"\[(Chart|Graph|Image|Figure|Flowchart)[^\]]*\]", "", html, flags=re.IGNORECASE)

    # Remove "Note: ..." lines (LLM editor notes)
    html = re.sub(r"(?m)^Note:.*$", "", html)

    # Remove empty tbody tables
    html = re.sub(
        r"<table[^>]*>.*?<tbody>\s*<!--.*?-->\s*</tbody>\s*</table>",
        "", html, flags=re.DOTALL | re.IGNORECASE
    )
    html = re.sub(
        r"<table[^>]*>.*?<tbody>\s*</tbody>\s*</table>",
        "", html, flags=re.DOTALL | re.IGNORECASE
    )

    # Remove duplicate heading (if LLM added it again mid-section)
    tag = f"h{level}"
    heading_escaped = re.escape(heading[:30])
    # Keep only the FIRST occurrence of the heading
    first_removed = False
    def _dedup_heading(m):
        nonlocal first_removed
        if not first_removed:
            first_removed = True
            return m.group(0)
        return ""
    html = re.sub(
        rf"<{tag}[^>]*>.*?</{tag}>",
        _dedup_heading,
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Replace None values and empty cells in tables
    html = re.sub(r"<td>\s*None\s*</td>", "<td>—</td>", html, flags=re.IGNORECASE)
    html = re.sub(r"<td>\s*</td>", "<td>—</td>", html)

    # Unwrap tables incorrectly placed inside <p> tags
    html = re.sub(r"<p>\s*(<table)", r"\1", html, flags=re.IGNORECASE)
    html = re.sub(r"(</table>)\s*</p>", r"\1", html, flags=re.IGNORECASE)

    # Wrap bare text blocks (outside any tag) in <p> tags
    html = _wrap_bare_text(html)

    # Detect truncated HTML (ends mid-tag or mid-table) and strip the incomplete part
    html = _strip_truncated(html)

    # Clean up excess blank lines
    html = re.sub(r"\n{3,}", "\n\n", html)

    return html.strip()


def _wrap_bare_text(html: str) -> str:
    """
    Wrap lines of bare text (outside any HTML tag) in <p> tags.
    Skips lines that are empty, already inside a tag, or are a tag themselves.
    """
    lines = html.split("\n")
    result = []
    inside_block = False  # track if we're inside a block-level tag
    block_tags = re.compile(r"<(table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|div|section|nav|script)", re.IGNORECASE)
    close_block = re.compile(r"</(table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|div|section|nav|script)", re.IGNORECASE)

    for line in lines:
        stripped = line.strip()
        if not stripped:
            result.append(line)
            continue
        if block_tags.search(stripped):
            inside_block = True
        if close_block.search(stripped):
            inside_block = False
            result.append(line)
            continue
        # If line starts with a tag already, leave it
        if stripped.startswith("<"):
            result.append(line)
            continue
        # Bare text outside block tags → wrap in <p>
        if not inside_block and not stripped.startswith("<"):
            result.append(f"<p>{stripped}</p>")
            continue
        result.append(line)
    return "\n".join(result)


def _strip_truncated(html: str) -> str:
    """
    If HTML appears to be cut off mid-tag or mid-table, strip the incomplete tail.
    Heuristic: if the last non-empty line doesn't end with > or is inside an open tag.
    """
    # Check for unclosed <table> — strip everything from the last unclosed <table>
    open_tables = len(re.findall(r"<table", html, re.IGNORECASE))
    close_tables = len(re.findall(r"</table>", html, re.IGNORECASE))
    if open_tables > close_tables:
        # Find the last <table that isn't closed and remove it
        last_table = html.rfind("<table")
        if last_table != -1:
            log.warning("_strip_truncated: removing unclosed <table> at the end")
            html = html[:last_table].rstrip()
    return html
