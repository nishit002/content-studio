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

WRITER_SYSTEM = """\
You are a senior education journalist writing for students deciding which college to apply to. You must produce articles that are more analytical and useful than Shiksha, Collegedunia, and Careers360 — those sites list facts without explaining them. Your job: convert verified data into HTML that helps students understand what each fact means and what to do with it.

HARD RULES — violating any of these makes the output useless:
1. Every sentence of prose MUST be inside a <p> tag. Never write bare text outside HTML tags.
2. Only use facts from the VERIFIED DATA block. If a fact is not in that block, do not write it.
3. Never mention company names, alumni, or salaries unless they appear in the verified data block.
4. Never use: "underscores", "reflects the institute's", "reinforcing", "position as a leader",
   "it is worth noting", "furthermore", "notably", "importantly", "this highlights",
   "in conclusion", "needless to say", "it should be noted", "strong academic reputation".
5. YEAR ACCURACY: If a data value includes a year annotation like "(2024-25)" or "(2025)", always
   preserve it. Do NOT write the article title year (e.g. 2026) when the data says otherwise.
   When referencing older data write "as of 2025" or "as of 2024-25" — never substitute the
   article title year into factual claims about when data was collected.
6. Do NOT add JavaScript, charts, Canvas, image placeholders, or markdown code fences.
7. Tables must only contain rows that have actual data from the verified data block. Never add placeholder rows.
"""

WRITER_PROMPT = """Write the HTML for ONE article section using ONLY the verified data below.

Section heading: {heading}
Minimum word count: {word_target} words — do not stop until you have used ALL significant facts AND reached this floor
Section type: {section_type}
Outline instruction: {format_hint}

VERIFIED DATA (use ONLY this — nothing else):
{verified_data_block}

ALREADY COVERED in earlier sections (do NOT repeat):
{already_covered}

Focus keyword (use 1-2 times naturally): "{focus_keyword}"

Output format rules:
1. Start with <h2>{heading}</h2>
2. Every sentence MUST be in a <p> tag. No bare text outside tags.
3. TABLES — for any "mixed" or "table" section type, OR when the outline instruction mentions a table:
   - Open with a <table class="data-table">. Use the outline instruction as a guide for what to include.
   - Even 2-3 facts belong in a table — do not skip the table because there are few rows.
   - After the table, write 4-6 analytical <p> tags. Each paragraph = 3-5 sentences, minimum 70 words. Apply the 3-layer structure from Rule 5: fact → context/comparison → student takeaway. No one-sentence or two-sentence paragraphs.
4. PROSE-only sections: write 4-6 <p> tags. Each paragraph = 3-5 sentences, minimum 70 words. Follow the 3-layer structure from Rule 5 for every paragraph. No one-sentence or two-sentence paragraphs.
5. ANALYTICAL DEPTH — every paragraph must have 3 layers:
   (1) STATE the fact with its exact number/date/name from the verified data
   (2) CONTEXTUALISE — compare to a national average, peer college, or prior year if data supports it; or explain what makes it high/low/notable
   (3) STUDENT TAKEAWAY — what does this mean for someone deciding whether to apply, how to prepare, or what to expect?
   GOOD: "The average placement package at GEHU Bhimtal reached INR 4.5 LPA in 2024, with the highest touching INR 47.88 LPA. While the average sits below top IIT/NIT range, the highest package signals that exceptional performers attract premium offers from the campus. Students targeting high-paying roles should prioritise CSE and data science electives and begin placement prep in the third year."
   BAD: "The highest package hit INR 47.88 LPA in 2025. This reflects growing interest from global firms." (only 2 layers, no student takeaway, no context)
   BAD: "The institute boasts an impressively high package." (vague, no data, no layers)
   No flowery language. No AI filler phrases. Every sentence must earn its place with a fact or a clear analytical point.
6. ARTICLE INTRO — applies ONLY when already_covered says "None — this is the first section":
   Before the <h2> tag, write a 2-paragraph article introduction:
   - Para 1 (4-5 sentences, 80-100 words): Name the institution, its type (private/government/deemed), city/state, year established, and total programmes. End with its single strongest credential from the data (NIRF rank, NAAC grade, or headline placement stat).
   - Para 2 (3-4 sentences, 50-70 words): State what this article covers (courses, fees, admission, placements, rankings, campus life) and which type of student this college suits best.
   These 2 paragraphs appear BEFORE the first <h2> tag. For all other sections: start immediately with the <h2> heading.
7. NON-FIRST SECTIONS: start the first <p> after the <h2> with the most significant fact from this section's data. Do not restate the institution name as an opener. No filler like "This section covers...".
8. Use ALL significant facts from the verified data. Do not leave data unused. Stop only after all data is used AND you have reached the minimum word count. If you exhaust the data before hitting the word floor, deepen the analysis of existing facts — do not repeat them, but add more context or student-facing implications.
9. No <html>, <head>, <body> tags. Raw section HTML only.

Write the HTML now:
"""


