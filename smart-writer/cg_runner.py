#!/usr/bin/env python3
"""
cg_runner.py — Thin runner that calls content-generator's researcher + indexer.

Called by stage_research_bridge.py via subprocess. NOT part of the content-generator
codebase — lives in smart-writer and just borrows CG's code via sys.path.

Usage:
  python3 cg_runner.py \
    --topic "CUET UG 2026 Mathematics Syllabus" \
    --content-type exam_guide \
    --intent exam_info \
    --output-dir /path/to/run-output-dir
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

# ── Load .env from smart-writer dir (has GEMINI_API_KEY, etc.) ────────────────
_SW_DIR = Path(__file__).parent
_CG_DIR = Path("/Volumes/NISHIT_PD/content-generator")

# dotenv: load smart-writer .env first, then CG .env for any missing keys
try:
    from dotenv import load_dotenv
    load_dotenv(_SW_DIR / ".env")
    load_dotenv(_CG_DIR / ".env")          # won't overwrite already-set keys
except ImportError:
    pass  # fall through — env vars must be set externally

# ── Add content-generator to sys.path so we can import from src.* ─────────────
if str(_CG_DIR) not in sys.path:
    sys.path.insert(0, str(_CG_DIR))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cg_runner")


# ── Import after path setup ────────────────────────────────────────────────────
try:
    from src.llm_client import LLMClient
    from src.search_client import YouSearchClient
    from src.researcher import Researcher
    from src.indexer import ResearchIndexer
    from src.utils import generate_slug
except ImportError as e:
    print(json.dumps({"status": "error", "message": f"Import failed: {e}"}))
    sys.exit(1)


async def run(topic: str, content_type: str, intent: str, output_dir: str) -> None:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    slug = generate_slug(topic)[:50]
    slug_dir = str(out)   # use output_dir directly as the slug dir (bridge creates it)

    # ── Validate keys ──────────────────────────────────────────────────────────
    if not os.getenv("YOU_API_KEYS") and not os.getenv("YOU_API_KEY"):
        print(json.dumps({"status": "error", "message": "YOU_API_KEYS not set in .env"}))
        sys.exit(1)

    # YouSearchClient reads YOU_API_KEYS from env by default
    search = YouSearchClient()

    # Researcher: pass output_dir so it caches research.json there
    researcher = Researcher(search_client=search, output_dir=str(out.parent))

    log.info("Research: '%s'  type=%s  intent=%s", topic[:60], content_type, intent)
    research_data = await researcher.research_topic(
        topic=topic,
        slug=slug,
        content_type=content_type,
        primary_intent=intent,
    )

    n_snippets = len(research_data.get("all_snippets", []))
    n_sources  = len(research_data.get("sources", []))
    log.info("Research done: %d snippets, %d sources", n_snippets, n_sources)

    # Save research.json to output_dir for bridge to read source URLs from
    (out / "research.json").write_text(
        json.dumps(research_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # ── Indexer ────────────────────────────────────────────────────────────────
    log.info("Indexing research data…")
    llm = LLMClient()
    indexer = ResearchIndexer(llm=llm, output_dir=str(out.parent))

    research_index = await indexer.build_index(
        slug=slug,
        research_data=research_data,
        topic=topic,
        content_type=content_type,
        primary_intent=intent,
        force=True,  # always rebuild for bridge (run_dir is a fresh ATLAS run dir)
    )

    # Save research_index.json directly into output_dir
    index_path = out / "research_index.json"
    index_path.write_text(
        json.dumps(research_index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    categories = [k for k, v in research_index.items() if isinstance(v, list) and v]
    total_items = sum(len(v) for k, v in research_index.items() if isinstance(v, list))
    log.info("Index saved: %d items across %d categories: %s",
             total_items, len(categories), ", ".join(categories))

    # ── Print result summary to stdout (bridge reads this) ────────────────────
    print(json.dumps({
        "status": "ok",
        "snippets": n_snippets,
        "sources": n_sources,
        "categories": categories,
        "total_items": total_items,
    }))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run content-generator researcher + indexer for a topic."
    )
    parser.add_argument("--topic",        required=True,  help="Article topic")
    parser.add_argument("--content-type", default="college_profile",
                        help="CG content type (exam_guide / college_profile / ranking_list / ...)")
    parser.add_argument("--intent",       default="general",
                        help="CG primary intent (placement / exam_info / ranking / ...)")
    parser.add_argument("--output-dir",   required=True,
                        help="Directory to write research.json + research_index.json")
    args = parser.parse_args()

    asyncio.run(run(args.topic, args.content_type, args.intent, args.output_dir))


if __name__ == "__main__":
    main()
