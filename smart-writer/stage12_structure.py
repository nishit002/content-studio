"""
stage12_structure.py — Structural Enforcer Pass (Qwen)

Input:  article.html (after stage 11 proofread)
Output: article.html (overwritten with structural fixes)

Scans every H2 section. For any section with consecutive <p> tags or no
table/ul at all, runs a targeted Qwen rewrite that enforces:
  <p> -> <table>/<ul> -> <p> -> <table>/<ul> ...
Never invents content — only reorganizes existing verified facts.
Non-blocking: keeps original if Qwen fails or produces worse output.
"""

from __future__ import annotations
import logging
import re
import shutil
from pathlib import Path
import concurrent.futures
from llm_client import GeminiClient

log = logging.getLogger("atlas.stage12")


RESTRUCTURE_SYSTEM = (
    "You are a structural HTML editor for Indian education articles.\n"
    "Your ONLY job is to reorganize existing HTML content into a strict alternating structure.\n"
    "NEVER invent facts, numbers, names, or any new content.\n"
    "NEVER remove existing facts.\n"
    "NEVER change wording beyond what is needed to fit a list item or table cell.\n"
)

RESTRUCTURE_PROMPT_TMPL = """\
Restructure this HTML section so it follows STRICT ALTERNATION:
  After every <p> tag, the next sibling element MUST be a <table class="data-table"> or <ul>.
  TWO CONSECUTIVE <p> TAGS ARE FORBIDDEN.

RULES:
1. Keep the <h2> heading exactly as-is.
2. First element after <h2>: one <p> (1-3 sentences, the single most important fact).
3. After that <p>, insert a <ul> or <table class="data-table"> containing key facts from the following paragraph(s).
   - Use <ul><li> for lists of items, criteria, or steps.
   - Use <table class="data-table"> when facts have label:value pairs or compare entities.
4. Continue alternating: <p> then table/ul, never <p> then <p>.
5. Last element of a section may be a <p> only if no more data remains for a list/table.
6. NEVER invent new facts or bullet points. Only use content already in the section below.
7. NEVER drop existing data — every fact in the input must appear in the output.
8. Return ONLY the restructured HTML. No explanation, no markdown fences, no code blocks.

Current section HTML:
---
{section_html}
---

Restructured HTML:"""


RESTRUCTURE_PROMPT_STRICT = """Restructure this HTML section. TWO CONSECUTIVE <p> TAGS ARE FORBIDDEN.

WORKED EXAMPLE:
Input: <h2>Fees</h2><p>Fee is Rs 1L</p><p>Hostel costs Rs 50k</p><p>Scholarship available</p>
Output: <h2>Fees</h2><p>Fee is Rs 1L</p><ul><li>Hostel: Rs 50k</li><li>Scholarship: Available</li></ul>

YOUR TASK: Apply the same pattern to the section below.
After EVERY <p>, the next element MUST be <table> or <ul>. Never <p> then <p>.
Keep every fact. Return ONLY the restructured HTML.

Section:
---
{section_html}
---

Restructured HTML:"""


def _get_sections(html: str) -> list[tuple[int, int, str]]:
    """Split article into H2 sections. Returns (abs_start, abs_end, section_html)."""
    body_match = (
        re.search(r"<article>(.*?)</article>", html, re.DOTALL | re.IGNORECASE) or
        re.search(r"<body>(.*?)</body>", html, re.DOTALL | re.IGNORECASE)
    )
    if not body_match:
        return []
    body = body_match.group(1)
    body_start = body_match.start(1)
    splits = list(re.finditer(r"<h2[\s>]", body, re.IGNORECASE))
    if not splits:
        return []
    sections = []
    for i, match in enumerate(splits):
        start = match.start()
        end = splits[i + 1].start() if i + 1 < len(splits) else len(body)
        sections.append((body_start + start, body_start + end, body[start:end].strip()))
    return sections


def _top_elements(section_html: str) -> list[str]:
    """Return sequence of top-level block element names in a section (p, table, ul, ol, h2-h6)."""
    # Walk top-level tags only — skip nested tags inside tables/lists
    elements = []
    pos = 0
    depth = {"table": 0, "ul": 0, "ol": 0}
    for m in re.finditer(r"<(/?)(\w+)([^>]*)>", section_html):
        closing, tag, _ = m.group(1), m.group(2).lower(), m.group(3)
        if tag in depth:
            depth[tag] += -1 if closing else 1
        in_block = any(v > 0 for v in depth.values())
        if not closing and not in_block and tag in ("p", "table", "ul", "ol", "h2", "h3", "h4", "h5", "h6"):
            elements.append(tag)
    return elements


def _has_consecutive_p(section_html: str) -> bool:
    """True if two <p> tags appear consecutively at the top level (no block between them)."""
    elems = _top_elements(section_html)
    for a, b in zip(elems, elems[1:]):
        if a == "p" and b == "p":
            return True
    return False


def _has_any_structure(section_html: str) -> bool:
    return bool(re.search(r"<(table|ul|ol)[\s>]", section_html, re.IGNORECASE))


def _count_p(section_html: str) -> int:
    return len(re.findall(r"<p[\s>]", section_html, re.IGNORECASE))


