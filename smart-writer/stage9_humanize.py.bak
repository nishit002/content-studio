"""
stage9_humanize.py — Humanization Pass (Llama)

Input:  list[WrittenSection] (from Stage 8)
Output: list[WrittenSection] with humanized=True + updated HTML

What this does:
  - Second Llama pass on PROSE ONLY (<p> tags)
  - Tables are NEVER touched (they contain verified data, mustn't change)
  - Rewrites to remove AI-writing patterns:
      "It is worth noting", "Furthermore", "This highlights", "In conclusion",
      "It should be noted", "Notably", "Importantly", "This underscores"
  - Varies sentence length (mix short punchy + longer analytical)
  - Temperature 0.75 (higher for natural variation)
  - Overwrites the section HTML file in place
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from llm_client import GeminiClient, QwenClient
from models import WrittenSection

log = logging.getLogger("atlas.stage9")

# AI filler phrases to eliminate
AI_PATTERNS = [
    "it is worth noting", "it should be noted", "it is important to note",
    "furthermore", "moreover", "additionally", "in conclusion", "to summarise",
    "this highlights", "this underscores", "this demonstrates", "this showcases",
    "notably", "importantly", "significantly", "interestingly",
    "in the realm of", "in the landscape of", "it goes without saying",
    "needless to say", "as previously mentioned",
]

HUMANIZE_SYSTEM = """\
You are a professional editor specialising in Indian education content.
Your job is to rewrite AI-generated prose to sound natural and human.
You must ONLY rewrite <p> tag content. Leave all other HTML untouched.
"""

HUMANIZE_PROMPT = """\
Rewrite the prose in this HTML section to sound more natural and human.

RULES (strictly follow all):
1. Only rewrite text inside <p>...</p> tags. Do NOT change tables, headings, lists, or any other tags.
2. Remove these AI phrases: {ai_phrases}
3. Vary sentence length: mix short punchy sentences (8-12 words) with longer analytical ones (20-30 words).
4. Keep all facts, numbers, and data EXACTLY as they are. You cannot change any number.
5. Do not add new information. Do not remove facts.
6. Return the complete section HTML with your rewrites applied.
7. Do not add any explanation or commentary — just the HTML.

HTML to rewrite:
{html}
"""


INTRO_OUTRO_PROMPT = """\
You are a world-class editor for Indian education articles.

Article topic: {topic}
Article type: {article_type}

Current paragraph:
{paragraph}

Role of this paragraph: {role}

Write 3 alternative versions of this paragraph. Each version must:
1. Open with a specific, data-driven hook — a number, rank, date, or surprising fact from the original
2. Be 2-4 sentences (60-100 words)
3. NOT start with "This article", "In this guide", or just the topic name alone
4. Sound natural, like a senior journalist wrote it — not AI
5. Keep all factual data from the original exactly as-is (same numbers, names, dates)
6. Return valid HTML (a single <p> tag, no extra tags)

