"""
stage11_proofread.py — Spelling, Grammar & Special Character Fix (Gemini)

Input:  article.html (from Stage 10)
Output: article.html (overwritten, cleaned), article_pre_proofread.html (backup)

What happens:
  1. Extracts all <p> tag contents from the article
  2. Sends them to Gemini in batches of 15 paragraphs
  3. Gemini fixes:
     - Spelling mistakes
     - Garbled special characters from PDF OCR (â€™ → ', â€" → —, ã€ → ", etc.)
     - Basic grammar (subject-verb agreement, wrong articles a/an)
  4. Does NOT touch: numbers, percentages, names, rankings, exam names, table data
  5. Replaces fixed paragraphs back into the HTML
  6. Saves updated article.html + backup article_pre_proofread.html

Non-blocking: if Gemini fails on any batch, that batch is kept as-is.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from pathlib import Path

from llm_client import GeminiClient

log = logging.getLogger("atlas.stage11")

BATCH_SIZE = 15  # paragraphs per Gemini call

PROOFREAD_PROMPT = """\
You are a proofreader for an educational article. Fix ONLY the following in each paragraph:

1. SPELLING MISTAKES — correct clearly misspelled words
2. GARBLED SPECIAL CHARACTERS — PDF/OCR artifacts like:
   â€™ → '   (apostrophe)
   â€" → —   (em dash)
   â€œ → "   (open quote)
   â€  → "   (close quote)
   Â  → (remove, it's a junk byte)
   ã€  → "   (bracket open)
   Ã©  → é
   Any other obvious Unicode garbling → correct character
3. BASIC GRAMMAR — subject-verb agreement, wrong article (a vs an)

DO NOT change:
- Any number, percentage, rank, salary figure, or score
- Any institution name, person name, city, country name
- Any exam name, course name, or technical term
- Any sentence structure, meaning, or order
- Anything inside <b>, <strong>, <a>, or other tags — fix only the visible text

Input: {count} numbered paragraphs below.
Return ONLY a JSON object mapping each number (as string) to its corrected text.
Example: {{"1": "corrected para one", "2": "corrected para two"}}
If a paragraph needs no changes, return it unchanged.

Paragraphs:
{paragraphs}
"""


def run(run_dir: Path) -> str:
    """
    Run Stage 11 on the article.html in run_dir.
    Returns the corrected HTML string.
    Overwrites article.html, saves backup as article_pre_proofread.html.
    """
    article_path = run_dir / "article.html"
    backup_path  = run_dir / "article_pre_proofread.html"

    if not article_path.exists():
        raise FileNotFoundError(f"Stage 11: article.html not found at {article_path}")

    html = article_path.read_text(encoding="utf-8")

    # Find all <p> tags with their full content
    p_pattern = re.compile(r'(<p[^>]*>)(.*?)(</p>)', re.DOTALL | re.IGNORECASE)
    matches = list(p_pattern.finditer(html))

    if not matches:
        log.warning("Stage 11: no <p> tags found — skipping proofread")
        return html

    # Extract inner text of each <p> (preserving inline tags like <b>, <a>)
    paragraphs = [(m.start(), m.end(), m.group(1), m.group(2), m.group(3))
                  for m in matches]

    log.info("Stage 11: proofreading %d paragraphs in batches of %d", len(paragraphs), BATCH_SIZE)

    # Process in batches
    client = GeminiClient()
    corrections: dict[int, str] = {}  # index → corrected inner HTML

    for batch_start in range(0, len(paragraphs), BATCH_SIZE):
        batch = paragraphs[batch_start : batch_start + BATCH_SIZE]
        batch_map = {}  # 1-based number within this batch → (global index, inner html)
        for i, (_, _, _, inner, _) in enumerate(batch, start=1):
            batch_map[i] = (batch_start + i - 1, inner)

        # Build numbered paragraph list for prompt
        p_lines = "\n\n".join(
            f"{i}. {inner}" for i, (_, inner) in batch_map.items()
        )

        try:
            result = client.generate_json(
                PROOFREAD_PROMPT.format(count=len(batch), paragraphs=p_lines),
                temperature=0.1,
                max_tokens=4096,
            )
            # result should be {"1": "...", "2": "...", ...}
            for num_str, corrected_text in result.items():
                try:
                    num = int(num_str)
                    if num in batch_map:
                        global_idx, original = batch_map[num]
                        if corrected_text and corrected_text != original:
                            corrections[global_idx] = corrected_text
                except (ValueError, TypeError):
                    continue
            log.info("  Batch %d-%d: %d fixes applied",
                     batch_start + 1, batch_start + len(batch),
                     sum(1 for i, _ in batch_map.values() if i in corrections))
        except Exception as e:
            log.warning("  Batch %d-%d: Gemini failed (%s) — keeping as-is",
                        batch_start + 1, batch_start + len(batch), e)

    if not corrections:
        log.info("Stage 11: no corrections needed — article looks clean")
        return html

    # Rebuild HTML by replacing corrected paragraphs
    # Work backwards through matches to preserve string offsets
    html_chars = list(html)
    for idx in sorted(corrections.keys(), reverse=True):
        start, end, open_tag, _original, close_tag = paragraphs[idx]
        fixed_inner = corrections[idx]
        replacement = open_tag + fixed_inner + close_tag
        html_chars[start:end] = list(replacement)

    corrected_html = "".join(html_chars)

    # Save backup, then overwrite
    shutil.copy2(article_path, backup_path)
    article_path.write_text(corrected_html, encoding="utf-8")

    log.info("Stage 11: %d paragraphs corrected — article.html updated (backup: article_pre_proofread.html)",
             len(corrections))
    return corrected_html
