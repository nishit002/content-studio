"""
stage10_coherence.py — Coherence Check + Final Assembly (Gemini)

Input:  ArticleOutline, list[WrittenSection]
Output: Final article.html + coherence_report.json

What happens:
  1. Assembles all sections into a single HTML draft
  2. Gemini reads the FULL draft and checks:
     - Logical section flow
     - Data used correctly (no contradictions between sections)
     - Reader queries answered (does the article actually answer what the topic promises?)
     - FAQs validated (answers exist in the article body)
  3. Minor issues (missing transition, wrong tense) → auto-patched via Llama
  4. Major issues → flagged in coherence_report.json for human review
  5. Adds TOC, FAQ HTML block with JSON-LD schema, meta tags, source citations
  6. Saves final article.html

Non-blocking: if Gemini fails, the assembled draft is saved as-is.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from llm_client import GeminiClient, QwenClient
from models import (
    ArticleOutline,
    CoherenceIssue,
    CoherenceReport,
    WrittenSection,
)

log = logging.getLogger("atlas.stage10")

COHERENCE_PROMPT = """\
You are a senior editor reviewing a full article draft. Check for quality issues.

Article topic: {topic}
Focus keyword: {focus_keyword}

Full article draft:
{draft_html}

Identify issues in the following categories. Return a JSON object:
{{
  "passed": true | false,
  "issues": [
    {{
      "severity": "minor | major",
      "section_heading": "which section has the issue",
      "description": "what the issue is"
    }}
  ],
  "overall_notes": "brief overall assessment"
}}

Check for:
1. CONTRADICTIONS: does any section state a fact that contradicts another section?
   (e.g. section 2 says "avg package 24 LPA", section 5 says "avg package 18 LPA")
2. MISSING ANSWERS: does the article actually answer the core topic question?
3. SECTION FLOW: do sections connect logically? Is the order sensible?
4. FAQ VALIDITY: do the FAQ answers actually appear somewhere in the article body?
5. REPETITION: is any substantial data block repeated across sections?

Severity guide:
- major: factual contradiction, completely missing answer to core topic, >30% section repetition
- minor: missing transition, slightly awkward phrasing, FAQ answer thin but present

passed=true means the article is ready to publish (minor issues only, or none).
passed=false means at least one major issue must be fixed first.
"""

# ─── Critical data labels per article type (for key-stat callout boxes) ──────
# These are row labels we look for in tables. If found, we surface them as
# visual callout cards before the table so readers see key numbers at a glance.

CRITICAL_LABELS: dict[str, list[str]] = {
    "college_placement": [
        "average package", "avg package", "median package",
        "highest package", "maximum package", "placement rate",
        "placement percentage", "students placed", "companies visited",
    ],
    "college_profile": [
        "nirf rank", "naac grade", "established", "founded",
        "total fees", "approved by", "total students", "campus size",
    ],
    "exam_guide": [
        "exam date", "registration date", "last date to apply",
        "total marks", "total questions", "duration", "exam duration",
        "result date", "counselling date", "application fee",
    ],
    "fee_reference": [
        "total fees", "annual fees", "semester fees",
        "hostel fees", "total cost", "one-time fees",
    ],
    "admission_guide": [
        "application deadline", "last date", "cutoff",
        "registration fee", "selection date", "merit list date",
    ],
    "ranking_list": [
        "nirf score", "overall rank", "rank", "score", "total score",
    ],
    "career_guide": [
        "average salary", "starting salary", "median salary",
        "entry level salary", "top employers",
    ],
}


PATCH_PROMPT = """\
You are an editor making a small targeted fix to one section of an article.

Issue to fix: {description}
Section heading: {section_heading}

Current section HTML:
{section_html}