Return JSON only:
{{
  "versions": ["<p>version 1</p>", "<p>version 2</p>", "<p>version 3</p>"],
  "best_index": 0,
  "reason": "one sentence: why this version is strongest"
}}
"""


def run(
    sections: list[WrittenSection],
    run_dir: Path,
) -> list[WrittenSection]:
    """
    Run Stage 9 humanization pass.
    Updates sections in-place (overwrites .html files).
    Returns updated list[WrittenSection].
    """
    sections_dir = run_dir / "sections"
    if not sections_dir.exists():
        log.warning("Stage 9: sections directory not found — skipping humanization")
        return sections

    client = QwenClient()
    ai_phrases_str = ", ".join(f'"{p}"' for p in AI_PATTERNS[:12])  # keep prompt concise

    humanized: list[WrittenSection] = []

    for i, section in enumerate(sections):
        if section.humanized:
            log.info(f"  Stage 9 [{i+1}]: already humanized — skipping")
            humanized.append(section)
            continue

        # Find the checkpoint file for this section
        section_files = list(sections_dir.glob(f"{i:02d}_*.html"))
        if not section_files:
            log.warning(f"  Stage 9 [{i+1}]: section file not found — skipping")
            humanized.append(section)
            continue

        section_file = section_files[0]

        # Only bother humanizing if there's enough prose to matter
        prose_text = _extract_prose(section.html)
        if len(prose_text) < 100:
            log.info(f"  Stage 9 [{i+1}]: minimal prose — skipping: {section.heading[:50]}")
            section.humanized = True
            humanized.append(section)
            continue

        log.info(f"  Stage 9 [{i+1}]: humanizing: {section.heading[:60]}")

        prompt = HUMANIZE_PROMPT.format(
            ai_phrases=ai_phrases_str,
            html=section.html,
        )

        try:
            new_html = client.generate(
                system=HUMANIZE_SYSTEM,
                user=prompt,
                temperature=0.75,
                max_tokens=3000,
            )
        except Exception as e:
            log.warning(f"  Stage 9 [{i+1}]: humanization failed ({e}) — keeping original")
            section.humanized = True
            humanized.append(section)
            continue

        # Sanity check: new HTML should still contain the heading
        heading_text = re.sub(r"<[^>]+>", "", section.html.split("\n")[0])[:30]
        if heading_text and heading_text.lower() not in new_html.lower():
            log.warning(f"  Stage 9 [{i+1}]: humanized output lost heading — keeping original")
            section.humanized = True
            humanized.append(section)
            continue

        # Overwrite the section file
        section_file.write_text(new_html, encoding="utf-8")

        section.html = new_html
        section.word_count = _word_count(new_html)
        section.humanized = True
        log.info(f"  Stage 9 [{i+1}]: done ({section.word_count} words)")
        humanized.append(section)

    log.info(f"Stage 9: humanized {sum(1 for s in humanized if s.humanized)}/{len(sections)} sections")

    # Polish intro + outro: 3 variants each, Gemini picks best
    blueprint_path = run_dir / "blueprint.json"
    if blueprint_path.exists():
        try:
            bp = json.loads(blueprint_path.read_text(encoding="utf-8"))
            humanized = _polish_intro_outro(
                humanized, run_dir,
                topic=bp.get("topic", ""),
                article_type=bp.get("article_type", ""),
            )
        except Exception as e:
            log.warning(f"Stage 9: intro/outro polish skipped ({e})")

    return humanized


def _polish_intro_outro(
    sections: list[WrittenSection],
    run_dir: Path,
    topic: str,
    article_type: str,
) -> list[WrittenSection]:
    """
    Generate 3 variants of the opening paragraph (first section) and closing
    paragraph (last section). Gemini picks the best. Non-blocking.
    """
    if not sections or not topic:
        return sections

    gemini = GeminiClient()
    sections_dir = run_dir / "sections"

    def _pick_best(para_html: str, role: str) -> str | None:
        try:
            result = gemini.generate_json(
                INTRO_OUTRO_PROMPT.format(
                    topic=topic,
                    article_type=article_type,
                    paragraph=para_html,
                    role=role,
                ),
                temperature=0.7,
                max_tokens=1024,
            )
            versions = result.get("versions", [])
            best_idx = int(result.get("best_index", 0))
            reason = result.get("reason", "")
            if versions and 0 <= best_idx < len(versions):
                log.info(f"  Picked version {best_idx}: {reason[:80]}")
                return versions[best_idx]
        except Exception as e:
            log.warning(f"  Variant selection failed ({e}) — keeping original")
        return None

    def _save_section(section: WrittenSection, idx: int) -> None:
        files = list(sections_dir.glob(f"{idx:02d}_*.html"))
        if files:
            files[0].write_text(section.html, encoding="utf-8")

    # ── Opening paragraph (first section, first <p>) ──
    first_p = re.search(r"<p[^>]*>.*?</p>", sections[0].html, re.DOTALL | re.IGNORECASE)
    if first_p:
        log.info("  Stage 9 polish: 3 intro variants")
        best = _pick_best(first_p.group(0), "opening paragraph — first thing the reader sees")
        if best:
            sections[0].html = sections[0].html.replace(first_p.group(0), best, 1)
            _save_section(sections[0], 0)

    # ── Closing paragraph (last section, last <p>) ──
    all_p = list(re.finditer(r"<p[^>]*>.*?</p>", sections[-1].html, re.DOTALL | re.IGNORECASE))
    if len(all_p) > 1:  # skip if only one paragraph — too risky to replace
        last_p = all_p[-1]
        log.info("  Stage 9 polish: 3 outro variants")
        best = _pick_best(
            last_p.group(0),
            "closing paragraph — last thing the reader sees, should leave a strong impression",
        )
        if best:
            idx = len(sections) - 1
            sections[-1].html = sections[-1].html.replace(last_p.group(0), best, 1)
            _save_section(sections[-1], idx)

    return sections


def _extract_prose(html: str) -> str:
    """Extract just the text inside <p> tags."""
    p_tags = re.findall(r"<p[^>]*>(.*?)</p>", html, re.DOTALL | re.IGNORECASE)
    return " ".join(re.sub(r"<[^>]+>", "", p) for p in p_tags)


def _word_count(html: str) -> int:
    text = re.sub(r"<[^>]+>", " ", html)
    return len(text.split())
