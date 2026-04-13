"""
stage2_character.py — Article Character Research (Gemini + DDG + BrightData)

Input:  Blueprint (topic + primary_entity)
Output: ArticleCharacter dataclass + character.json checkpoint

What happens:
  1. DDG search: find 3-5 top-ranking articles on the same topic
  2. Priority: Collegedunia, Shiksha, Careers360 pages fetched first
     (these mirror what Indian students see and expect)
  3. BrightData/direct: fetch their HTML
  4. Gemini analyses: section order, data depth, content character
     (data-heavy / narrative / comparison / timeline / faq-first)

Why this matters:
  An IIM placement article is structured differently from a syllabus article.
  Character research ensures our article mirrors what already ranks — we don't
  impose a generic template on every topic.

  Education portals (Collegedunia, Shiksha, Careers360) are prioritised because:
  - They define the structural pattern Indian students expect
  - They have the best data organisation for Indian education topics
  - Our article should match their structure but with better/more complete data
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from fetcher import PageFetcher
from llm_client import GeminiClient
from models import ArticleCharacter, Blueprint

log = logging.getLogger("atlas.stage2")

DDG_SEARCH_URL = "https://lite.duckduckgo.com/lite/"

CHARACTER_PROMPT = """\
You are analysing the top-ranking articles about: "{topic}"

Here are excerpts from {n} top articles I fetched:

{excerpts}

Analyse these articles and return a JSON object:
{{
  "section_order": ["list of section headings in the typical order they appear"],
  "content_character": one of ["data-heavy", "narrative", "comparison", "timeline", "faq-first"],
  "avg_section_count": number,
  "notes": "any standout patterns: do they lead with a data table? use year-vs-year columns? have a salary breakdown by function? what data tables are most prominent?"
}}

Rules for content_character:
- "data-heavy": most sections are tables with numbers (placement stats, ranking tables, fee tables)
- "comparison": article compares multiple entities side-by-side in the same table
- "narrative": mostly prose, few tables, story-driven
- "timeline": organised by year or chronological progression
- "faq-first": article opens with a FAQ block before detailed content

Focus on:
1. What sections do the top-ranking articles include?
2. What data tables do they use? (e.g. "placement stats by year", "top recruiters table", "salary range table")
3. What is the section ORDER they follow?
4. What data points are readers clearly searching for (based on what all articles cover)?