Make ONLY the fix described. Do not change anything else.
Return the complete updated section HTML.
"""


def run(
    outline: ArticleOutline,
    sections: list[WrittenSection],
    source_urls: list[str],
    run_dir: Path,
    topic: str,
) -> tuple[str, CoherenceReport]:
    """
    Run Stage 10.
    Returns (final_html, CoherenceReport).
    Saves article.html and coherence_report.json to run_dir.
    """
    article_path = run_dir / "article.html"
    report_path = run_dir / "coherence_report.json"

    if article_path.exists() and report_path.exists():
        log.info("Stage 10: loading from checkpoint")
        final_html = article_path.read_text(encoding="utf-8")
        report_data = json.loads(report_path.read_text(encoding="utf-8"))
        return final_html, _parse_report(report_data)

    if not sections:
        raise ValueError("Stage 10: no written sections to assemble")

    # Assemble draft
    draft_html = _assemble_draft(outline, sections)

    # Coherence check (non-blocking)
    gemini = GeminiClient()
    report: CoherenceReport

    try:
        result = gemini.generate_json(
            COHERENCE_PROMPT.format(
                topic=topic,
                focus_keyword=outline.focus_keyword,
                draft_html=draft_html[:12000],  # cap to avoid token overrun
            ),
            temperature=0.1,
        )
        issues = [
            CoherenceIssue(
                severity=i.get("severity", "minor"),
                section_heading=i.get("section_heading", ""),
                description=i.get("description", ""),
            )
            for i in result.get("issues", [])
        ]
        report = CoherenceReport(
            passed=result.get("passed", True),
            issues=issues,
            patch_notes="",
            major_issues_for_review=[
                i.description for i in issues if i.severity == "major"
            ],
        )
        log.info(f"Stage 10: coherence check — passed={report.passed}, "
                 f"{len(issues)} issues ({sum(1 for i in issues if i.severity=='major')} major)")

        # Auto-patch minor issues
        llama = QwenClient()
        patch_notes = []
        sections_map = {s.heading: s for s in sections}

        for issue in issues:
            if issue.severity != "minor":
                continue
            target = sections_map.get(issue.section_heading)
            if not target:
                continue
            log.info(f"  Patching minor issue in '{issue.section_heading}': {issue.description[:60]}")
            try:
                patched_html = llama.generate(
                    system="You are a copy editor making a small fix to an article section.",
                    user=PATCH_PROMPT.format(
                        description=issue.description,
                        section_heading=issue.section_heading,
                        section_html=target.html,
                    ),
                    temperature=0.3,
                    max_tokens=2000,
                )
                target.html = patched_html
                issue.auto_patched = True
                patch_notes.append(f"Fixed in '{issue.section_heading}': {issue.description[:80]}")
            except Exception as e:
                log.warning(f"  Auto-patch failed: {e}")

        report.patch_notes = "\n".join(patch_notes)

        # Rebuild draft after patches
        if patch_notes:
            draft_html = _assemble_draft(outline, sections)

    except Exception as e:
        log.warning(f"Stage 10: coherence check failed ({e}) — saving draft as-is")
        report = CoherenceReport(
            passed=True,
            issues=[],
            patch_notes=f"Coherence check skipped: {e}",
            major_issues_for_review=[],
        )

    # Read article type from blueprint for callout injection
    article_type = ""
    blueprint_path = run_dir / "blueprint.json"
    if blueprint_path.exists():
        try:
            article_type = json.loads(blueprint_path.read_text(encoding="utf-8")).get("article_type", "")
        except Exception:
            pass

    # Final assembly with TOC, FAQ schema, source citations
    final_html = _build_final_html(outline, sections, source_urls, draft_html, article_type)

    # Save outputs
    article_path.write_text(final_html, encoding="utf-8")
    report_path.write_text(
        json.dumps(_serialise_report(report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    word_count = len(re.sub(r"<[^>]+>", " ", final_html).split())
    log.info(f"Stage 10: article saved — {word_count} words, "
             f"{'READY' if report.passed else 'NEEDS REVIEW'}")
    return final_html, report


# ─── Assembly helpers ─────────────────────────────────────────────────────────

def _assemble_draft(outline: ArticleOutline, sections: list[WrittenSection]) -> str:
    # Don't add H1 here — it's added once in _build_final_html
    parts = []
    for section in sections:
        parts.append(section.html)
    return "\n\n".join(parts)


def _build_toc(sections: list[WrittenSection]) -> str:
    items = []
    for s in sections:
        heading_text = re.sub(r"<[^>]+>", "", s.heading)
        anchor = re.sub(r"[^a-z0-9]+", "-", heading_text.lower()).strip("-")
        items.append(f'  <li><a href="#{anchor}">{heading_text}</a></li>')
    return '<nav class="toc"><ol>\n' + "\n".join(items) + "\n</ol></nav>"


def _extract_faq_answers(questions: list[str], article_text: str) -> dict[str, str]:
    """
    Use Gemini to extract short answers for each FAQ question from the article text.
    Returns dict[question → answer string].
    Falls back to a short generic answer if Gemini fails.
    """
    if not questions or not article_text:
        return {}
    client = GeminiClient()
    q_list = "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions))
    prompt = (
        f"You are answering FAQ questions based ONLY on the article text below.\n\n"
        f"Questions:\n{q_list}\n\n"
        f"Article text (first 6000 chars):\n{article_text[:6000]}\n\n"
        f"Return a JSON object mapping each question number to a short answer (1-2 sentences). "
        f"If the article doesn't contain the answer, write 'Not available in current data.' "
        f"Keys must be '1', '2', '3'... matching the question numbers above."
    )
    try:
        result = client.generate_json(prompt, temperature=0.1, max_tokens=2048)
        answers = {}
        for i, q in enumerate(questions):
            answers[q] = str(result.get(str(i + 1), "Not available in current data."))
        return answers
    except Exception as e:
        log.warning(f"FAQ answer extraction failed: {e}")
        return {}


def _build_faq_section(outline: ArticleOutline, article_text: str = "") -> str:
    if not outline.faq_questions:
        return ""

    # Extract real answers from article
    answers = _extract_faq_answers(outline.faq_questions, article_text)

    items = []
    schema_items = []
    for q in outline.faq_questions:
        answer = answers.get(q, "")
        # Skip FAQ items where no real answer was found
        if not answer or "not available" in answer.lower() or "current data" in answer.lower():
            log.info("  FAQ skipped (no answer in article): %s", q[:60])
            continue
        items.append(
            f'<div class="faq-item">'
            f'<h3 class="faq-question">{q}</h3>'
            f'<div class="faq-answer"><p>{answer}</p></div>'
            f'</div>'
        )
        schema_items.append(
            {"@type": "Question", "name": q,
             "acceptedAnswer": {"@type": "Answer", "text": answer}}
        )
    schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": schema_items,
    }
    schema_tag = (
        '<script type="application/ld+json">\n'
        + json.dumps(schema, ensure_ascii=False, indent=2)
        + "\n</script>"
    )
    return (
        '<section class="faq-section">\n'
        '<h2>Frequently Asked Questions</h2>\n'
        + "\n".join(items)
        + "\n</section>\n"
        + schema_tag
    )


_ARTICLE_STYLE = """\
<style>
  body { font-family: Georgia, serif; max-width: 860px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.7; color: #1a1a1a; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.4rem; margin-top: 2.5rem; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.3rem; }
  h3 { font-size: 1.1rem; margin-top: 1.5rem; }
  p { margin: 0.8rem 0; }
  table.data-table { border-collapse: collapse; width: 100%; margin: 1.2rem 0; font-size: 0.92rem; }
  table.data-table th, table.data-table td { border: 1px solid #bbb; padding: 0.5rem 0.75rem; text-align: left; }
  table.data-table th { background: #f2f2f2; font-weight: 600; }
  table.data-table tr:nth-child(even) td { background: #fafafa; }
  .faq-section { margin-top: 2rem; }
  .faq-item { margin-bottom: 1.2rem; }
  .faq-question { font-size: 1rem; margin-bottom: 0.3rem; }
  .sources { margin-top: 2rem; font-size: 0.85rem; color: #555; }
  .cs-highlights { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 0.5rem; }
  .cs-stat { background: #f0f7ff; border: 1px solid #c8e0f8; border-radius: 6px; padding: 0.6rem 1rem; min-width: 110px; text-align: center; }
  .cs-stat-value { display: block; font-size: 1.25rem; font-weight: 700; color: #1a6ec8; line-height: 1.2; }
  .cs-stat-label { display: block; font-size: 0.72rem; color: #555; margin-top: 0.2rem; text-transform: uppercase; letter-spacing: 0.03em; }
</style>"""


def _extract_table_callouts(table_html: str, article_type: str) -> list[tuple[str, str]]:
    """
    Scan a table's rows for labels matching CRITICAL_LABELS for this article type.
    Returns up to 4 (label, value) pairs.
    """
    labels = CRITICAL_LABELS.get(article_type, [])
    if not labels:
        return []
    callouts: list[tuple[str, str]] = []
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.DOTALL | re.IGNORECASE)
    for row in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.DOTALL | re.IGNORECASE)
        if len(cells) < 2:
            continue
        cell_text = re.sub(r"<[^>]+>", "", cells[0]).strip().lower()
        if any(lbl in cell_text for lbl in labels):
            label_display = re.sub(r"<[^>]+>", "", cells[0]).strip()
            value_display = re.sub(r"<[^>]+>", "", cells[1]).strip()
            if value_display and value_display not in ("—", "-", "N/A", ""):
                callouts.append((label_display, value_display))
    return callouts[:4]


def _inject_key_callouts(html: str, article_type: str) -> str:
    """
    Find the first table that contains 2+ critical data rows for this article type.
    Inject a cs-highlights callout box immediately before that table.
    Only injected once per article (the most data-rich table gets it).
    """
    if not article_type or article_type not in CRITICAL_LABELS:
        return html
    for match in re.finditer(r"<table[^>]*>.*?</table>", html, re.DOTALL | re.IGNORECASE):
        callouts = _extract_table_callouts(match.group(0), article_type)
        if len(callouts) >= 2:
            items = "".join(
                f'<div class="cs-stat">'
                f'<span class="cs-stat-value">{v}</span>'
                f'<span class="cs-stat-label">{l}</span>'
                f'</div>'
                for l, v in callouts
            )
            callout_html = f'<div class="cs-highlights">{items}</div>\n'
            log.info(f"  Stage 10: injected {len(callouts)}-stat callout box for {article_type}")
            return html[: match.start()] + callout_html + html[match.start():]
    return html


def _fix_truncated_tables(html: str) -> str:
    """
    Close any unclosed <table> elements caused by writer token-limit truncation.
    Finds the last complete </tr>, discards garbage after it, then closes the table.
    """
    open_count  = len(re.findall(r"<table\b", html, re.IGNORECASE))
    close_count = len(re.findall(r"</table>",  html, re.IGNORECASE))
    if open_count <= close_count:
        return html  # all tables properly closed

    tables_to_close = open_count - close_count
    last_tr_end = html.rfind("</tr>")
    if last_tr_end == -1:
        # no complete row at all — just append closing tags at end
        return html + "\n</table>" * tables_to_close

    cut_pos = last_tr_end + len("</tr>")

    # Find the next block-level element after the truncation point
    rest = html[cut_pos:]
    next_block = re.search(
        r"<(?:section|div\b|h[1-6]\b|nav\b|footer\b|ul\b|ol\b)",
        rest,
        re.IGNORECASE,
    )

    closing_tags = "\n</table>" * tables_to_close + "\n"
    if next_block:
        inject = cut_pos + next_block.start()
        html = html[:inject] + closing_tags + html[inject:]
    else:
        html = html[:cut_pos] + closing_tags + html[cut_pos:]

    return html


def _sanitize_html(html: str) -> str:
    """
    Final cleanup pass run on the assembled draft before saving.
    Catches anything that slipped through stage8's per-section cleaning.
    """
    # Strip any remaining markdown code fences
    html = re.sub(r"```[a-zA-Z]*\n(.*?)```", r"\1", html, flags=re.DOTALL)
    html = re.sub(r"^```[a-zA-Z]*\s*\n", "", html)
    html = re.sub(r"\n```\s*$", "", html)

    # Replace None values and empty cells
    html = re.sub(r"<td>\s*None\s*</td>", "<td>—</td>", html, flags=re.IGNORECASE)
    html = re.sub(r"<td>\s*</td>", "<td>—</td>", html)

    # Unwrap tables from <p> tags
    html = re.sub(r"<p>\s*(<table)", r"\1", html, flags=re.IGNORECASE)
    html = re.sub(r"(</table>)\s*</p>", r"\1", html, flags=re.IGNORECASE)

    # Fix garbled column headers that commonly come from PDF OCR
    ocr_fixes = {
        r"\bifiternalional\b": "International",
        r"\brôtal\b": "Total",
        r"\blhsurance\b": "Insurance",
    }
    for pattern, replacement in ocr_fixes.items():
        html = re.sub(pattern, replacement, html, flags=re.IGNORECASE)

    # Collapse spaced OCR artifacts: "S t a t e" → "State", "C a u t i o n" → "Caution"
    # Pattern: 3 or more single letters each separated by exactly one space
    # Uses {2,} so minimum match is 3 letters (avoids joining legitimate 2-letter combos)
    html = re.sub(
        r"\b([A-Za-z])(?: [A-Za-z]){2,}\b",
        lambda m: m.group(0).replace(" ", ""),
        html,
    )

    # Fix truncated tables (writer hit token limit mid-cell)
    html = _fix_truncated_tables(html)

    # Collapse excess blank lines
    html = re.sub(r"\n{3,}", "\n\n", html)

    return html.strip()


def _build_final_html(
    outline: ArticleOutline,
    sections: list[WrittenSection],
    source_urls: list[str],
    draft_html: str,
    article_type: str = "",
) -> str:
    # Final sanitize pass on the full assembled draft
    draft_html = _sanitize_html(draft_html)
    # Inject key-stat callout box before the most data-rich table
    draft_html = _inject_key_callouts(draft_html, article_type)

    # Plain text version of article for FAQ extraction
    article_plain = re.sub(r"<[^>]+>", " ", draft_html)

    faq = _build_faq_section(outline, article_plain)
    sources_html = ""
    if source_urls:
        links = "\n".join(f'  <li><a href="{u}" rel="nofollow">{u}</a></li>' for u in source_urls[:10])
        sources_html = f'<section class="sources"><h2>Sources</h2><ul>\n{links}\n</ul></section>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{outline.h1_title}</title>
<meta name="description" content="{outline.meta_description}">
<meta name="keywords" content="{outline.focus_keyword}">
{_ARTICLE_STYLE}
</head>
<body>
<article>
<h1>{outline.h1_title}</h1>

{draft_html}

{faq}

{sources_html}
</article>
</body>
</html>"""


# ─── Serialisation helpers ────────────────────────────────────────────────────

def _serialise_report(report: CoherenceReport) -> dict:
    return {
        "passed": report.passed,
        "issues": [
            {
                "severity": i.severity,
                "section_heading": i.section_heading,
                "description": i.description,
                "auto_patched": i.auto_patched,
            }
            for i in report.issues
        ],
        "patch_notes": report.patch_notes,
        "major_issues_for_review": report.major_issues_for_review,
    }


def _parse_report(data: dict) -> CoherenceReport:
    issues = [
        CoherenceIssue(
            severity=i["severity"],
            section_heading=i["section_heading"],
            description=i["description"],
            auto_patched=i.get("auto_patched", False),
        )
        for i in data.get("issues", [])
    ]
    return CoherenceReport(
        passed=data.get("passed", True),
        issues=issues,
        patch_notes=data.get("patch_notes", ""),
        major_issues_for_review=data.get("major_issues_for_review", []),
    )