def run(
    outline: ArticleOutline,
    verified_subtopics: list[VerifiedSubTopic],
    run_dir: Path,
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

    client = QwenClient()
    written: list[WrittenSection] = []
    already_covered: list[str] = []

    for i, section in enumerate(outline.sections):
        slug = _heading_slug(section.heading)
        checkpoint = sections_dir / f"{i:02d}_{slug}.html"

        if checkpoint.exists():
            log.info(f"  Stage 8 [{i+1}]: loading from checkpoint: {section.heading[:50]}")
            html = checkpoint.read_text(encoding="utf-8")
            wc = _word_count(html)
            ws = WrittenSection(
                heading=section.heading,
                level=section.level,
                html=html,
                word_count=wc,
            )
            written.append(ws)
            already_covered.append(f"Section {i+1}: {section.heading}")
            continue

        # Build verified data block for this section
        data_block = _build_data_block(section, vst_map)

        if not data_block.strip() or data_block == "No verified data available.":
            log.warning(f"  Stage 8 [{i+1}]: NO verified data — DROPPING section: {section.heading}")
            continue

        log.info(f"  Stage 8 [{i+1}]: writing: {section.heading[:60]}")

        # Temperature: lower for table-heavy, higher for prose
        temp = 0.3 if section.section_type == "table" else 0.45

        prompt = WRITER_PROMPT.format(
            heading=section.heading,
            word_target=section.word_target,
            section_type=section.section_type,
            format_hint=section.format_hint or section.section_type,
            focus_keyword=outline.focus_keyword,
            verified_data_block=data_block.replace("{", "{{").replace("}", "}}"),
            already_covered=("\n".join(already_covered) if already_covered else "None — this is the first section.").replace("{", "{{").replace("}", "}}"),
        )

        html = client.generate(
            system=WRITER_SYSTEM,
            user=prompt,
            temperature=temp,
            max_tokens=8000,
        )

        # Clean up common Qwen/LLM output artifacts
        html = _clean_html(html, section.heading, section.level)

        # Ensure heading tag is present
        if not html.strip().startswith("<h"):
            tag = f"h{section.level}"
            html = f"<{tag}>{section.heading}</{tag}>\n{html}"

        # Save checkpoint
        checkpoint.write_text(html, encoding="utf-8")

        wc = _word_count(html)
        log.info(f"  Stage 8 [{i+1}]: written {wc} words")

        ws = WrittenSection(
            heading=section.heading,
            level=section.level,
            html=html,
            word_count=wc,
        )
        written.append(ws)
        already_covered.append(f"Section {i+1}: {section.heading} — covered: "
                                + ", ".join(section.sub_topic_ids))

    total_words = sum(s.word_count for s in written)
    log.info(f"Stage 8: {len(written)} sections written, {total_words} total words")
    return written


def _build_data_block(section: SectionPlan, vst_map: dict[str, VerifiedSubTopic]) -> str:
    """
    Build a structured text block of verified data for a section's sub-topics.
    This is what the writer sees — no hallucination possible from here.
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
                parts.append(f"  {fact.field}: {fact.value}")

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
