"""
stage1_blueprint.py — Topic Blueprint (Gemini)

Design philosophy:
  Python pre-classifies the topic and pre-defines the sub-topic STRUCTURE.
  Gemini only fills in data_needed + search_queries for each pre-defined sub-topic.
  The article type can never be wrong because we never ask Gemini to choose it.

Flow:
  1. Python detects content type from topic keywords + explicit content_type arg
  2. Python picks the correct sub-topic skeleton for that type
  3. Gemini fills in: primary_entity, year, data_needed[], search_queries[] per sub-topic
  4. Blueprint saved to checkpoint
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from llm_client import GeminiClient
from models import Blueprint, SubTopic

log = logging.getLogger("atlas.stage1")


# ─── Pre-defined sub-topic skeletons per article type ─────────────────────────
# Structure is set by Python. Gemini only fills data_needed + search_queries.

STRUCTURES: dict[str, list[dict]] = {
    "college_profile": [
        {"id": "college_overview",          "name": "College Overview & Key Facts",         "format": "mixed"},
        {"id": "courses_and_programs",       "name": "Courses & Programs Offered",           "format": "table"},
        {"id": "admission_process",          "name": "Admission Process & Eligibility",      "format": "mixed"},
        {"id": "fees_and_scholarships",      "name": "Fees Structure & Scholarships",        "format": "table"},
        {"id": "placements_summary",         "name": "Placement Highlights",                 "format": "table"},
        {"id": "rankings_and_accreditation", "name": "Rankings & Accreditation",             "format": "mixed"},
        {"id": "campus_and_facilities",      "name": "Campus Life & Facilities",             "format": "prose"},
        {"id": "how_to_apply",               "name": "How to Apply — Steps & Deadlines",     "format": "bullet"},
    ],
    "college_placement": [
        {"id": "overall_stats",       "name": "Overall Placement Statistics",            "format": "table"},
        {"id": "salary_breakdown",    "name": "Salary Breakdown by Package Range",       "format": "table"},
        {"id": "sector_wise",         "name": "Sector-Wise Placement Distribution",      "format": "table"},
        {"id": "top_recruiters",      "name": "Top Recruiting Companies",                "format": "bullet"},
        {"id": "department_wise",     "name": "Department-Wise Placement Statistics",    "format": "table"},
        {"id": "yoy_trend",           "name": "Year-over-Year Placement Trends",         "format": "table"},
        {"id": "ppo_international",   "name": "PPO & International Placements",          "format": "mixed"},
    ],
    "exam_guide": [
        {"id": "exam_overview",          "name": "Exam Overview & Key Facts",            "format": "mixed"},
        {"id": "eligibility",            "name": "Eligibility Criteria",                 "format": "table"},
        {"id": "syllabus",               "name": "Syllabus & Topics",                    "format": "table"},
        {"id": "exam_pattern",           "name": "Exam Pattern & Marking Scheme",        "format": "table"},
        {"id": "preparation_resources",  "name": "Preparation Resources & Books",        "format": "bullet"},
        {"id": "important_dates",        "name": "Important Dates & Schedule",           "format": "table"},
        {"id": "previous_year_analysis", "name": "Previous Year Paper Analysis",         "format": "table"},
    ],
    "ranking_list": [
        {"id": "ranking_overview",      "name": "Ranking Overview & Methodology",        "format": "mixed"},
        {"id": "top_colleges_list",     "name": "Top Colleges in This Ranking",          "format": "table"},
        {"id": "category_rankings",     "name": "Category / Stream-Wise Rankings",       "format": "table"},
        {"id": "yoy_changes",           "name": "Year-over-Year Changes & Movers",       "format": "table"},
        {"id": "ranking_factors",       "name": "Key Factors That Affect Rank",          "format": "prose"},
        {"id": "how_to_use",            "name": "How to Use Rankings for College Choice", "format": "prose"},
    ],
    "fee_reference": [
        {"id": "fee_overview",          "name": "Fee Overview & Total Cost",             "format": "mixed"},
        {"id": "programme_wise_fees",   "name": "Programme-Wise Fee Breakdown",          "format": "table"},
        {"id": "hostel_and_living",     "name": "Hostel & Living Expenses",              "format": "table"},
        {"id": "scholarships",          "name": "Scholarships & Fee Waivers",            "format": "table"},
        {"id": "fee_payment",           "name": "Fee Payment Schedule & Process",        "format": "mixed"},
        {"id": "peer_comparison",       "name": "Fee Comparison with Similar Colleges",  "format": "table"},
    ],
    "admission_guide": [
        {"id": "admission_overview",    "name": "Admission Overview",                    "format": "mixed"},
        {"id": "eligibility_criteria",  "name": "Eligibility Criteria",                  "format": "table"},
        {"id": "entrance_exams",        "name": "Accepted Entrance Exams & Cutoffs",     "format": "table"},
        {"id": "selection_process",     "name": "Selection Process & Rounds",            "format": "mixed"},
        {"id": "cutoff_trends",         "name": "Historical Cutoff Trends",              "format": "table"},
        {"id": "application_steps",     "name": "How to Apply — Step by Step",           "format": "bullet"},
        {"id": "important_dates",       "name": "Important Dates & Deadlines",           "format": "table"},
    ],
    "career_guide": [
        {"id": "career_overview",       "name": "Career Overview & Scope",               "format": "prose"},
        {"id": "skills_required",       "name": "Skills & Qualifications Required",      "format": "bullet"},
        {"id": "job_roles",             "name": "Top Job Roles & Responsibilities",      "format": "table"},
        {"id": "salary_expectations",   "name": "Salary Expectations by Level",          "format": "table"},
        {"id": "top_employers",         "name": "Top Employers & Sectors",               "format": "bullet"},
        {"id": "career_path",           "name": "Career Progression Path",               "format": "mixed"},
        {"id": "how_to_enter",          "name": "How to Enter This Field",               "format": "bullet"},
    ],
}

# Fallback for unknown types
STRUCTURES["general"] = STRUCTURES["college_profile"]


# ─── Topic classifier ─────────────────────────────────────────────────────────

def classify_topic(topic: str, content_type: str) -> str:
    """
    Determine article type from explicit content_type or topic keywords.
    Explicit content_type always wins. Keyword detection is the fallback.
    None / empty string → auto-detect from topic.
    """
    # Map short aliases from CLI to full type names
    _ALIASES = {
        "exam":    "exam_guide",
        "ranking": "ranking_list",
        "career":  "career_guide",
    }
    if content_type:
        content_type = _ALIASES.get(content_type, content_type)
    # Explicit override always wins
    if content_type and content_type in STRUCTURES:
        return content_type

    t = topic.lower()

    # Exam detection first — most specific
    exam_names = ["jee", "neet", "cuet", "cat", "mat", "gmat", "gre", "upsc", "gate",
                  "clat", "xat", "snap", "nmat", "cmat", "iift", "tissnet", "set"]
    exam_keywords = ["syllabus", "exam pattern", "eligibility", "admit card", "result",
                     "cutoff score", "mock test", "question paper"]
    if content_type == "exam_guide" or any(e in t for e in exam_names) or any(k in t for k in exam_keywords):
        return "exam_guide"

    # Placement
    if any(k in t for k in ["placement", "salary", "package", "recruiter", "lpa", "ctc",
                             "campus placement", "hiring", "offer letter"]):
        return "college_placement"

    # Fees
    if any(k in t for k in ["fee", "fees", "tuition", "cost of", "scholarship"]):
        return "fee_reference"

    # Ranking
    if any(k in t for k in ["ranking", "rankings", "nirf", "best college", "top college",
                             "top university", "qs ranking", "times ranking"]):
        return "ranking_list"

    # Admission / cutoff
    if any(k in t for k in ["admission", "cutoff", "cut-off", "eligibility", "apply to",
                             "how to get into", "selection", "merit list"]):
        return "admission_guide"

    # Career
    if any(k in t for k in ["career", "scope of", "jobs after", "salary after",
                             "career in", "career as", "future of"]):
        return "career_guide"

    # College / university name → general overview
    college_markers = ["university", "college", "institute", "institution", "iit ", "iim ",
                       "nit ", "bits", "vit ", "amity", "manipal", "lpu", "srm", "mu ",
                       "du ", "bhu", "nlu", "aiims", "school of"]
    if any(k in t for k in college_markers):
        return "college_profile"

    return "college_profile"  # safe default for ambiguous topics


# ─── Prompt to fill data_needed + search_queries ──────────────────────────────

FILL_PROMPT = """\
You are a research strategist. We are writing a data-driven article about:
  Topic: {topic}
  Article type: {article_type}
  Primary entity: {primary_entity}
  Year focus: {year}

