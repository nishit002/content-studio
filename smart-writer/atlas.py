#!/usr/bin/env python3
"""
atlas.py — ATLAS Pipeline Orchestrator
=======================================

ATLAS = Adaptive Topic-Led Article System

An 11-stage, data-first content pipeline that eliminates hallucination by:
  1. Building a topic blueprint BEFORE fetching anything
  2. Entity-validating every fetched page (drops wrong institution pages)
  3. Verifying every extracted fact against source text
  4. Letting writers see ONLY verified data — no memory access

USAGE:
  python atlas.py "IIM Ahmedabad Placements 2024"
  python atlas.py "CUET UG 2026 Mathematics Syllabus" --type exam
  python atlas.py "Top MBA Colleges India NIRF 2024" --type ranking
  python atlas.py --list
  python atlas.py "IIM Ahmedabad Placements 2024" --resume 3
  python atlas.py "IIM Ahmedabad Placements 2024" --force
  python atlas.py "CUET UG 2026 Maths Syllabus" --type exam --use-cg-research

CONTENT TYPES:
  college_placement  (default for IIT/IIM placement queries)
  exam               (for exam syllabus / pattern / overview)
  ranking            (for NIRF / QS ranking articles)
  college_profile    (for general college overview articles)
  career             (for career/course overview articles)

SETUP (.env file in this directory):
  GEMINI_API_KEY=your-key
  BRIGHT_DATA_KEY=your-key          (optional but recommended)
  BRIGHT_DATA_ZONE=web_unlocker1
  LM_STUDIO_URL=http://localhost:1234/v1
  LM_STUDIO_MODEL=meta-llama-3.1-8b-instruct

STAGES:
  1  Topic Blueprint    — Gemini builds sub-topic tree
  2  Character Research — DDG + Gemini analyses top articles
  3  Source Discovery   — Per sub-topic DDG search for official URLs
  4  Targeted Fetch     — HTTP/BrightData with entity validation
  5  Extraction         — Gemini extracts per sub-topic
  6  Verification       — Gemini verifies each fact against source
  7  Outline            — Gemini creates data-driven section plan
  8  Writing            — Llama writes each section (verified data only)
  9  Humanization       — Llama second pass on prose
  10 Coherence          — Gemini checks full draft, auto-patches, assembles
  11 Proofread          — Gemini fixes spelling, garbled chars, grammar (prose only)

RESEARCH BRIDGE MODE (--use-cg-research):
  Replaces Stages 3-4-5-6 with content-generator's You.com pipeline.
  Stages 1-2 and 7-10 are unchanged.
  Better for Indian education content — uses proven You.com + official PDF pipeline.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("atlas")

OUTPUT_DIR = Path("output")
RUNS_FILE  = OUTPUT_DIR / "runs.json"
OUTPUT_DIR.mkdir(exist_ok=True)


# ─── Run Management ───────────────────────────────────────────────────────────

def _load_runs() -> dict:
    if RUNS_FILE.exists():
        return json.loads(RUNS_FILE.read_text(encoding="utf-8"))
    return {}


def _save_runs(runs: dict) -> None:
    RUNS_FILE.write_text(json.dumps(runs, ensure_ascii=False, indent=2), encoding="utf-8")


def _next_run_id(runs: dict) -> str:
    if not runs:
        return "001"
    max_id = max(int(k) for k in runs.keys())
    return f"{max_id + 1:03d}"


def _update_run(run_id: str, **fields) -> None:
    runs = _load_runs()
    if run_id not in runs:
        runs[run_id] = {}
    runs[run_id].update(fields)
    _save_runs(runs)


def _slug(topic: str) -> str:
    """URL-safe slug from topic string."""
    import re
    s = topic.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s[:50].strip("-")


def list_runs() -> None:
    runs = _load_runs()
    if not runs:
        print("No runs yet.")
        return
    print(f"\n{'ID':<6} {'Status':<10} {'Type':<18} {'Date':<18} Topic")
    print("-" * 80)
    for run_id in sorted(runs.keys()):
        r = runs[run_id]
        status = r.get("status", "?")
        icon = {"done": "✓", "failed": "✗", "running": "…"}.get(status, "?")
        print(f"{run_id:<6} {icon} {status:<8} {r.get('type',''):<18} "
              f"{r.get('started',''):<18} {r.get('topic','')[:45]}")
    print()


# ─── Stage checkpoint tracking ────────────────────────────────────────────────

STAGE_NAMES = {
    1: "blueprint",
    2: "character",
    3: "sources",
    4: "fetch",
    5: "extract",
    6: "verify",
    7: "outline",
    8: "write",
    9: "humanize",
    10: "coherence",
    11: "proofread",
}


def _stages_done(run_dir: Path) -> set[int]:
    """Return set of stage numbers that have checkpoints on disk."""
    done = set()
    if (run_dir / "blueprint.json").exists():         done.add(1)
    if (run_dir / "character.json").exists():         done.add(2)
    if (run_dir / "sources.json").exists():           done.add(3)
    if (run_dir / "fetched_pages.json").exists():     done.add(4)
    if (run_dir / "extracted").exists() and any((run_dir / "extracted").iterdir()):
        done.add(5)
    if (run_dir / "verified_data.json").exists():     done.add(6)
    if (run_dir / "outline.json").exists():           done.add(7)
    if (run_dir / "sections").exists() and any((run_dir / "sections").iterdir()):
        done.add(8)
    # Stage 9 is detected by checking if any section file has been humanized
    # (we check the coherence report for stage 10)
    if (run_dir / "article.html").exists():           done.add(10)
    return done


# ─── Main pipeline ────────────────────────────────────────────────────────────

def run_pipeline(
    topic: str,
    content_type: str,
    resume_from: int = 1,
    force: bool = False,
    use_cg_research: bool = False,
    use_you_research: bool = False,
) -> None:
    """
    Run the full ATLAS pipeline for a topic.

    resume_from: skip stages < resume_from (if their checkpoints exist)
    force: delete all checkpoints and re-run everything from scratch
    use_cg_research: replace stages 3-6 with content-generator subprocess bridge
    use_you_research: replace stages 3-6 with built-in researcher.py + indexer.py
                      (You.com + trafilatura + markdownify — recommended)
    """
    # Lazy imports — keeps startup fast and errors localised
    import stage1_blueprint
    import stage2_character
    import stage3_sources
    import stage4_fetch
    import stage5_extract
    import stage6_verify
    import stage7_outline
    import stage8_write
    import stage9_humanize
    import stage10_coherence
    import stage11_proofread
    if use_cg_research:
        import stage_research_bridge
    if use_you_research:
        import researcher as you_researcher
        import indexer   as you_indexer

    # Set up run directory
    runs = _load_runs()
    run_id = None

    # Check if there's already a run for this topic
    for rid, r in runs.items():
        if r.get("topic") == topic and r.get("status") != "done":
            run_id = rid
            log.info(f"Resuming existing run {run_id} for: {topic}")
            break

    if run_id is None:
        run_id = _next_run_id(runs)
        log.info(f"Starting new run {run_id} for: {topic}")

    run_dir = OUTPUT_DIR / f"{run_id}-{_slug(topic)}"
    run_dir.mkdir(exist_ok=True)

    if force:
        log.info("--force: clearing all checkpoints")
        _clear_checkpoints(run_dir)

    _update_run(run_id,
                topic=topic,
                type=content_type,
                started=datetime.now().strftime("%Y-%m-%d %H:%M"),
                status="running",
                run_dir=str(run_dir))

    # Signal handler — catches SIGTERM (systemd/kill) so runs.json is always updated.
    # SIGKILL cannot be caught, but this handles the common graceful-shutdown case.
    def _on_signal(signum, frame):
        log.error(f"Run {run_id} killed by signal {signum} — marking as failed")
        _update_run(run_id, status="failed", error=f"Process killed (signal {signum})")
        sys.exit(1)
    signal.signal(signal.SIGTERM, _on_signal)

    done_stages = _stages_done(run_dir)
    log.info(f"Stages already done: {sorted(done_stages) if done_stages else 'none'}")

    try:
        # ── Stage 1: Topic Blueprint ──────────────────────────────────────────
        _log_stage(1, "Topic Blueprint")
        blueprint = stage1_blueprint.run(topic, content_type, run_dir)

        # ── Stage 2: Article Character ────────────────────────────────────────
        _log_stage(2, "Article Character Research")
        character = stage2_character.run(blueprint, run_dir)

        if use_you_research:
            # ── You.com researcher + indexer (recommended) ────────────────────
            _log_stage(3, "You.com Research (trafilatura + markdownify)")
            source_list, pages = you_researcher.run(blueprint, run_dir)
            all_source_urls = source_list.all_urls

            _log_stage(5, "Gemini Indexer (extract + verify, tables preserved)")
            verified = you_indexer.run(blueprint, source_list, pages, run_dir)

            verified_count = sum(1 for v in verified if v.has_data)
            if verified_count == 0:
                raise RuntimeError(
                    "Indexer: no sub-topics have data. "
                    "Check YOU_API_KEYS and GEMINI_API_KEY in .env."
                )
            log.info("Indexer complete: %d/%d sub-topics have data", verified_count, len(verified))

        elif use_cg_research:
            # ── Content-generator bridge (subprocess) ─────────────────────────
            _log_stage(3, "Research Bridge (content-generator subprocess)")
            verified, all_source_urls = stage_research_bridge.run(blueprint, run_dir)

            verified_count = sum(1 for v in verified if v.has_data)
            if verified_count == 0:
                raise RuntimeError(
                    "Research bridge: no sub-topics have data. "
                    "Check YOU_API_KEYS in .env and that the topic is researchable."
                )
            log.info("Bridge complete: %d/%d sub-topics have data", verified_count, len(verified))

        else:
            # ── Stage 3: Source Discovery ─────────────────────────────────────
            _log_stage(3, "Targeted Source Discovery")
            source_list = stage3_sources.run(blueprint, run_dir)

            # ── Stage 4: Fetch + Entity Validation ───────────────────────────
            _log_stage(4, "Targeted Fetch (entity validation)")
            pages = stage4_fetch.run(blueprint, source_list, run_dir)

            if not pages:
                raise RuntimeError(
                    "Stage 4 returned zero validated pages. "
                    "Check that primary_entity matches the actual page content, "
                    "or that BRIGHT_DATA_KEY is set for JS-heavy sites."
                )

            # ── Stage 5: Sub-topic Extraction ─────────────────────────────────
            _log_stage(5, "Sub-topic Extraction")
            extractions = stage5_extract.run(blueprint, source_list, pages, run_dir)

            # ── Stage 6: Data Verification ────────────────────────────────────
            _log_stage(6, "Data Verification")
            verified = stage6_verify.run(blueprint, extractions, pages, run_dir)

            verified_count = sum(1 for v in verified if v.has_data)
            if verified_count == 0:
                raise RuntimeError(
                    "Stage 6: no sub-topics have verified data. "
                    "The source pages may not contain the expected data, "
                    "or entity validation was too strict."
                )
            all_source_urls = source_list.all_urls

        # ── Stage 7: Outline ──────────────────────────────────────────────────
        _log_stage(7, "Article Outline")
        outline = stage7_outline.run(blueprint, character, verified, run_dir)

        # ── Stage 8: Section Writing ──────────────────────────────────────────
        _log_stage(8, "Section Writing")
        sections = stage8_write.run(outline, verified, run_dir)

        if not sections:
            raise RuntimeError("Stage 8: no sections were written. "
                               "All sections may have been dropped due to missing verified data.")

        # ── Stage 9: Humanization ─────────────────────────────────────────────
        _log_stage(9, "Humanization Pass")
        sections = stage9_humanize.run(sections, run_dir)

        # ── Stage 10: Coherence Check + Assembly ─────────────────────────────
        _log_stage(10, "Coherence Check + Final Assembly")
        final_html, report = stage10_coherence.run(
            outline, sections, all_source_urls, run_dir, topic
        )

        # ── Stage 11: Proofread (spelling, grammar, special chars) ───────────
        _log_stage(11, "Proofread — Spelling / Grammar / Special Chars")
        try:
            final_html = stage11_proofread.run(run_dir)
        except Exception as e:
            log.warning("Stage 11 failed (%s) — continuing with unproofread article", e)

        # ── Done ──────────────────────────────────────────────────────────────
        word_count = len(final_html.split()) - 200  # rough subtract HTML boilerplate
        _update_run(run_id,
                    status="done",
                    finished=datetime.now().strftime("%Y-%m-%d %H:%M"),
                    word_count=word_count,
                    coherence_passed=report.passed,
                    major_issues=len(report.major_issues_for_review),
                    article_path=str(run_dir / "article.html"))

        print("\n" + "=" * 60)
        print(f"  ATLAS DONE — Run {run_id}")
        print(f"  Topic:    {topic}")
        print(f"  Sections: {len(sections)}")
        print(f"  Words:    ~{word_count}")
        print(f"  Coherence: {'✓ PASSED' if report.passed else '⚠ NEEDS REVIEW'}")
        if report.major_issues_for_review:
            print(f"  Major issues ({len(report.major_issues_for_review)}):")
            for issue in report.major_issues_for_review:
                print(f"    - {issue[:80]}")
        print(f"  Output:   {run_dir}/article.html")
        print("=" * 60 + "\n")

    except Exception as e:
        log.error(f"Pipeline failed at run {run_id}: {e}", exc_info=True)
        _update_run(run_id, status="failed", error=str(e))
        sys.exit(1)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _log_stage(n: int, name: str) -> None:
    print(f"\n{'─' * 50}")
    print(f"  Stage {n}/10 — {name}")
    print(f"{'─' * 50}")


def _clear_checkpoints(run_dir: Path) -> None:
    """Delete all checkpoint files from a run directory."""
    import shutil
    for item in run_dir.iterdir():
        if item.is_file():
            item.unlink()
        elif item.is_dir() and item.name in ("extracted", "sections", "pages"):
            shutil.rmtree(item)
    log.info(f"Cleared checkpoints in {run_dir}")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="ATLAS — Adaptive Topic-Led Article System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python atlas.py "IIM Ahmedabad Placements 2024"
  python atlas.py "CUET UG 2026 Maths Syllabus" --type exam
  python atlas.py "Top MBA Colleges NIRF 2024" --type ranking
  python atlas.py --list
  python atlas.py "IIM Ahmedabad Placements 2024" --resume 5
  python atlas.py "IIM Ahmedabad Placements 2024" --force
        """,
    )
    parser.add_argument("topic", nargs="?", help="Topic to write about")
    parser.add_argument(
        "--type",
        default=None,
        choices=["college_placement", "college_profile", "admission_guide",
                 "fee_reference", "ranking_list", "exam_guide", "career_guide",
                 "exam", "ranking", "career"],
        help="Content type — if omitted, auto-detected from topic keywords",
    )
    parser.add_argument(
        "--resume",
        type=int,
        default=1,
        metavar="N",
        help="Resume from stage N (1-10)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Clear all checkpoints and re-run from scratch",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all previous runs",
    )
    parser.add_argument(
        "--use-you-research",
        action="store_true",
        help=(
            "Replace Stages 3-4-5-6 with built-in researcher.py + indexer.py. "
            "Uses You.com search, trafilatura, markdownify, pdfplumber. "
            "Recommended for Indian education content. Requires YOU_API_KEYS in .env."
        ),
    )
    parser.add_argument(
        "--use-cg-research",
        action="store_true",
        help=(
            "Replace Stages 3-4-5-6 with content-generator subprocess bridge (legacy). "
            "Use --use-you-research instead."
        ),
    )

    args = parser.parse_args()

    if args.list:
        list_runs()
        return

    if not args.topic:
        parser.print_help()
        sys.exit(1)

    # Validate env
    if not os.getenv("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY not set. Create a .env file with your key.")
        sys.exit(1)

    run_pipeline(
        topic=args.topic,
        content_type=args.type,
        resume_from=args.resume,
        force=args.force,
        use_cg_research=args.use_cg_research,
        use_you_research=args.use_you_research,
    )


if __name__ == "__main__":
    main()