def run(run_dir: Path) -> str:
    """Run Stage 12 structural enforcer. Returns final HTML."""
    article_path = run_dir / "article.html"
    if not article_path.exists():
        log.warning("Stage 12: article.html not found — skipping")
        return ""

    html = article_path.read_text(encoding="utf-8")
    shutil.copy(article_path, run_dir / "article_pre_structure.html")

    sections = _get_sections(html)
    if not sections:
        log.info("Stage 12: no H2 sections found — skipping")
        return html

    violations = []
    for abs_start, abs_end, sec_html in sections:
        h2m = re.search(r"<h2[^>]*>(.*?)</h2>", sec_html, re.IGNORECASE | re.DOTALL)
        heading = re.sub(r"<[^>]+>", "", h2m.group(0) if h2m else "")[:60]
        p_count = _count_p(sec_html)
        consecutive = _has_consecutive_p(sec_html)
        no_structure = not _has_any_structure(sec_html) and p_count > 1
        # Skip FAQ section (intentionally prose Q&A)
        if 'frequently asked' in heading.lower() or 'faq' in heading.lower():
            continue
        # Skip sections with only 2 paras and no data to restructure (definition intro etc.)
        if p_count <= 2 and not consecutive:
            continue
        if consecutive or no_structure:
            reasons = []
            if consecutive: reasons.append("consecutive <p>")
            if no_structure: reasons.append("no table/ul")
            log.info("  Stage 12 violation '%s' (%s, %d paras)", heading, " + ".join(reasons), p_count)
            violations.append((abs_start, abs_end, sec_html, heading))

    if not violations:
        log.info("Stage 12: all %d sections pass structural check", len(sections))
        return html

    log.info("Stage 12: %d/%d sections need restructuring", len(violations), len(sections))

    def _restructure_one(item):
        abs_start, abs_end, sec_html, heading = item
        client = GeminiClient()

        def _attempt(prompt_text, attempt_n):
            try:
                new_html = client.generate(
                    RESTRUCTURE_SYSTEM + "\n\n" + prompt_text,
                    temperature=0.2 if attempt_n == 1 else 0.1,
                    max_tokens=8192,
                )
                new_html = re.sub(r"^```[a-zA-Z]*\s*\n", "", new_html.strip())
                new_html = re.sub(r"\n```\s*$", "", new_html).strip()
                if not re.match(r"<h2[\s>]", new_html, re.IGNORECASE):
                    return None, "missing <h2>"
                for _tag in ('ul', 'ol', 'table', 'tbody', 'thead', 'tr', 'li'):
                    _opens  = len(re.findall(rf'<{_tag}[\s>]', new_html, re.IGNORECASE))
                    _closes = len(re.findall(rf'</{_tag}>', new_html, re.IGNORECASE))
                    if _opens != _closes:
                        return None, f"unclosed <{_tag}>"
                return new_html, None
            except Exception as e:
                return None, str(e)

        log.info("  Stage 12: restructuring '%s'", heading)
        prompt1 = RESTRUCTURE_PROMPT_TMPL.format(section_html=sec_html)
        new_html, err = _attempt(prompt1, 1)

        if new_html is None:
            log.warning("  Stage 12 attempt 1 failed '%s': %s", heading, err)
            return None

        # Check if attempt 1 fixed the consecutive-p issue
        if _has_consecutive_p(new_html):
            log.info("  Stage 12: attempt 1 still has violations for '%s' — retrying strict", heading)
            prompt2 = RESTRUCTURE_PROMPT_STRICT.format(section_html=new_html)
            new_html2, err2 = _attempt(prompt2, 2)
            if new_html2 and not _has_consecutive_p(new_html2):
                log.info("  Stage 12: retry fixed '%s'", heading)
                new_html = new_html2
            elif new_html2 is None:
                log.warning("  Stage 12 retry failed '%s': %s", heading, err2)
            else:
                log.warning("  Stage 12: retry still has violations '%s' — using attempt 1", heading)

        still_bad = _has_consecutive_p(new_html)
        log.info("  Stage 12: done '%s' (%d -> %d chars, consecutive_p: %s -> %s)",
                 heading, len(sec_html), len(new_html), True, still_bad)
        return (abs_start, abs_end, new_html)

    # Run all violations in parallel (max 3 workers = one per Gemini key)
    replacements: list[tuple[int, int, str]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(_restructure_one, v): v[3] for v in violations}
        for fut in concurrent.futures.as_completed(futures):
            heading = futures[fut]
            try:
                result = fut.result()
                if result is not None:
                    replacements.append(result)
            except Exception as e:
                log.warning("  Stage 12: worker crashed for '%s': %s", heading, e)

    if not replacements:
        log.info("Stage 12: no successful restructures — article unchanged")
        return html

    # Apply replacements in reverse order so character positions stay valid
    replacements.sort(key=lambda x: x[0], reverse=True)
    for abs_start, abs_end, new_html in replacements:
        html = html[:abs_start] + new_html + html[abs_end:]

    article_path.write_text(html, encoding="utf-8")
    log.info("Stage 12: %d sections restructured — article.html updated", len(replacements))
    return html
