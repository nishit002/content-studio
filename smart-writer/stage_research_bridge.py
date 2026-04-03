"""
stage_research_bridge.py — Replace ATLAS Stages 3-4-5-6 with content-generator research.

Instead of DDG search → BrightData fetch → Gemini extract → Gemini verify,
this calls content-generator's You.com researcher + Gemini indexer and maps
the resulting research_index.json directly to VerifiedSubTopic objects.

Why this is better for Indian education content:
  - You.com returns higher-quality snippets than DDG for this domain
  - Researcher has official-site targeting (nta.ac.in, nirfindia.org, josaa.nic.in)
  - Researcher automatically fetches PDFs (information bulletins, placement reports)
  - ResearchIndexer uses proven prompts with sanity checks (impossible scores blocked)
  - Output is already structured — no need for a separate verify pass

Usage:
  from stage_research_bridge import run as run_bridge
  verified_list, source_urls = run_bridge(blueprint, run_dir)

Saves checkpoints:
  run_dir/research_index.json  — raw CG index (for debugging)
  run_dir/sources.json         — source URLs (passed to Stage 10 for citations)
  run_dir/verified_data.json   — VerifiedSubTopic list (Stage 6 checkpoint format)
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

from models import Blueprint, VerifiedFact, VerifiedSubTopic

log = logging.getLogger("atlas.bridge")

# ── ATLAS entity_type → content-generator (content_type, primary_intent) ──────
_TYPE_MAP: dict[str, tuple[str, str]] = {
    "college_placement": ("college_profile", "placement"),
    "exam":              ("exam_guide",       "exam_info"),
    "ranking":           ("ranking_list",     "ranking"),
    "college_profile":   ("college_profile",  "general"),
    "career":            ("career_guide",     "career_scope"),
}
_DEFAULT_TYPE = ("college_profile", "general")


# ── research_index category keywords → sub_topic id/name keywords ─────────────
# Each entry: keyword that appears in sub_topic.id or sub_topic.name → CG categories
_KEYWORD_TO_CATS: list[tuple[tuple[str, ...], list[str]]] = [
    (("placement", "recruit", "hire", "offer"),        ["placements", "salaries"]),
    (("salary", "package", "ctc", "lpa"),              ["salaries", "placements"]),
    (("fee", "cost", "tuition", "hostel"),             ["fees", "scholarships"]),
    (("rank", "nirf", "qs", "ranking"),                ["rankings"]),
    (("cutoff", "opening", "closing", "rank_cutoff"),  ["cutoffs", "cutoff_scores"]),
    (("admission", "eligib", "counsell", "apply"),     ["admission", "cutoffs"]),
    (("course", "program", "branch", "speciali"),      ["courses"]),
    (("alumni", "notable", "famous"),                  ["alumni"]),
    (("campus", "infra", "hostel", "facilit"),         ["infrastructure"]),
    (("exam", "paper", "section", "pattern", "mark"),  ["exam_sections"]),
    (("syllabus", "unit", "topic", "chapter"),         ["exam_sections", "books_resources"]),
    (("book", "resource", "material", "ncert"),        ["books_resources"]),
    (("career", "job", "role", "scope"),               ["career_paths", "salaries"]),
    (("stat", "fact", "overview", "general"),          ["statistics", "colleges"]),
    (("college", "university", "institute"),           ["colleges", "rankings"]),
]

# Catch-all: if a sub_topic matches nothing, include these
_FALLBACK_CATS = ["colleges", "placements", "fees", "rankings", "admission",
                  "exam_sections", "courses", "statistics"]


def _cats_for_subtopic(sub_topic_id: str, sub_topic_name: str) -> list[str]:
    """Pick the research_index categories relevant to a sub-topic."""
    key_text = f"{sub_topic_id} {sub_topic_name}".lower()
    cats: list[str] = []
    for keywords, categories in _KEYWORD_TO_CATS:
        if any(kw in key_text for kw in keywords):
            for cat in categories:
                if cat not in cats:
                    cats.append(cat)
    return cats if cats else _FALLBACK_CATS


def _items_to_facts(items: list[dict], category: str) -> list[VerifiedFact]:
    """Flatten a list of research_index dicts into VerifiedFact objects."""
    facts: list[VerifiedFact] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        for field, value in item.items():
            if value is None or value == "" or value == [] or value == {}:
                continue
            facts.append(VerifiedFact(
                field=f"{category}.{field}",
                value=str(value),
                verified=True,   # came from You.com research, not LLM memory
                source_url="",   # CG research blends many URLs; no per-fact tracking
                source_snippet=f"[content-generator/{category}]",
            ))
    return facts


def _items_to_table(items: list[dict], category: str) -> dict | None:
    """Convert a list of research_index dicts to a verified_table entry."""
    if not items or not isinstance(items[0], dict):
        return None
    # Collect all column names from all rows (union)
    cols_seen: dict[str, None] = {}
    for item in items:
        for k in item.keys():
            cols_seen[k] = None
    columns = list(cols_seen.keys())
    rows = [[str(item.get(col, "")) for col in columns] for item in items]
    # Filter out completely empty rows
    rows = [r for r in rows if any(cell.strip() for cell in r)]
    if not rows:
        return None
    return {
        "title": category.replace("_", " ").title(),
        "columns": columns,
        "rows": rows,
    }


def _map_index_to_verified(
    blueprint: Blueprint,
    research_index: dict,
) -> list[VerifiedSubTopic]:
    """Map research_index categories → VerifiedSubTopic per blueprint sub_topic."""
    results: list[VerifiedSubTopic] = []

    for st in blueprint.sub_topics:
        cats = _cats_for_subtopic(st.id, st.name)

        all_facts: list[VerifiedFact] = []
        all_tables: list[dict] = []

        for cat in cats:
            items = research_index.get(cat, [])
            if not items:
                continue
            all_facts.extend(_items_to_facts(items, cat))
            tbl = _items_to_table(items, cat)
            if tbl:
                all_tables.append(tbl)

        has_data = bool(all_facts or all_tables)
        results.append(VerifiedSubTopic(
            sub_topic_id=st.id,
            sub_topic_name=st.name,
            verified_facts=all_facts,
            verified_tables=all_tables,
            has_data=has_data,
        ))

        log.info("  bridge [%s]: %d facts, %d tables, has_data=%s",
                 st.id, len(all_facts), len(all_tables), has_data)

    return results


def _serialise_vst(vst: VerifiedSubTopic) -> dict:
    return {
        "sub_topic_id": vst.sub_topic_id,
        "sub_topic_name": vst.sub_topic_name,
        "verified_facts": [
            {
                "field": f.field,
                "value": f.value,
                "verified": f.verified,
                "source_url": f.source_url,
                "source_snippet": f.source_snippet,
            }
            for f in vst.verified_facts
        ],
        "verified_tables": vst.verified_tables,
        "has_data": vst.has_data,
    }


def run(blueprint: Blueprint, run_dir: Path) -> tuple[list[VerifiedSubTopic], list[str]]:
    """
    Run the research bridge.

    Returns:
        verified_list: list[VerifiedSubTopic] (same as Stage 6 output)
        source_urls:   list[str] (source URLs from You.com, for Stage 10 citations)

    Saves checkpoints:
        run_dir/research_index.json
        run_dir/sources.json
        run_dir/verified_data.json
    """
    verified_checkpoint = run_dir / "verified_data.json"

    # ── Load from checkpoint if already done ──────────────────────────────────
    if verified_checkpoint.exists() and (run_dir / "research_index.json").exists():
        log.info("Bridge: loading from checkpoint")
        raw = json.loads(verified_checkpoint.read_text(encoding="utf-8"))
        verified = []
        for item in raw:
            facts = [
                VerifiedFact(
                    field=f["field"], value=f["value"], verified=f["verified"],
                    source_url=f.get("source_url", ""),
                    source_snippet=f.get("source_snippet", ""),
                )
                for f in item.get("verified_facts", [])
            ]
            verified.append(VerifiedSubTopic(
                sub_topic_id=item["sub_topic_id"],
                sub_topic_name=item.get("sub_topic_name", ""),
                verified_facts=facts,
                verified_tables=item.get("verified_tables", []),
                has_data=item.get("has_data", False),
            ))
        # Load source URLs
        sources_path = run_dir / "sources.json"
        source_urls: list[str] = []
        if sources_path.exists():
            source_urls = json.loads(sources_path.read_text(encoding="utf-8"))
        return verified, source_urls

    # ── Map ATLAS entity_type → CG content_type + intent ──────────────────────
    cg_content_type, cg_intent = _TYPE_MAP.get(blueprint.entity_type, _DEFAULT_TYPE)
    log.info("Bridge: entity_type=%s → CG(%s, %s)", blueprint.entity_type, cg_content_type, cg_intent)

    # ── Call cg_runner.py via subprocess ──────────────────────────────────────
    runner_script = Path(__file__).parent / "cg_runner.py"
    cmd = [
        sys.executable, str(runner_script),
        "--topic",        blueprint.topic,
        "--content-type", cg_content_type,
        "--intent",       cg_intent,
        "--output-dir",   str(run_dir),
    ]

    log.info("Bridge: launching cg_runner — %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        log.error("cg_runner failed (exit %d):\n%s", result.returncode, result.stderr[-2000:])
        raise RuntimeError(
            f"cg_runner.py failed with exit code {result.returncode}. "
            "Check YOU_API_KEYS and GEMINI_API_KEY in .env. "
            f"stderr tail: {result.stderr[-500:]}"
        )

    # Parse stdout summary
    stdout_lines = result.stdout.strip().splitlines()
    summary_line = next((l for l in reversed(stdout_lines) if l.startswith("{")), None)
    if summary_line:
        try:
            summary = json.loads(summary_line)
            log.info("Bridge: cg_runner result — %s snippets, categories: %s",
                     summary.get("snippets", "?"), summary.get("categories", []))
        except json.JSONDecodeError:
            pass

    # ── Read research_index.json ───────────────────────────────────────────────
    index_path = run_dir / "research_index.json"
    if not index_path.exists():
        raise RuntimeError(
            "cg_runner.py succeeded but research_index.json was not created. "
            f"Check output at {run_dir}"
        )

    research_index = json.loads(index_path.read_text(encoding="utf-8"))
    log.info("Bridge: loaded research_index — categories with data: %s",
             [k for k, v in research_index.items() if isinstance(v, list) and v])

    # ── Read research.json for source URLs ────────────────────────────────────
    source_urls = []
    research_path = run_dir / "research.json"
    if research_path.exists():
        research_data = json.loads(research_path.read_text(encoding="utf-8"))
        source_urls = [s["url"] for s in research_data.get("sources", []) if s.get("url")]

    # Save sources.json (Stage 10 uses this for citations)
    (run_dir / "sources.json").write_text(
        json.dumps(source_urls, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Bridge: %d source URLs saved to sources.json", len(source_urls))

    # ── Map research_index → VerifiedSubTopic ─────────────────────────────────
    log.info("Bridge: mapping research_index → VerifiedSubTopic for %d sub-topics",
             len(blueprint.sub_topics))
    verified = _map_index_to_verified(blueprint, research_index)

    with_data = sum(1 for v in verified if v.has_data)
    log.info("Bridge: %d/%d sub-topics have data", with_data, len(verified))

    # ── Save verified_data.json checkpoint (Stage 6 format) ───────────────────
    verified_checkpoint.write_text(
        json.dumps([_serialise_vst(v) for v in verified], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Bridge: verified_data.json saved")

    return verified, source_urls