The article structure is FIXED. Your job is to fill in research details for each section.

For EACH section below, return:
  - "data_needed": list of 4-8 specific data field names to extract (e.g. "avg_package_lpa", not "salary info")
  - "search_queries": list of 3 targeted search queries that will find official/verified data for this section
    - Always include the primary entity name in every query
    - Use site: operators for official sources (e.g. site:iima.ac.in, site:nta.ac.in, filetype:pdf)
    - Include the year where relevant

Sections to fill:
{sections_json}

Return a JSON array (same order as input) where each item has:
  {{"id": "...", "data_needed": [...], "search_queries": [...]}}

Rules:
- data_needed must be SPECIFIC field names, not categories (BAD: "placement info", GOOD: "avg_package_lpa", "placement_rate_pct")
- search_queries must be targeted enough to find a specific page or PDF, not broad searches
- For official Indian education sources use: site:nta.ac.in, site:iima.ac.in, site:nirfindia.org, site:josaa.nic.in, or filetype:pdf
- Never invent data — search_queries must be able to find REAL sources
"""

ENTITY_PROMPT = """\
Identify the primary entity and year for this topic. Return JSON only.

Topic: {topic}
Article type: {article_type}

Return:
{{
  "primary_entity": "exact canonical name of the main subject",
  "entity_type": one of ["business_school", "iit", "nit", "college", "university", "exam", "ranking", "career"],
  "year": "year string like '2025' or '2024-25' if mentioned or implied, else null",
  "content_character_hint": one of ["data-heavy", "comparison", "narrative", "timeline", "faq-first"]
}}
"""


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(topic: str, content_type: str, run_dir: Path) -> Blueprint:
    checkpoint = run_dir / "blueprint.json"

    if checkpoint.exists():
        log.info("Stage 1: loading from checkpoint")
        data = json.loads(checkpoint.read_text(encoding="utf-8"))
        return _parse_blueprint(topic, data)

    # Step 1 — classify topic in Python (never Gemini's job)
    article_type = classify_topic(topic, content_type)
    skeleton = STRUCTURES[article_type]
    log.info(f"Stage 1: classified '{topic}' → type='{article_type}', {len(skeleton)} sections")

    client = GeminiClient()

    # Step 2 — identify entity + year (tiny, reliable call)
    entity_raw = client.generate_json(
        ENTITY_PROMPT.format(topic=topic, article_type=article_type),
        temperature=0.1,
    )
    primary_entity = entity_raw.get("primary_entity") or topic
    year = entity_raw.get("year") or "2026"  # default to current year when not specified in topic
    entity_type = entity_raw.get("entity_type", "college")
    character_hint = entity_raw.get("content_character_hint", "data-heavy")
    log.info(f"Stage 1: entity='{primary_entity}', year={year}")

    # Step 3 — fill data_needed + search_queries for each pre-defined section
    sections_json = json.dumps(
        [{"id": s["id"], "name": s["name"]} for s in skeleton],
        ensure_ascii=False, indent=2
    )
    fill_raw = client.generate_json(
        FILL_PROMPT.format(
            topic=topic,
            article_type=article_type,
            primary_entity=primary_entity,
            year=year or "latest available",
            sections_json=sections_json,
        ),
        temperature=0.2,
    )

    # fill_raw should be a list; map by id for safety
    filled: dict[str, dict] = {}
    if isinstance(fill_raw, list):
        for item in fill_raw:
            if isinstance(item, dict) and "id" in item:
                filled[item["id"]] = item
    elif isinstance(fill_raw, dict):
        # Gemini sometimes wraps in {"sections": [...]}
        items = fill_raw.get("sections") or fill_raw.get("sub_topics") or list(fill_raw.values())
        for item in items:
            if isinstance(item, dict) and "id" in item:
                filled[item["id"]] = item

    # Step 4 — merge skeleton + filled data into final sub-topics
    sub_topics_raw = []
    for s in skeleton:
        f = filled.get(s["id"], {})
        sub_topics_raw.append({
            "id": s["id"],
            "name": s["name"],
            "format": s["format"],
            "data_needed": f.get("data_needed") or [s["id"].replace("_", " ")],
            "search_queries": f.get("search_queries") or [f"{primary_entity} {s['name']}"],
        })

    raw = {
        "primary_entity": primary_entity,
        "entity_type": entity_type,
        "article_type": article_type,
        "year": year,
        "content_character_hint": character_hint,
        "sub_topics": sub_topics_raw,
    }

    checkpoint.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info(f"Stage 1: blueprint saved → {len(sub_topics_raw)} sub-topics")

    return _parse_blueprint(topic, raw)


def _parse_blueprint(topic: str, data: dict) -> Blueprint:
    sub_topics = []
    for st in data.get("sub_topics", []):
        sub_topics.append(SubTopic(
            id=st.get("id", "unknown"),
            name=st.get("name", ""),
            data_needed=st.get("data_needed", []),
            format=st.get("format", "mixed"),
            search_queries=st.get("search_queries", []),
        ))

    return Blueprint(
        topic=topic,
        primary_entity=data.get("primary_entity", ""),
        entity_type=data.get("entity_type", "college"),
        article_type=data.get("article_type", "college_profile"),
        year=data.get("year"),
        sub_topics=sub_topics,
        content_character_hint=data.get("content_character_hint", "data-heavy"),
    )