Our article should follow the SAME structure but with more complete and accurate data.
"""


def _ddg_search(query: str, max_results: int = 6) -> list[str]:
    """Search DuckDuckGo Lite, return list of URLs."""
    try:
        resp = requests.post(
            DDG_SEARCH_URL,
            data={"q": query, "kl": "in-en"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        urls = []
        for a in soup.select("a.result-link"):
            href = a.get("href", "")
            if href.startswith("http") and "duckduckgo.com" not in href:
                urls.append(href)
            if len(urls) >= max_results:
                break
        return urls
    except Exception as e:
        log.warning(f"DDG search failed: {e}")
        return []


def _is_competitor_url(url: str) -> bool:
    """Filter out known low-quality / aggregator sites."""
    skip_domains = {
        "quora.com", "reddit.com", "youtube.com", "facebook.com",
        "twitter.com", "linkedin.com", "wikipedia.org", "amazon.com",
        "flipkart.com", "snapdeal.com",
    }
    domain = urlparse(url).netloc.lower().lstrip("www.")
    return domain not in skip_domains


def run(blueprint: Blueprint, run_dir: Path) -> ArticleCharacter:
    """
    Run Stage 2. Returns ArticleCharacter and saves character.json to run_dir.
    Loads from checkpoint if already exists.
    """
    checkpoint = run_dir / "character.json"

    if checkpoint.exists():
        log.info("Stage 2: loading from checkpoint")
        data = json.loads(checkpoint.read_text(encoding="utf-8"))
        return ArticleCharacter(
            top_urls=data.get("top_urls", []),
            section_order=data.get("section_order", []),
            content_character=data.get("content_character", "data-heavy"),
            avg_section_count=data.get("avg_section_count", 6),
            notes=data.get("notes", ""),
        )

    log.info(f"Stage 2: researching article character for '{blueprint.topic}'")

    # ── Broad DDG search — let the search engine surface the best pages ───────
    # No domain filtering here. Whatever ranks for this topic IS the reference.
    query = blueprint.topic
    if blueprint.year:
        query = f"{blueprint.topic} {blueprint.year}"

    urls = _ddg_search(query, max_results=10)
    urls = [u for u in urls if _is_competitor_url(u)][:6]

    if not urls:
        log.warning("Stage 2: no competitor URLs found — using default character")
        character = _default_character(blueprint)
        _save(checkpoint, character, [])
        return character

    log.info(f"Stage 2: fetching {len(urls)} reference articles")

    fetcher = PageFetcher(primary_entity="")
    pages = fetcher.fetch_many(urls, delay=1.5)
    valid_pages = [p for p in pages if not p.error and len(p.clean_text) > 500]

    if not valid_pages:
        log.warning("Stage 2: all competitor fetches failed — using default character")
        character = _default_character(blueprint)
        _save(checkpoint, character, urls)
        return character

    # Build excerpts — 1000 chars per page to capture section structure
    excerpts = []
    for i, page in enumerate(valid_pages[:5]):
        excerpt = page.clean_text[:1000].replace("\n", " ")
        excerpts.append(f"--- Article {i+1}: {page.title} ({page.url}) ---\n{excerpt}")

    excerpts_text = "\n\n".join(excerpts).replace("{", "{{").replace("}", "}}")
    prompt = CHARACTER_PROMPT.format(
        topic=blueprint.topic,
        n=len(valid_pages),
        excerpts=excerpts_text,
    )

    client = GeminiClient()
    try:
        result = client.generate_json(prompt, temperature=0.1)
    except Exception as e:
        log.warning(f"Stage 2: Gemini analysis failed ({e}) — using default character")
        character = _default_character(blueprint)
        _save(checkpoint, character, urls)
        return character

    character = ArticleCharacter(
        top_urls=urls,
        section_order=result.get("section_order", []),
        content_character=result.get("content_character", "data-heavy"),
        avg_section_count=int(result.get("avg_section_count", 6)),
        notes=result.get("notes", ""),
    )
    _save(checkpoint, character, urls)
    log.info(f"Stage 2: character = '{character.content_character}', {character.avg_section_count} sections")
    log.info(f"Stage 2: section order = {character.section_order}")
    return character


def _default_character(blueprint: Blueprint) -> ArticleCharacter:
    """Return a sensible default based on entity_type if Gemini/DDG fails."""
    defaults = {
        "business_school": ("data-heavy", ["Overview", "Placement Stats", "Salary Breakdown",
                                            "Sector-wise", "Top Recruiters", "Department-wise", "FAQs"]),
        "iit": ("data-heavy", ["Overview", "Placement Stats", "Salary Data",
                                "Top Recruiters", "Branch-wise", "Year-on-Year", "FAQs"]),
        "exam": ("faq-first", ["Overview", "Eligibility", "Syllabus", "Exam Pattern",
                                "Preparation Tips", "Important Dates", "FAQs"]),
        "ranking": ("comparison", ["Methodology", "Top 10 List", "Category Rankings",
                                   "Year-on-Year Changes", "Notable Movers"]),
    }
    char, sections = defaults.get(blueprint.entity_type, ("data-heavy", ["Overview", "Details", "FAQs"]))
    return ArticleCharacter(
        top_urls=[],
        section_order=sections,
        content_character=char,
        avg_section_count=len(sections),
        notes="Default character (DDG/Gemini unavailable)",
    )


def _save(checkpoint: Path, character: ArticleCharacter, top_urls: list[str]) -> None:
    data = {
        "top_urls": top_urls or character.top_urls,
        "section_order": character.section_order,
        "content_character": character.content_character,
        "avg_section_count": character.avg_section_count,
        "notes": character.notes,
    }
    checkpoint.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
