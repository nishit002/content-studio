"""
stage7_outline.py — Article Outline (Gemini)

Input:  Blueprint, ArticleCharacter, list[VerifiedSubTopic]
Output: ArticleOutline dataclass + outline.json checkpoint

What Gemini does here:
  - Receives verified data (only what survived Stage 6)
  - Only creates sections where verified data EXISTS (no empty/filler sections)
  - Applies character.json to shape the structure:
      data-heavy  → lead each section with a table
      comparison  → add comparison columns across sub-topics
      timeline    → structure sections year-by-year
      faq-first   → open with a FAQ block
  - Targets 700-900 words per section
  - Headings must contain a specific fact/number from the data
  - FAQs derived from actual reader intent (what students search for)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from llm_client import GeminiClient
from models import (
    ArticleCharacter,
    ArticleOutline,
    Blueprint,
    SectionPlan,
    VerifiedSubTopic,
)

log = logging.getLogger("atlas.stage7")

OUTLINE_PROMPT = """\
You are an SEO content strategist. You must create a detailed article outline.

Topic: {topic}
Primary entity: {primary_entity}
Article type: {article_type}
Content character: {content_character}

VERIFIED DATA available (only use these sub-topics — no others):
{verified_summary}

Character research notes: {character_notes}
Typical section order from top-ranking articles: {section_order}

═══ H1 TITLE RULES (read carefully — violations are NOT acceptable) ═══

BANNED title patterns — NEVER use any of these:
  ✗ "ENTITY: What It Is, Key Facts & Why It Matters"
  ✗ "ENTITY: What ABBREVIATION Is, Key Facts & Why It Matters"
  ✗ "Complete Guide to ENTITY"
  ✗ "Everything You Need to Know About ENTITY"
  ✗ "All About ENTITY"
  ✗ "ENTITY: An Overview"
  ✗ Any title that re-abbreviates the entity name
    (e.g. if entity is "VIT-AP Amaravathi", do NOT write "What VIT is" — "VIT" is not short for anything you should expand or re-abbreviate)

REQUIRED: Use the primary_entity name EXACTLY as given above. Do not shorten, re-abbreviate, or expand it.

REQUIRED title format per article type (replace ENTITY/YEAR/EXAM/FIELD/RANKING_NAME with actual values):
  college_profile    → "ENTITY: Courses, Fees, Rankings & Placement YEAR"
                       OR "ENTITY Review YEAR: Admission, Fees & Campus Life"
  college_placement  → "ENTITY Placements YEAR: Average Package, Top Recruiters & Stats"
  exam_guide         → "EXAM YEAR: Syllabus, Exam Pattern, Eligibility & Dates"
  fee_reference      → "ENTITY Fees YEAR: B.Tech, MBA & Hostel Cost Breakdown"
  admission_guide    → "ENTITY Admission YEAR: Eligibility, Cutoff & How to Apply"
  ranking_list       → "RANKING_NAME YEAR: Top Colleges, Scores & Category-Wise List"
  career_guide       → "Career in FIELD: Salary, Job Roles & How to Get Started"

If you have a strong verified stat (NIRF rank, avg package, founded year), include it:
  GOOD: "VIT-AP Amaravathi: Courses, Fees, NIRF Rank & Placement 2025"
  GOOD: "IIM Ahmedabad Placements 2024: ₹32.2 LPA Average, 100% Placement"

═══ SECTION HEADING RULES ═══

1. Only include sections where verified data EXISTS in the list above.
   If a sub-topic has has_data=false, DO NOT create a section for it.
2. 5-8 sections total (not counting FAQ). Each section = 600-800 words target.
3. Section headings MUST contain a specific fact or number from the verified data.
   BAD: "IIM Ahmedabad Placement Overview"
   GOOD: "IIM Ahmedabad Placements 2024: 100% Placement with ₹32.2 LPA Average"
4. Each sub-topic id must appear in AT MOST ONE section's sub_topic_ids list.
   NEVER assign the same sub-topic to two different sections — this creates duplicate content.
5. Adapt to the content character:
   - data-heavy: open each section with a data table, then analytical prose
   - comparison: include cross-entity comparison columns
   - timeline: structure chronologically with year labels
   - faq-first: place FAQ section FIRST (before detailed sections)
6. FAQs must be real questions students search for (not generic).
7. Do NOT create a standalone FAQ section in the sections array — FAQs are handled separately.

