"""
models.py — All dataclasses for the ATLAS pipeline.

Data flows top-down:
  Blueprint → Sources → FetchedPages → Extractions → VerifiedData → Outline → Sections → Article
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


# ─── Stage 1: Topic Blueprint ─────────────────────────────────────────────────

@dataclass
class SubTopic:
    id: str                        # slug, e.g. "overall_placements", "sector_wise"
    name: str                      # human label, e.g. "Overall Placement Stats 2024"
    data_needed: list[str]         # field names to extract, e.g. ["avg_package", "median_package"]
    format: str                    # "table" | "bullet" | "prose" | "mixed"
    search_queries: list[str]      # DDG queries specific to this sub-topic


@dataclass
class Blueprint:
    topic: str
    primary_entity: str            # e.g. "IIM Ahmedabad", "CUET UG 2026"
    entity_type: str               # "business_school" | "iit" | "exam" | "ranking" | "career" | "college"
    article_type: str              # "college_profile" | "college_placement" | "exam_guide" | etc.
    year: Optional[str]            # e.g. "2024", "2026" — None if not in topic
    sub_topics: list[SubTopic]
    content_character_hint: str    # initial guess: "data-heavy" | "comparison" | "narrative"


# ─── Stage 2: Article Character ───────────────────────────────────────────────

@dataclass
class ArticleCharacter:
    top_urls: list[str]            # competitor URLs fetched
    section_order: list[str]       # sections that top articles use, in order
    content_character: str         # "data-heavy" | "narrative" | "comparison" | "timeline" | "faq-first"
    avg_section_count: int
    notes: str                     # any standout structural patterns Gemini noticed


# ─── Stage 3: Sources ─────────────────────────────────────────────────────────

@dataclass
class SourceList:
    # sub_topic_id → list of candidate URLs (deduped across sub-topics)
    by_sub_topic: dict[str, list[str]] = field(default_factory=dict)
    # flat deduped URL list for fetching
    all_urls: list[str] = field(default_factory=list)


# ─── Stage 4: Fetched Pages ───────────────────────────────────────────────────

@dataclass
class FetchedPage:
    url: str
    html: str
    clean_text: str                # main content, nav/footer stripped
    title: str
    fetched_via: str               # "direct" | "brightdata" | "cached"
    entity_validated: bool         # True if primary_entity name found in clean_text
    error: str = ""


# ─── Stage 5: Sub-topic Extraction ───────────────────────────────────────────

@dataclass
class SubTopicExtraction:
    sub_topic_id: str
    source_urls: list[str]         # which pages were used
    data: dict                     # field_name → value or list of row dicts
    raw_tables: list[dict]         # any tables Gemini found verbatim
    extraction_notes: str          # anything Gemini flagged


# ─── Stage 6: Verified Data ───────────────────────────────────────────────────

@dataclass
class VerifiedFact:
    field: str
    value: str                     # string representation of the value
    verified: bool                 # True = found in source text; False = could not confirm
    source_url: str
    source_snippet: str            # short excerpt from source that contains this fact


@dataclass
class VerifiedSubTopic:
    sub_topic_id: str
    sub_topic_name: str
    verified_facts: list[VerifiedFact]
    verified_tables: list[dict]    # full rows that passed verification
    has_data: bool                 # False = no verified facts → section will be dropped


# ─── Stage 7: Article Outline ─────────────────────────────────────────────────

@dataclass
class SectionPlan:
    heading: str                   # H2 or H3 heading (must contain a specific fact)
    level: int                     # 2 = H2, 3 = H3
    section_type: str              # "table" | "prose" | "mixed" | "faq"
    sub_topic_ids: list[str]       # which verified sub-topics to draw from
    word_target: int               # 700–900 per section
    format_hint: str               # e.g. "lead with paragraph, then table, close with insight"
    content_character_note: str    # how character.json shapes this section


@dataclass
class ArticleOutline:
    h1_title: str
    meta_description: str          # 150–160 chars
    focus_keyword: str
    sections: list[SectionPlan]
    faq_questions: list[str]       # derived from actual reader intent
    schema_type: str               # "Article" | "FAQPage" | "Course"


# ─── Stage 8 / 9: Written Sections ───────────────────────────────────────────

@dataclass
class WrittenSection:
    heading: str
    level: int
    html: str                      # full section HTML (tables + prose)
    word_count: int
    humanized: bool = False        # flipped to True after Stage 9 pass


# ─── Stage 10: Coherence Report ───────────────────────────────────────────────

@dataclass
class CoherenceIssue:
    severity: str                  # "minor" | "major"
    section_heading: str
    description: str
    auto_patched: bool = False


@dataclass
class CoherenceReport:
    passed: bool
    issues: list[CoherenceIssue]
    patch_notes: str               # what was auto-fixed
    major_issues_for_review: list[str]  # human review needed for these