Return a JSON object:
{{
  "h1_title": "title following the format required for this article_type — NO generic patterns",
  "meta_description": "150-160 char meta description with focus keyword",
  "focus_keyword": "primary keyword phrase",
  "sections": [
    {{
      "heading": "H2 heading with specific fact",
      "level": 2,
      "section_type": "table | prose | mixed | faq",
      "sub_topic_ids": ["id1", "id2"],
      "word_target": 750,
      "format_hint": "lead with table, then 2 paragraphs of analysis",
      "content_character_note": "what the character research implies for this section"
    }}
  ],
  "faq_questions": [
    "What is the average package at IIM Ahmedabad in 2024?",
    "..."
  ],
  "schema_type": "Article | FAQPage | Course"
}}
"""


def run(
    blueprint: Blueprint,
    character: ArticleCharacter,
    verified_subtopics: list[VerifiedSubTopic],
    run_dir: Path,
) -> ArticleOutline:
    """
    Run Stage 7. Returns ArticleOutline and saves outline.json to run_dir.
    Loads from checkpoint if already exists.
    """
    checkpoint = run_dir / "outline.json"

    if checkpoint.exists():
        log.info("Stage 7: loading from checkpoint")
        data = json.loads(checkpoint.read_text(encoding="utf-8"))
        return _parse_outline(data)

    # Filter to sub-topics that have verified data
    with_data = [vst for vst in verified_subtopics if vst.has_data]
    if not with_data:
        raise ValueError(
            "Stage 7: no sub-topics have verified data — cannot build outline. "
            "Check Stage 4 entity validation and Stage 6 verification."
        )

    log.info(f"Stage 7: building outline from {len(with_data)} verified sub-topics")

    # Build verified summary for prompt
    verified_summary = _build_verified_summary(with_data)

    prompt = OUTLINE_PROMPT.format(
        topic=blueprint.topic,
        primary_entity=blueprint.primary_entity,
        article_type=blueprint.article_type,
        content_character=character.content_character,
        verified_summary=verified_summary,
        character_notes=character.notes or "none",
        section_order=", ".join(character.section_order) if character.section_order else "no specific order",
    )

    client = GeminiClient()
    result = client.generate_json(prompt, temperature=0.2, max_tokens=8192)

    # Validate required keys
    if "sections" not in result or not result["sections"]:
        raise ValueError(f"Outline missing 'sections'. Got: {list(result.keys())}")

    # Sanity-check h1_title: catch generic clickbait patterns and replace
    h1 = result.get("h1_title", "")
    if _is_generic_title(h1, blueprint.primary_entity):
        fixed = _build_fallback_title(blueprint.primary_entity, blueprint.article_type)
        log.warning(f"Stage 7: generic h1_title detected → replacing with: {fixed}")
        result["h1_title"] = fixed

    # Deduplicate sub_topic_ids across sections — each id must appear in at most one section
    seen_ids: set[str] = set()
    for section in result["sections"]:
        unique = [sid for sid in section.get("sub_topic_ids", []) if sid not in seen_ids]
        seen_ids.update(unique)
        section["sub_topic_ids"] = unique

    # Drop sections that ended up with no sub_topic_ids after dedup
    result["sections"] = [s for s in result["sections"] if s.get("sub_topic_ids")]

    # Drop FAQ sections from sections array (handled by stage10)
    result["sections"] = [
        s for s in result["sections"]
        if "faq" not in s.get("section_type", "").lower()
        and "faq" not in s.get("heading", "").lower()[:20]
    ]

    # Save checkpoint
    checkpoint.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info(f"Stage 7: outline saved → {len(result['sections'])} sections")

    return _parse_outline(result)


_GENERIC_TITLE_PATTERNS = [
    "what it is", "what is it", "key facts", "why it matters",
    "complete guide", "everything you need", "everything about",
    "all you need to know", "an overview", "all about",
]


def _is_generic_title(title: str, entity: str) -> bool:
    """Return True if the title matches a banned generic pattern."""
    t = title.lower()
    return any(pat in t for pat in _GENERIC_TITLE_PATTERNS)


_FALLBACK_TITLE_TEMPLATES: dict[str, str] = {
    "college_profile":   "{entity}: Courses, Fees, Rankings & Placement 2025",
    "college_placement": "{entity} Placements 2025: Packages, Recruiters & Statistics",
    "exam_guide":        "{entity} 2025: Syllabus, Exam Pattern, Eligibility & Dates",
    "fee_reference":     "{entity} Fees 2025: Programme-Wise Cost & Scholarships",
    "admission_guide":   "{entity} Admission 2025: Eligibility, Cutoff & How to Apply",
    "ranking_list":      "{entity} 2025: Top Colleges, Scores & Category Rankings",
    "career_guide":      "Career in {entity}: Salary, Job Roles & How to Get Started",
}


def _build_fallback_title(entity: str, article_type: str) -> str:
    """Build a safe, structured title when Gemini returns a generic one."""
    template = _FALLBACK_TITLE_TEMPLATES.get(article_type, "{entity}: Complete Information 2025")
    return template.format(entity=entity)


def _build_verified_summary(verified_subtopics: list[VerifiedSubTopic]) -> str:
    """
    Build a concise text summary of verified data for the outline prompt.
    Shows: sub_topic name, key facts (first 5), table titles.
    """
    lines = []
    for vst in verified_subtopics:
        lines.append(f"\nSub-topic: {vst.sub_topic_name} (id={vst.sub_topic_id}, has_data=true)")
        if vst.verified_facts:
            lines.append("  Key facts:")
            for fact in vst.verified_facts[:5]:
                lines.append(f"    - {fact.field}: {fact.value}")
            if len(vst.verified_facts) > 5:
                lines.append(f"    ... and {len(vst.verified_facts) - 5} more facts")
        if vst.verified_tables:
            for tbl in vst.verified_tables[:2]:
                cols = ", ".join(tbl.get("columns", []))
                nrows = len(tbl.get("rows", []))
                lines.append(f"  Table: '{tbl.get('title', 'untitled')}' ({cols}) — {nrows} rows")
    return "\n".join(lines)


def _parse_outline(data: dict) -> ArticleOutline:
    sections = []
    for s in data.get("sections", []):
        sections.append(SectionPlan(
            heading=s.get("heading", ""),
            level=int(s.get("level", 2)),
            section_type=s.get("section_type", "mixed"),
            sub_topic_ids=s.get("sub_topic_ids", []),
            word_target=int(s.get("word_target", 750)),
            format_hint=s.get("format_hint", ""),
            content_character_note=s.get("content_character_note", ""),
        ))
    return ArticleOutline(
        h1_title=data.get("h1_title", ""),
        meta_description=data.get("meta_description", ""),
        focus_keyword=data.get("focus_keyword", ""),
        sections=sections,
        faq_questions=data.get("faq_questions", []),
        schema_type=data.get("schema_type", "Article"),
    )
