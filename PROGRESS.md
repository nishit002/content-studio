# Progress

## NEXT — (no task queued — ask Nishit for next priority)

---

## DONE — Bulk pipeline false error + ATLAS entity mismatch fix (2026-04-03)
Status: **COMPLETE. Zero TS errors.**

### Root cause 1 — `pipeline.ts` `parseAtlasLine` too broad on `✗`
`trimmed.includes("✗")` was treating any log line containing `✗` as a pipeline error stage.
Python's INFO log `"6:44:02  INFO     → ✗ entity mismatch (kept snippets as fallback)"` was hitting this check and emitting `{ stage: "error" }` to the SSE stream. In bulk mode, this marked the article as failed even though the pipeline was still running fine (it continues with snippet fallback).

**Fix:** Changed to `trimmed.startsWith("✗")` — real errors pushed directly to the queue start with `✗`; timestamped log lines start with `HH:MM:SS` and never trigger false positives.
- File: `src/lib/server/pipeline.ts`, `parseAtlasLine()` error detection block

### Root cause 2 — `researcher.py` missing comma-strip in entity validation
`fetcher.py`'s `_validate_entity` strips commas from page text before matching (fixes "Amity University, Noida" where pages write "Amity University Noida"). `researcher.py`'s `_entity_valid` was missing this step, causing excessive entity mismatch failures for comma-containing topics.

**Fix:** Added comma-stripping to `_entity_valid` to match `fetcher.py` logic.
- File: `smart-writer/researcher.py`, `_entity_valid()` function

---

## DONE — New Rewrite panel (Analyse → section cards → per-section rewrite) (2026-04-03)
Status: **COMPLETE. Zero TS errors.**

### What changed
Replaced the old single-textarea "Rewrite Article" panel + separate "Fix a Section" collapsible in **both** `ArticlePreview` components (generator tab + library tab) with a unified 3-step flow:

1. **Analyse** button → calls `/api/article/analyze` → returns structured JSON `{ titleIssue, sections }`
2. **Section cards** rendered: H1 title card + one card per article section. Each card shows:
   - Auto-detected issue badge (from LLM analysis) if any
   - Editable textarea for instruction (pre-filled with detected issue; user can edit or clear)
3. **Start Rewrite** loops through sections with non-empty instructions, calls `/api/rewrite` per section (OpenRouter kimi-k2.5 with research grounding). Title updated via `saveTitle()`. Progress bar shows step N of total.

### Files changed
- `src/components/dashboard/tabs/content-generator-tab.tsx` — full rewrite panel redesign
  - Removed state: `rewriteInstructions`, `rewriting`, `rewriteStage`, `showFixSection`, `activeFixIdx`, `fixInstruction`, `fixInProgress`, `fixMsg`, `rewriteAbortRef`
  - Added state: `analyzeResult`, `sectionInstructions`, `titleInstruction`, `rewriteProgress`
  - Removed functions: `startRewrite()`, `fixSection()`
  - Added functions: `runAnalyze()`, `runSectionRewrites()`
  - Rewrite button click: simplified (no more `rewriteInstructions` auto-fill)
  - Removed "Fix a Section" collapsible panel entirely
- `src/components/dashboard/tabs/content-library-tab.tsx` — stale `rewriteInstructions` reference in button onClick removed

### Why
- Old "Start Rewrite" called `/api/generate` (full pipeline) — instructions never actually reached the Python writer
- New approach uses `/api/rewrite` per section — instructions go directly to OpenRouter kimi-k2.5 with research context
- Merged "Fix a Section" into the main rewrite flow — cleaner UX, no duplicate panels

---

## DONE — Editable title field in ArticlePreview + title save (2026-04-03)
Status: **COMPLETE. Zero TS errors.**

### Problem
Title in article header was static — no way to manually fix a bad title. Also `currentTitle` passed to analyze was stale `meta.title` instead of the live edited value.

### Fixes

**`/api/article/route.ts` — PUT handler**
- Now accepts optional `title` field (in addition to `html`)
- Validates: slug + at least one of html/title required
- If `title` provided: reads `meta.json`, updates `title` field, writes back

**Both `ArticlePreview` components (library + generator tabs)**
- Replaced static `<h3>{liveTitle || meta.title}</h3>` with `<input>` field
- `onChange` → updates `liveTitle` state (live typing)
- `onBlur` / Enter key → calls `saveTitle()` → PUT `/api/article` with `{ slug, title }`
- `analyze` call now passes `currentTitle: liveTitle || meta.title` (uses edited value, not stale prop)

---

## DONE — H1 title override bug in CG writer + UI title refresh (2026-04-03)
Status: **COMPLETE. Zero TS errors.**

### Root cause (Python — writer.py)
`_sanitize_h1_title()` WAS running and replacing the generic title in `outline["title"]`. But then the assembly step in `writer.py` (line ~1423) extracted the first section's `<h2>` heading (written by Qwen, still generic) and **promoted it to `<h1>`**, overwriting the sanitized title. So the article HTML always had the Qwen-written generic heading as H1, ignoring the sanitized outline title.

**Fix**: Assembly now always uses `outline["title"]` (already sanitized) for `<h1>`. The first section's `<h2>` is stripped (to avoid duplication) but not promoted.

### Root cause (UI — generator tab + article route)
- Generator tab: used `d.meta?.title` which is undefined for ATLAS articles (no title field in synthesized meta)
- Article route: ATLAS meta synthesis never extracted the H1 title from article.html
- Both tabs: should use H1 from the article HTML as primary title source (most reliable)

**Fixes:**
- `src/app/api/article/route.ts` — ATLAS meta now reads H1 from article.html and adds as `title` field
- Both tab `ArticlePreview` components — after rewrite done, extract H1 from reloaded HTML; fall back to `d.meta?.title`

---

## DONE — Rewrite now regenerates and displays the article title (2026-04-03)
Status: **COMPLETE. Zero TS errors.**

### Problem
After clicking Start Rewrite, the article title in both tabs stayed as the old generic title even though the CG pipeline (which now has `_sanitize_h1_title()`) had already written a new, better title to `meta.json` on disk.

Also: the library tab's "reload HTML after rewrite" was silently broken — it was calling `r.json()` on a `text/html` response (the `part=html` endpoint), which always threw a SyntaxError caught by `.catch(() => {})`, so HTML never actually reloaded.

### Fixes

**`/api/article/analyze/route.ts`**
- Added `currentTitle?: string` to input type
- Added section 6 (TITLE) to the ANALYZE_PROMPT: LLM flags generic titles and suggests a specific replacement with a concrete fact
- The suggestion flows into `analysisBlock` → `AUTO-DETECTED ISSUES` in `customOutline` → CG outliner sees it and generates a better title

**`content-library-tab.tsx` `ArticlePreview` component**
- Added `liveTitle` state (initialized from `meta?.title`)
- Passes `currentTitle: meta.title` to `/api/article/analyze`
- Fixed the reload: changed from broken `part=html` + `.json()` to `part=all` which returns JSON with both `html` and `meta` fields
- After rewrite done: `setEditedHtml(d.html)` + `setLiveTitle(d.meta.title)` — both HTML and title update
- Header now shows `{liveTitle || meta.title}` instead of just `{meta.title}`

**`content-generator-tab.tsx` `ArticlePreview` component**
- Same `liveTitle` state + `currentTitle` in analyze call
- After rewrite done: fetches `part=all` and updates both `editedHtml` and `liveTitle`
- Updated done message: "Article rewritten successfully. The editor has been updated with the new version."
- Header now shows `{liveTitle || meta.title}`

---

## DONE — Generic H1 title fix in CG pipeline (2026-04-03)
Status: **COMPLETE. Python syntax clean.**

### Problem
CG pipeline produced titles like "IIM Indore: Overview, Key Highlights & Why IT Matters for 2026 Aspirants". Two root causes:
1. outline_prompt.txt had no rules for the `title:` YAML field (only section heading rules)
2. The colon-quoting YAML fix only handled `heading:` lines — `title:` lines with colons still broke YAML parse, triggering the fallback outline

### Fixes
**content-generator/config/prompts/outline_prompt.txt**
- Added H1 ARTICLE TITLE section with banned patterns (explicit ✗ examples)
- Required format per content_type (college_profile, exam_guide, cutoff_data, etc.)
- Rule: never capitalize "it" as "IT" unless IT is explicitly an abbreviation in the topic

**content-generator/src/outliner.py**
- Colon-quoting regex now covers `title:` lines, not just `heading:` — fixes YAML parse failures when title contains colons
- Added `_sanitize_h1_title()` module-level function: checks against `_GENERIC_TITLE_PATTERNS`, detects wrong "IT" capitalisation, replaces with structured fallback from `_FALLBACK_TITLE_TEMPLATES`
- Called from `_ensure_fields()` on every outline — covers both Gemini-generated and fallback outlines
- Tested: "IIM Indore: Overview, Key Highlights & Why IT Matters..." → "IIM Indore: Courses, Fees, NIRF Rank & Placement 2026"

---

## DONE — Data accuracy: context-aware extraction + verification (2026-04-03)
Status: **COMPLETE. Python syntax clean.**

### Problem
Articles showed bare numbers without qualifying context — e.g. "₹12.23 lakh" with no course name, no duration (annual/total), no academic year. Fees were the biggest issue (ranking factor + reader pain point). BIT Mesra article had wrong fees vs official website.

### Root causes fixed
**stage5_extract.py — EXTRACT_PROMPT**
- Added CONTEXTUAL DATA RULES section with BAD/GOOD examples per data type
- Fees: must capture programme name + annual/semester/total + academic year
- Packages: must include batch year + average/median/highest qualifier + branch if stated
- Dates: must note confirmed vs tentative
- Rankings: must include ranking body + year + category
- Conflicting sources: both values reported in extraction_notes; official site takes priority

**stage6_verify.py — VERIFY_PROMPT**
- Verification now checks context + number together (not just "does this digit appear?")
  - "₹3.07 lakh" with no course/duration → verified=false (context missing)
  - "₹3.07 lakh total" when source says "annual" → verified=false (context wrong)
- CONFLICT DETECTION: if source contains two different values for same field → verified=false, both logged
- source_snippet must quote full sentence (amount + what it's for), not just the number
- Table context_note preserved in table title so writer knows what a table covers
- Outdated data flagged: if source year is 2+ years old, "(data from [year] — may be outdated)" appended
- Conflict warnings logged to atlas.stage6 for audit trail

---

## DONE — UI polish + ATLAS writing quality improvements (2026-04-03)
Status: **COMPLETE. Zero TS errors.**

### UI fixes (content-generator-tab.tsx + content-library-tab.tsx)
- **Rewrite button double icon fixed** — removed `↺` text character from both tabs; SVG icon is enough
- **Rewrite instructions no longer mandatory** — removed `!rewriteInstructions.trim()` from `disabled` condition in generator tab (library was already correct)
- **Smart rewrite auto-fill** — new `buildSmartRewriteInstructions(quality)` helper in both tabs:
  - When Rewrite panel opens on article scoring < 80, textarea pre-fills with targeted instructions
  - Targets specific weak areas: data density, FAQ missing, table count, fact check rate, quality_issues list
  - Example: "Target Grade A (score 90+). Fix: boost data density (1.6/100w), add FAQ section, add more tables..."
  - User can still edit or clear the text before running

### Cover image: background + title text overlay
- **New file: `src/lib/client/cover-image.ts`** — `composeCoverImage(bgUrl, title): Promise<string>`
  - Canvas size: 1200×630 (standard OG image ratio)
  - Step 1: draw API background image as cover-fit (scaled + centered)
  - Step 2: dark gradient overlay (transparent top → 88% dark bottom)
  - Step 3: bold white title text (Georgia 50px, bottom-aligned, word-wrapped, max 3 lines, drop shadow)
  - Returns JPEG data URL at 92% quality
- Both `generateCoverImage` functions (library + generator tabs) now pipe through `composeCoverImage`

### ATLAS pipeline — Stage 9: opening/closing paragraph polish
- **`smart-writer/stage9_humanize.py`** — after humanization loop, added `_polish_intro_outro()`:
  - Reads `blueprint.json` from run_dir for topic + article_type
  - Finds first `<p>` in section[0] (opening) and last `<p>` in section[-1] (closing)
  - One Gemini call per paragraph: generates 3 variants, returns `{versions, best_index, reason}`
  - Replaces paragraph with the best version, saves section file
  - Non-blocking: if Gemini fails, original kept as-is

### ATLAS pipeline — Stage 10: key-stat callout boxes
- **`smart-writer/stage10_coherence.py`** — added callout injection system:
  - `CRITICAL_LABELS` dict maps all 7 article types → row labels to watch for (avg package, fees, exam date, etc.)
  - `_extract_table_callouts()` scans table rows, matches labels, extracts values
  - `_inject_key_callouts()` finds first table with 2+ critical rows, injects `<div class="cs-highlights">` before it
  - CSS added to `_ARTICLE_STYLE`: `.cs-highlights`, `.cs-stat`, `.cs-stat-value`, `.cs-stat-label`
  - `run()` reads `blueprint.json` for article_type, passes to `_build_final_html()`
  - `_build_final_html()` now accepts `article_type` param and calls `_inject_key_callouts()` after sanitize

---

## DONE — ATLAS deep integration + blueprint quality hardening (2026-04-03)
Status: **COMPLETE. Zero TS errors.**

### What was done
- **smart-writer/ moved into content-studio/** — single repo, ATLAS_DIR updated in pipeline.ts + route.ts
- **ATLAS articles visible in Content Library + Content Generator list** — fixed relative path bug in runs.json lookup (`path.join(ATLAS_DIR, runDir)`)
- **CSS distortion fixed** — `cleanArticleHtml()` now strips `<style>` tags in both content-generator-tab and content-library-tab
- **Universal pipeline toggle** — moved to top of Content Generator tab, applies to Single + Bulk modes; News always uses CG
- **Bulk generation uses selected pipeline** — passes `pipeline` field to `/api/generate`
- **PUT/DELETE ATLAS articles** — route.ts now checks both CG and ATLAS output dirs
- **Sources download for ATLAS** — reads `sources.json` instead of `research.json`
- **Entity mismatch fix** — fetcher.py strips commas before matching ("Amity University, Noida" now matches)
- **Stage 1 blueprint completely rewritten** — Python pre-classifies topic type; Gemini only fills data_needed + search_queries
  - 7 article types: college_profile, college_placement, exam_guide, ranking_list, fee_reference, admission_guide, career_guide
  - Python `classify_topic()` detects type from 30+ keyword signals — Gemini never chooses structure
  - Two focused Gemini calls: entity identification (temp=0.1) + section fill (temp=0.2)
  - Structure can never be wrong; only research details come from LLM

---

## DONE — ATLAS integration into Content Studio + pipeline fixes (2026-04-03)
Status: **COMPLETE. Zero TS errors. Dev server running.**

### What was done

**1. ATLAS integrated as a second pipeline option in Content Generator**
- `src/lib/server/pipeline.ts` — added `runAtlasPipeline()` + `parseAtlasLine()`
  - Spawns `atlas.py --use-you-research` from `/Volumes/NISHIT_PD/smart-writer/`
  - Reads smart-writer `.env` for keys (GEMINI, YOU, BRIGHT_DATA) automatically
  - Maps ATLAS stage log lines → same `PipelineStage` enum the UI uses
  - Emits `atlasSlug` in final "done" event so article auto-loads
- `src/app/api/generate/route.ts` — reads `pipeline` field from POST body; routes to ATLAS when `pipeline === "atlas"`
- `src/app/api/article/route.ts` — dual-directory support:
  - `?list=true` merges ATLAS `runs.json` into article list with `source: "atlas"` flag
  - Slug lookup checks content-generator first, then ATLAS output dir
  - ATLAS articles get synthesized meta from `runs.json` + `coherence_report.json`
- `src/components/dashboard/tabs/content-generator-tab.tsx` — pipeline toggle UI:
  - Two-button toggle: **Content Generator** / **✦ ATLAS Smart Writer** in card header
  - ATLAS mode hides Sub-Keywords, Region, Custom Outline (not used by ATLAS)
  - ATLAS gets its own 5-type content type dropdown
  - Button label changes to "Run ATLAS Pipeline"
  - ATLAS articles show `ATLAS` badge in recent articles list

**2. Stage 11 Proofread added to ATLAS pipeline**
- `stage11_proofread.py` — new file. Gemini reads all `<p>` tags in batches of 15.
  Fixes: spelling mistakes, garbled PDF/OCR chars (â€™ → ', â€" → —, Â → removed),
  basic grammar. Does NOT touch numbers, names, tables.
  Saves backup as `article_pre_proofread.html` before overwriting.
- `atlas.py` — stage 11 added after coherence. Non-blocking (failure keeps unproofread article).

**3. Gemini model fixed**
- `llm_client.py` (smart-writer) — default changed to `gemini-2.5-flash`
- `src/app/api/health/route.ts` — health check URL updated to `gemini-2.5-flash`

**4. BrightData credentials updated**
- New API key: `d21a04c7-3ff3-4b95-bc9e-8710e243d632`
- New zone: `web_unlocker3studio` (trial expired on old account, new Web Unlocker API added)
- Updated in: `smart-writer/.env` and `content-studio/.env.local`

**5. Turbopack cache cleared** — `.next/` deleted to fix startup crash (`invalid digit` DB error was Turbopack's internal cache, not our SQLite).

### ATLAS pipeline path
`/Volumes/NISHIT_PD/smart-writer/` — 11 stages:
1 Blueprint → 2 Character → 3 You.com Research → 5 Gemini Indexer → 7 Outline → 8 Write → 9 Humanize → 10 Coherence → 11 Proofread

### To test ATLAS from Content Studio
1. Go to Content Generator tab
2. Click **✦ ATLAS Smart Writer** toggle
3. Enter topic (e.g. "IIM Ahmedabad Placements 2024")
4. Select content type → click **Run ATLAS Pipeline**
5. Article auto-loads when done (takes ~10-15 min for full pipeline)

### To test ATLAS from terminal
```bash
cd /Volumes/NISHIT_PD/smart-writer
python3 atlas.py "IIM Ahmedabad Placements 2024" --use-you-research
```

---

## DONE — researcher.py + indexer.py (2026-04-02)
Status: **BUILT + DEPS INSTALLED**

### What was done
Replaced ATLAS Stages 3-4-5-6 with native smart-writer modules.
Content-generator untouched. No subprocess. No path hacking.

**New files in smart-writer:**
- `researcher.py` — Replaces stages 3+4. You.com search (key rotation, async),
  intent-aware queries from Blueprint, official site targeting (NTA/NIRF/JOSAA/IIT/IIM),
  PDF detection + pdfplumber extraction, trafilatura for clean text,
  markdownify for markdown text (tables preserved as | col | rows).
  Saves: sources.json, fetched_pages.json, pages/{hash}.txt, pages/{hash}_md.txt
- `indexer.py` — Replaces stages 5+6 in ONE Gemini pass per sub-topic.
  Reads markdown text (tables intact), extracts targeted fields + verifies inline.
  Sanity checks baked in (impossible scores blocked, India-only books, no invented weightages).
  Saves: extracted/{id}.json, verified_data.json

**Legacy bridge files kept (still functional):**
- `cg_runner.py`, `stage_research_bridge.py` — `--use-cg-research` flag still works

**Modified:**
- `atlas.py` — `--use-you-research` flag (recommended), `--use-cg-research` (legacy)
- `requirements_atlas.txt` — trafilatura, markdownify, youdotcom, pdfplumber

**All deps installed.**

**To use:**
```bash
cd /Volumes/NISHIT_PD/smart-writer
python3 atlas.py "CUET UG 2026 Maths Syllabus" --type exam --use-you-research
python3 atlas.py "IIM Ahmedabad Placements 2024" --use-you-research
```
Requires YOU_API_KEYS + GEMINI_API_KEY in smart-writer .env.

### Article quality fixes already done (2026-04-02)
- Switched writer from Llama 8B → Qwen3-235B via HuggingFace
- Tightened writer prompt: banned padding, marketing phrases, bare text
- `_wrap_bare_text()`: wraps all prose in <p> tags
- `_strip_truncated()`: removes half-cut tables (was cutting off mid-cell)
- max_tokens 3000 → 8000 (was causing truncated HTML)
- Stage 7 dedup: each sub-topic appears in max 1 section
- FAQ answers: Gemini now extracts real answers from article (not "See above")
- Duplicate H1 fixed in stage10_coherence.py

### GitHub repos to consider for further quality
- **trafilatura** (github.com/adbar/trafilatura) — Better than readability-lxml
  for extracting clean text from HTML. Handles more edge cases, better table preservation.
  Replace readability in fetcher.py with this.
- **newspaper4k** (github.com/andyfinnell/newspaper4k) — Article extraction + NLP metadata
  (publish date, authors, summary). Good for Stage 2 character research.
- **markdownify** (github.com/matthewwithanm/python-markdownify) — Convert HTML tables
  to markdown before passing to LLM. Qwen handles markdown tables better than raw HTML.
- **html-table-extractor** (github.com/yuanxu-li/html-table-extractor) — Extract tables
  from HTML as structured dicts. Useful in Stage 5 extraction.

### To make articles shareable
- Add a CSS file (article.css) with clean typography (Inter font, max-width 800px, table borders)
- Stage 10 should link it: <link rel="stylesheet" href="article.css">
- Output a PDF version using weasyprint (pip install weasyprint)
- This is low effort, high impact for sharing

---

## ATLAS Pipeline — BUILT (2026-04-02)
Status: **Working — quality improving**

### Files (all in /Volumes/NISHIT_PD/smart-writer/)
- `atlas.py` — CLI entry point + orchestrator
- `models.py` — all dataclasses
- `llm_client.py` — Gemini + LM Studio helpers
- `fetcher.py` — HTTP + BrightData + entity validation + 24hr cache
- `stage1_blueprint.py` — Topic Blueprint (Gemini)
- `stage2_character.py` — Article Character Research (DDG + Gemini)
- `stage3_sources.py` — Targeted Source Discovery (per sub-topic DDG)
- `stage4_fetch.py` — Fetch + entity validation (drops wrong institution pages)
- `stage5_extract.py` — Sub-topic Extraction (Gemini, targeted fields only)
- `stage6_verify.py` — Fact Verification (Gemini, temperature=0.0)
- `stage7_outline.py` — Outline (verified data only, character-driven)
- `stage8_write.py` — Section Writing (Llama, verified data block only)
- `stage9_humanize.py` — Humanization (Llama, prose only, tables untouched)
- `stage10_coherence.py` — Coherence Check + Final Assembly (Gemini)
- `requirements_atlas.txt` — pip dependencies

### To test
```
cd /Volumes/NISHIT_PD/smart-writer
pip3 install -r requirements_atlas.txt
# Make sure .env has GEMINI_API_KEY (and optionally BRIGHT_DATA_KEY)
python3 atlas.py "IIM Ahmedabad Placements 2024"
```

### v1 kept as backup
`smart_writer.py` (v1) is untouched at its original path.

### Why redesign
v1 test run ("IIT Bombay Placements 2024") exposed 5 critical failures:
1. Wrong institution — DDG returned IIM pages, no validation, used them anyway
2. Llama hallucinated — fallback said "write from general knowledge" → invented 5-year trend table with fake numbers
3. Thin content — 1452 words total (target is 5000-7000)
4. No analytical depth — Gemini extracted but never analysed. Llama got raw data rows, not insights.
5. AI-sounding prose — single Llama pass, no humanization

### 10 stages to build (ATLAS pipeline)

**Stage 1: Topic Blueprint**
- Gemini call on the topic string
- Output: primary entity, entity type, sub-topic tree
- For each sub-topic: what data is needed, format (table/bullet/prose), search queries
- Saves blueprint.json

**Stage 2: Article Character Research**
- DDG: find 3-5 top articles on same topic
- BrightData: fetch them
- Gemini: analyse structure, section order, content character (comparison/data-heavy/narrative)
- Saves character.json
- Purpose: mirror the structure of articles that already rank for this topic

**Stage 3: Targeted Source Discovery**
- Per sub-topic: DDG search using blueprint's search queries
- Filter to .gov.in / .ac.in / .nic.in / official domains only
- Prioritise PDFs (placement reports, official bulletins)
- Saves sources.json

**Stage 4: Targeted Fetch (BrightData)**
- Fetch each URL, 24-hour disk cache
- Entity validation: page text must contain primary entity name → wrong institution = dropped
- This fixes the IIT/IIM confusion from v1

**Stage 5: Sub-topic Extraction (Gemini)**
- Per sub-topic: extract only the data fields defined in blueprint
- Targeted = higher accuracy, less noise
- Saves extracted/{subtopic_id}.json

**Stage 6: Data Verification (Gemini)**
- Re-reads source + extracted data
- Checks: does each fact actually appear in source text?
- Marks verified / unverified. Drops unverified.
- Saves verified_data.json

**Stage 7: Outline (Gemini)**
- Inputs: blueprint + character + verified_data
- Only sections with verified data. Character-driven structure.
- Content extensions: if character = comparison → add comparison column, etc.
- Word targets: 700-900 per section
- Saves outline.json

**Stage 8: Section Writing (Llama)**
- Verified data only. No data = section dropped, not invented.
- 700-900 words per section, max_tokens 3000

**Stage 9: Humanization (Llama)**
- Second pass on prose only (tables untouched)
- Natural sentences, remove AI patterns, temperature 0.75

**Stage 10: Coherence Check (Gemini)**
- Full draft review: flow, data accuracy, reader query coverage
- Minor issues auto-patched. Major issues flagged.
- Saves coherence_report.json

### Resume system (already built in v1, carries over)
- Run ID: 001, 002... saved in output/runs.json
- Each stage saves checkpoint → --resume N skips completed stages

### Expected output quality
- 5000-7000 words per article
- Zero hallucination (data-gated writing)
- Correct institution identification
- Content character adapts to topic
- Human-sounding prose

---

## Current State (as of 2026-04-02)

### Smart Writer — v1 Pipeline (superseded by ATLAS plan above)
Path: `/Volumes/NISHIT_PD/smart-writer/`
Status: **v1 COMPLETE but quality insufficient** — ATLAS redesign planned

A second, independent content pipeline built alongside the existing content-generator.
Uses BrightData web scraping (full pages, not snippets) + LM Studio (local Llama 3.1 8B) for writing.

**Why it exists:**
- Existing pipeline fetches You.com snippets (200-500 chars max per result)
- Snippets truncate tables, cut off numbers, miss rows → LLM fills gaps by hallucinating
- Smart Writer fetches the COMPLETE official page via BrightData → extracts every row of every table

**Files:**
- `smart_writer.py` — full pipeline in one file (~850 lines)
- `requirements.txt` — Python dependencies
- `.env.example` — template for API keys and config

**6-stage pipeline:**
1. **Source Discovery** — matches topic to OFFICIAL_SOURCES map + DuckDuckGo search (no API key)
   - 25+ pre-mapped official domains: nta.ac.in, nirfindia.org, josaa.nic.in, IIT/IIM sites etc.
   - Filters DDG results to .gov.in / .ac.in / .nic.in / .edu.in only
2. **BrightData Fetch** — fetches complete page HTML (bypasses anti-bot, JS rendering)
   - Direct HTTP first (free, works for most govt sites)
   - Falls back to BrightData Web Unlocker if blocked or content is empty
   - 24-hour disk cache (saves BrightData credits, speeds up re-runs)
   - Uses `readability-lxml` (Firefox Reader algorithm) to strip nav/ads and keep main content
3. **Gemini Extraction** — reads full page, extracts ALL facts into structured JSON
   - 14 categories: exam_info, exam_sections, syllabus, rankings, colleges, fees, placements, cutoffs, books, scholarships, admission_process, career_paths, statistics, important_dates
   - Every table fully extracted (not summarised) — 40-row NIRF table = 40 rows in JSON
4. **Outline Creation** — Gemini builds SEO-optimized section plan from the extracted data categories
   - Only creates sections where real data exists (no filler sections)
   - Every section gets a `unique_angle` to prevent cross-section overlap
   - Headings must include a specific fact/number (never generic labels)
5. **Section Writing** — LM Studio (Llama 3.1 8B at localhost:1234)
   - Writer receives pre-extracted, pre-verified data tables → converts to HTML prose
   - No hallucination possible: "if the data doesn't have it, don't write it"
   - Focus keyword threaded naturally 1-2× per section
   - Anti-repetition: each section gets a list of what earlier sections already covered
   - Temperature 0.3 for tables, 0.45 for prose
6. **SEO Assembly** — final HTML with TOC, FAQ + JSON-LD schema, source citations

**Key design decisions:**
- LM Studio / Llama 3.1 8B: free, local, private. Works well when given pre-structured data to format.
- BrightData Web Unlocker zone required for JS-heavy sites (app.brightdata.com → Web Unlocker → create zone)
- Single Python file (no package structure) — easy to run and modify

**SEO approach (corrected from meta-tag thinking):**
- Real SEO = content depth + zero repetition + keyword woven through content naturally
- Each section exhausts its sub-topic completely; never repeats data from another section
- Focus keyword appears in content where it reads naturally, not forced
- Data density: every sentence carries a specific fact (number, name, date) — no generic filler

**Usage:**
```
cd /Volumes/NISHIT_PD/smart-writer
pip3 install -r requirements.txt
cp .env.example .env   # fill in GEMINI_API_KEY and optionally BRIGHT_DATA_KEY

python3 smart_writer.py "CUET UG 2026 Mathematics Syllabus" --type exam_guide
python3 smart_writer.py "IIT Bombay Placements 2024" --type college_profile
python3 smart_writer.py "Top MBA Colleges India NIRF 2025" --type ranking_list
```

Output saved to: `output/{slug}/article.html` + `extracted_data.json` + `outline.json`

**LM Studio setup:**
- Open LM Studio → Local Server tab → load a model → Start Server
- Confirmed working with `meta-llama-3.1-8b-instruct` at localhost:1234
- `qwen/qwen3.5-9b` also available but requires ~7 GB RAM

---

## Current State (as of 2026-03-31)

### Content Studio (Next.js app)
5 tabs ALL COMPLETE — Dashboard, Content Generator, Content Library, AEO & SRO, Configuration.
Build clean, zero TS errors, dev server on localhost:3000.

**Bug fixes added 2026-03-31:**
- Content Generator: post-generation stats (Words/Tables/API Calls/Quality) were showing "—" after pipeline completed.
  Root cause: Python emits two `done` SSE events (stats line + article path line); second one was overwriting result state.
  Fix: merge `done` event details instead of replacing (`setResult(prev => ({ ...prev, ...event.detail }))`).

- "Fix a Section" rewrite now passes research_index.json to the LLM for factual grounding.
  Previously: rewrite had zero research data → LLM invented facts to fill sections.
  Fix: `/api/rewrite` loads `research_index.json` for the article's slug and includes it as VERIFIED RESEARCH DATA in the prompt.

- Post-write cross-table row deduplication pass added to writer.py.
  Root cause of repeating rows: sections are written in parallel so each writer independently adds the same rows
  (e.g. "Exam Mode | CBT") without knowing other sections already wrote them.
  Fix: after all sections are assembled into `article_html`, `_dedup_table_rows()` tracks every data row seen
  so far and removes duplicates from later tables. First table always kept intact. If a table ends up with
  zero data rows after dedup, the whole empty table block is removed.

- Writer model was Llama-3.3-70B instead of Qwen (pipeline.ts + llm_client.py):
  Root cause: pipeline.ts set HF_TOKEN but llm_client.py read HF_API_KEY — never matched.
  Python subprocess got hf_key=None → sent "Authorization: Bearer None" to HuggingFace Router
  → HF Router fell back to free-tier Llama-3.3-70B. Also .env.local has HF_API_KEYS (plural)
  which was never read. Fix: pipeline.ts now sets both HF_TOKEN and HF_API_KEY; also forwards
  HF_API_KEYS pool. llm_client.py reads HF_API_KEY, HF_TOKEN, HF_API_KEYS (all variants),
  with round-robin rotation across multiple keys. Comment fixed (128K is Qwen3, not Llama).

- Sectional research query fix — root cause of repeated data across sections (writer.py + outline_prompt.txt):
  Root cause: each section's You.com query was built as `f"{topic} {heading}"[:80]`. For exam articles,
  every heading starts with the full topic name (e.g. "CUET UG 2026 for Humanities"), so after 80-char
  truncation all queries look identical → You.com returns the same page for every section → same rows everywhere.
  Fix 1 (writer.py): added `_build_section_research_query()` that strips the topic prefix from the heading
  to extract the unique part, falls back to `purpose` field if available, then columns as last resort.
  Also added exam-specific targeted queries per section type (syllabus, exam pattern, dates, eligibility,
  colleges, resources) so each section fetches data from the right NTA/official URLs.
  Fix 2 (outline_prompt.txt): explicit `research_query` rules with ✓/✗ examples showing that each query must
  be unique, never start with the full topic name, and target what ONLY that section needs.

- outline_prompt.txt: Added explicit "BLUEPRINT COLUMNS ARE MANDATORY" rule.
  Root cause of double Parameter|Details tables: Gemini was ignoring blueprint columns and defaulting to
  `Parameter|Details` for every table section, creating identical row structure across all tables.
  The outline validator only enforces section count and rejected topics — it never checked actual columns.
  Fix: added a prominent rule with ✓/✗ examples explaining WHY specific columns exist and what happens when ignored.

- exam_info intent map overhauled (intent_maps.yaml) — 3 problems fixed:
  1. Syllabus section had `Expected Weightage` column hard-coded in the blueprint, overriding Rule 12 in outline_prompt.
     Fix: changed to `[Unit/Topic, Key Subtopics, Type (Core/Applied), Chapter Count]` — no invented weightages.
  2. "Previous Year Analysis" had a "Difficulty" column — no official source publishes exam difficulty ratings,
     so writers invented generic filler. Fix: replaced with `[Year, Registrations, Participating Universities, Qualifying Marks]` — all verifiable data.
  3. Tier 4 was "Preparation Strategy: Study Plan, Best Books & Topper Tips" — this framed every exam_info article
     as a competition/prep guide and produced generic advice ("use flashcards, take breaks, join coaching").
     Fix: replaced with "Official Resources: Syllabus PDF, Mock Tests & Important Links" — factual table with actual PDFs/portals.
     Also added "preparation strategy", "study plan", "topper tips", "how to crack" to rejected_topics so Gemini can't sneak them back in.

- Checker.py now actually runs (was silently broken since day 1 on all articles).
  Root cause: Gemini 2.5 Flash (thinking model) returns `parts[0]` as the internal thinking trace (`"thought": true`)
  and puts the real JSON output in `parts[1]`. Code was reading `parts[0]["text"]` = thinking garbage → JSON parse failed → checker skipped.
  Fix: `llm_client.py` now filters out thought parts and joins only the real output text.
  Impact: accuracy checker will now actually catch impossible scores, invented data, and wrong books in every article.

**New features added 2026-03-31:**
- URL routing — every module has a deep-link URL (`/?tab=generator`, `/?tab=aeo&sub=prompts`, etc.)
- Content Library: "Fix a Section" — select any section, give instruction, only that section is rewritten via `/api/rewrite`
- Content Library: "Rewrite Article" — full pipeline regeneration, new HTML auto-loads in editor when done
- Bulk runs — named batches, persisted to SQLite with progress snapshots (resume-able, history visible)

**URL scheme:**
- `/?tab=dashboard` — Dashboard
- `/?tab=generator` — Content Generator
- `/?tab=library` — Content Library
- `/?tab=aeo` — AEO & SRO (lands on default sub-tab)
- `/?tab=aeo&sub={key}` — specific AEO sub-tab (aeo, sro, prompts, responses, analytics, citations, opportunities, competitors, battlecards, fanout, niche, automation)
- `/?tab=config` — Configuration

### Content-Generator Pipeline (Python)
Path: `/Volumes/NISHIT_PD/content-generator/`
Accuracy hardening + redundancy fixes COMPLETE as of 2026-03-31.

**6-step pipeline:**
1. researcher.py → You.com queries (exam_info intent correct; smart fallback by topic type)
2. indexer.py → Gemini extracts research_index.json (+ exam_sections, cutoff_scores, books_resources)
3. outliner.py → Gemini generates YAML outline (Rule 11: no repeated Parameter|Details; Rule 12: no weightage columns)
4. writer.py → Qwen writes sections in parallel (PROTECTED FACTS; non-overview sections must not restate exam-wide facts in opening)
5. checker.py → Gemini validates article vs research_index → find+replace patches → saves checker_report.json
6. post_processor.py → HTML cleanup + quality score

**What checker.py catches automatically:**
- Impossible scores (CUET cutoff > 250, JEE > 300, NEET > 720)
- Invented topic weightages (e.g., "40% for Calculus")
- International textbooks for Indian exam prep (Spivak, Rudin → replaced with NCERT/Arihant)
- Fabricated table data (e.g., Avg Package in a CUET admissions table)
- Unconfirmed dates without "Expected:" prefix

### Next phase
**AEO Enhancements** — roadmap in CLAUDE.md. Start with Phase 1: AEO Overview Dashboard.

---

## 2026-03-31 — Empty Heading Bug Fix — COMPLETE ✅

**Root cause**: When a blueprint (intent_map) is provided to Gemini, Gemini echoes back the
`heading_seed:` from the blueprint into the outline YAML but writes `heading: ''` (empty string).
The writer then gets no section heading and defaults to repeating the article title for every
section → all sections headed "SRM University Biotechnology Fees in India 2025" (or similar).

**Fix** (`src/outliner.py`): In `_ensure_fields`, added a single check:
"If `heading` is empty AND `heading_seed` is non-empty → promote `heading_seed` to `heading`."
This runs before all other heading cleanup so the writer always gets a real heading.

**Visible impact**: Articles with specific intents (fees, placement, cutoff etc.) will now have
proper distinct section headings instead of the article title repeated 8 times.

---

## 2026-03-31 — Research-Driven Headings Fix — COMPLETE ✅

**Root cause fixed**: All `informational/general` and `college_profile/general` articles had
identical generic headings because `heading_seed` values like "{topic}: What It Is, Key Facts &
Why It Matters" were copied verbatim by Gemini, substituting only {topic}.

**Changes made (2 files in content-generator pipeline):**

- `config/intent_maps.yaml`:
  - `informational/general`: Removed ALL `heading_seed` values. Sections now have `purpose` only.
    Gemini must derive headings from research data (course name, regulatory body, NIRF rank, etc.)
    rather than copying a template.
  - `college_profile/general`: Added brand-new blueprint (was missing entirely). 8 sections covering
    Overview → Courses → Admission → Fees → Placements → Rankings → Campus → How to Apply.
    No `heading_seed` on any section — research-derived headings only.

- `config/prompts/outline_prompt.txt`:
  - Updated heading_seed description (line 57): added note that sections with no heading_seed
    must be research-derived (Rule 13).
  - Added Rule 13: "Research-Derived Headings — Mandatory When No heading_seed Is Provided."
    Explicit bad/good examples. College overview and informational articles each have their own
    sub-rule showing what specific facts must appear in the heading (rank, grade, programme name,
    full form expansion, etc.).

---

## 2026-03-31 — Content Writing Flow + Redundancy Fixes — COMPLETE ✅

### 3 bugs fixed

**1. UI: startRewrite now auto-reloads HTML after done** (`content-library-tab.tsx`)
- Previously: "Article rewritten. Open it from Content Library to see the new version." (user had to navigate away and back)
- Fixed: after `done` event, fetches new HTML via `/api/article?slug=X&part=html` and updates editor in place
- User sees the rewritten article immediately without any navigation

**2. Pipeline: Non-overview sections no longer open with repeated background facts** (`writer.py`)
- Previously: every section's first sentence restated "CUET UG 2026 has 50 questions, CBT mode, 13 languages, 23 domain subjects..."
- Fixed: added explicit rule to the NARRATIVE FLOW block (section_index > 0 path):
  sections must open with content SPECIFIC to their heading, not a restatement of exam-wide facts
- These background facts belong ONLY in the overview/key-facts section (index 0)

**3. Outliner: Banned fabricated weightage column names** (`config/prompts/outline_prompt.txt`)
- Previously: Gemini generated columns like "Expected Weightage" and "Weightage (%)" for syllabus sections,
  which forced the writer to invent percentages (e.g., "75-80% numerical questions for Physics")
- Fixed: added Rule 12 explicitly banning "Expected Weightage", "Weightage (%)", "Approximate Weightage", "Topic Weightage"
- Exception: if research has official published percentages, a Weightage column is allowed — but only for rows with real data; all others say "Not published"

---

## 2026-03-31 — Repetition Fix: Exam Guide Outline & Template — COMPLETE ✅

### Problem
CUET Math Syllabus article had 3 consecutive sections all using "Parameter | Details" columns.
The writer filled all three with the same rows (Exam Mode, Duration, Marking Scheme, Syllabus Basis).
Student reads the same table three times in a row. Root cause: Gemini ignored template columns and
defaulted to the catch-all "Parameter | Details" format for every table section.

### 3 files changed
**`config/templates/exam_guide.yaml`**
- Section 1 (overview): keeps `Parameter | Details` — but annotated as the ONLY section allowed to use this format
- Section 2 (exam structure): `Section | Total Questions | Questions to Attempt | Max Marks | Duration` (mandatory, not generic)
- Section 3 (syllabus): `Unit/Topic | Key Subtopics | Type (Core/Applied) | Chapter Count` — removed "Approximate Weightage (%)" column (CUET doesn't publish weightages → was forcing fabrication)
- Added 8th section: Official Resources table for PDF links, mock tests, official portals
- Comments in YAML explain WHY each column structure is required

**`config/prompts/outline_prompt.txt`**
- Added Rule 11: "Parameter | Details" limited to ONE section per article
- Explicit exam_guide column requirements showing ✓ correct vs ✗ wrong formats
- Explanation of WHY (prevents the 3-repeated-table failure mode)
- Clarified "template for format reference" means YAML syntax — columns ARE mandatory

**`src/writer.py`**
- Extended NO REPETITION RULE: explicitly calls out "Parameter | Details" — banned after first use
- Added: rows already in earlier sections (Exam Mode, Duration, etc.) MUST NOT reappear

---

## 2026-03-31 — Post-Write Accuracy Checker (checker.py) — COMPLETE ✅

### What it does
After all sections are written, Gemini reads the full article and cross-checks every factual claim
against the research index. Returns {find, replace} patches — applied to HTML programmatically.
Non-blocking: if Gemini fails, original article is used unchanged.

### What it catches
1. Impossible scores (CUET cutoff > 250, JEE > 300, NEET > 720)
2. Unsupported exam structure (specific question counts not in research)
3. Invented topic weightages (no exam publishes these — LLM makes them up)
4. Wrong book recommendations (Spivak, Rudin, Zill etc. for Class 12 prep)
5. Fabricated table data (Avg Package in a CUET admissions table)
6. Overconfident syllabus claims ("does not include Class 11")
7. Unconfirmed dates missing "Expected:" prefix

### 2 files changed
**`src/checker.py`** (new) — ArticleChecker class:
- `_build_facts_summary()` — compact verified-facts block from research_index
- `_build_math_constraints()` — derives max scores from marking_scheme + known exam maxima
- `_build_wrong_books_hint()` — scans HTML for known problematic book titles
- `_apply_fixes()` — applies find/replace patches with exact + case-insensitive fallback
- Saves `checker_report.json` alongside article for every run (transparent audit trail)
- Fully non-blocking: any error returns original article unchanged

**`src/writer.py`** — hooks checker into `write_article()`:
- Import + initialize ArticleChecker in Writer.__init__
- After all sections assembled, call checker.check_and_fix() before file save
- Logs number of fixes applied
- Stores accuracy_check stats in meta.json {issues_found, fixes_applied, skipped}

---

## 2026-03-31 — Fundamental Accuracy Fix (Content Generator) — COMPLETE ✅

### Problem
CUET Mathematics article audit found 8 errors: impossible cutoff score (270/400 when max is 250),
invented "computer awareness" weightage, wrong Section B question counts, international university
textbooks recommended for Class 12 exam prep, and more. Root cause: a contradiction in writer.py
instructions — "never guess" (Rule A) was overridden by "never leave a blank cell, write the correct
factual answer" (Rule B), causing LLM to fill gaps with hallucinated training knowledge.

### 3 files changed

**`src/writer.py`**
- Added `PROTECTED FACTS — ZERO TOLERANCE FOR ERRORS` block (applies to ALL content types):
  - Math sanity check: score/cutoff must be ≤ total_questions × marks (CUET max = 250, not 400)
  - Exam structure (section counts, question distribution): only from research, never guessed
  - Subject/topic weightages: never invent percentages; most exams don't publish these
  - Book recommendations: India-only prep books (Arihant/MTG/NCERT etc.) — never international university textbooks
  - Syllabus scope: no absolute claims like "does not include Class 11" — use hedged language
  - Dates: "Expected:" prefix required for unconfirmed dates
- Added exception clause to "INSTEAD OF PLACEHOLDERS" rule:
  For quantitative exam data (scores, question counts, cutoffs) → DELETE THE ROW, do NOT guess

**`src/indexer.py`**
- Added 3 new extraction categories to `_build_index_prompt`:
  - `exam_sections`: captures official section structure with total_questions, questions_to_attempt, max_score
  - `cutoff_scores`: score-based cutoffs (CUET etc.) with max_possible_score for sanity checking
  - `books_resources`: only books explicitly named in research snippets (never inferred)
- Added all 3 to `key_fields` dedup map
- Added exam-specific keywords to `keyword_category_map` in `build_section_index`
- Added SPECIAL RULES for these categories: impossible scores not extracted, no book inference

**`src/researcher.py`**
- Expanded `exam_guide` type queries: 6 new targeted queries for official information bulletin,
  section-wise question distribution, marking scheme, best prep books India
- Added PDF queries for exam_guide content type (information bulletin filetype:pdf, official syllabus PDF)
  so NTA/official documents are prioritized in research

---

## 2026-03-31 — Pipeline Bug Fix: College Name Abbreviation

### Problem
Topic "SRM Institute of Science and Technology (SRMIST)" generated article titled "What IT is, Key Facts & Why IT Matters".
Gemini extracted "IT" from "Institute of Technology" instead of using the parenthetical abbreviation "SRMIST".

### Fix (1 file: `outline_prompt.txt`)
- **Abbreviation rule**: When topic includes parenthetical like (SRMIST), use that exact abbreviation in headings. Never re-extract letters from the institution name.
- **Bare college name structure**: If primary_intent = "general" AND content_type = "college_profile", use fixed 8-section college overview order: Overview → Courses & Fees → Admission → Fee Structure → Placements → Rankings → Campus Life → How to Apply.

### File changed
`/Volumes/NISHIT_PD/content-generator/config/prompts/outline_prompt.txt`

---

## 2026-03-31 — Competitor Analysis vs Writesonic / Profound

### What we have vs competitors (summary)
Content Studio is ~60-70% of Writesonic-level AEO. Key gaps identified:

**Missing entirely:**
- AEO Overview Dashboard (Brand Presence KPIs + leaderboard + visibility trend chart)
- Action Center (prioritized fix list with effort/impact ratings)
- Sentiment themes drill-down (theme → AI response cards)
- Visibility score history / trend chart (area chart over weeks)
- Date range filters across all AEO views
- Content AEO Optimizer / GEO Score for existing articles
- Agent Analytics (AI bot visits to site)
- Guided Article Writer wizard (multi-step like Writesonic Article Writer)

**Partial (need upgrade):**
- Missed Opportunities (have list, need prompt × competitor table format)
- Platform-wise visibility (have chart, missing trend arrows + historical data)
- Citation categorization (have domains, missing Earned/Owned/Social tags)

Full roadmap with 9 features across 3 phases written in CLAUDE.md → AEO Enhancement Roadmap.

---

---

## 2026-03-31 — Data-Driven Outline (Fabrication Fix) — COMPLETE ✅

### Root cause
Outline was created from competitor H2s + templates BEFORE the research index was built. Writers then had to fill table sections (Exam Pattern, Previous Year Analysis) with no real data → fabricated numbers.

### 4 files changed across the Python pipeline

**`indexer.py`**
- 3 new extraction categories: `exam_pattern`, `year_wise_data`, `eligibility_criteria`
- New keyword mappings: "pattern", "exam", "question", "marks", "duration" → `exam_pattern`; "previous year", "trend", "cutoff" → `year_wise_data`
- Subject filtering for `exam_pattern`: only returns entries where `subject` matches article topic words (prevents cross-subject row contamination like Nursing rows in a Chemistry article)

**`outliner.py`**
- `ResearchIndexer.build_index()` now runs BEFORE the outline LLM call (step 5b)
- Field-level availability tracking: 8 fields tracked per category (`total_questions`, `per_section_questions`, `per_section_time`, `per_section_marks`, `time_minutes`, `marking_scheme` for exam_pattern; `year`, `registrations`, `cutoff_score`, `difficulty` for year_wise_data)
- Generates `data_availability` summary (FOUND vs NOT FOUND at category + field level) injected into outline prompt
- `_downgrade_unfillable_tables()` method runs after outline generation with 3 checks:
  1. Thin index check: < 3 data lines → force to prose
  2. Column-vs-missing-fields: if ≥ 50% of table column names keyword-match missing fields → downgrade to prose
  3. Exam pattern reformat: if `per_section_time`/`per_section_questions` are missing AND first column is "Section/Subject/Test" → rewrite columns to `["Parameter", "Details"]` with rows_target=8

**`outline_prompt.txt`**
- New `DATA AVAILABILITY` section injected before "LIVE SEARCH INTENT SIGNALS"
- Rule: only create TABLE sections for categories listed under DATA FOUND; never fabricate per-section numbers, year-by-year data, or cutoff scores if those fields are NOT FOUND

**`writer.py`**
- Table column rule tightened: "HTML table with EXACTLY these columns — no more, no fewer"
- NO EXTRAPOLATION rule: only create rows for entities explicitly in research — do not add years/colleges/exams not in the index
- `generate_faqs()` now accepts `research_index: dict | None` parameter
- VERIFIED FACTS block built from structured index (exam_pattern entries, admission_schedules, year_wise_data) and injected into FAQ prompt BEFORE the raw research summary
- Rule: if a specific number is not in VERIFIED FACTS, say "check official NTA website" instead of guessing

### Results (verified on CUET Chemistry Syllabus article)
| Issue | Before | After |
|---|---|---|
| Exam Pattern table | Fabricated per-section Q/Marks/Time columns (data didn't exist) | `Parameter \| Details` format with real aggregate data (50Q, CBT, +5/−1) |
| Previous Year Analysis | Fabricated years 2019–2021 (CUET started 2022) | `Year \| Metric \| Value` with real data only (5,70,869 registrations 2025) |
| Eligibility table | Nursing row + templatized rows | Topic-specific CUET criteria, no cross-subject contamination |
| FAQ incorrect dates | Wrong last dates, wrong exam duration | Exam dates from verified index; duration caveats where data conflicts |

---

## 2026-03-31 — Qwen Fix + Library Auto-Refresh + Resume + Sources

### ALL COMPLETE ✅

**Qwen writer reliability fix** (`src/llm_client.py`)
- Timeout increased 90s → 200s — Qwen3-235B needs more time for long sections
- Retries increased from 2 to 5 attempts (delays: 5s, 15s, 30s, 45s)
- Qwen now has its own semaphore (`_writer_semaphore`) separate from Gemini — Gemini extraction calls no longer block section writers
- Quality unaffected — same model, same prompts, just more time and attempts

**Content Library auto-refresh** (`content-studio-dashboard.tsx`, `content-generator-tab.tsx`, `content-library-tab.tsx`)
- Dashboard holds `libraryRefreshKey` counter
- Generator tab calls `onArticleGenerated()` on every done event: single mode, each bulk item, news mode
- Library tab re-fetches article list whenever `refreshKey` changes — new article appears automatically with date

**Resume paused bulk runs** (`content-generator-tab.tsx`)
- ▶ Resume button shown on any past run where `done < total` (and no batch currently running)
- Fetches run's items, filters out already-done ones, starts generation for pending articles only
- Auto-names new run `"Resume: <original name>"`, switches to Bulk tab to show live progress

**Sources .txt download** (`src/app/api/article/route.ts`, `content-generator-tab.tsx`, `content-library-tab.tsx`)
- New `GET /api/article?slug=X&part=sources` endpoint reads `research.json`, returns plain-text file
- File contains: article name + date, numbered source list (title + URL), all search queries used
- "Sources (.txt)" option added to Download dropdown on every article in both Content Generator and Content Library

---

## 2026-03-31 — Bulk Run Persistence + Article Rewrite + Fix Section

### ALL COMPLETE ✅

**Bulk Run Persistence**
- `db.ts` — new `bulk_runs` table + `createBulkRun`, `updateBulkRun`, `listBulkRuns`, `getBulkRun`, `deleteBulkRun` helpers
- `api/bulk/route.ts` — GET (list/get runs), PATCH (update run as items complete), DELETE (remove run), POST extended to handle JSON `createRun` action
- `content-generator-tab.tsx` — "Run Name" input field (auto-filled with date + count), run created in DB on start, per-item snapshot saved after each article finishes, "Past Runs" section below tracker shows all previous batches (expandable with full per-article report, delete button)

**Article Rewrite**
- `api/rewrite/route.ts` (NEW) — POST `{sectionHeading, sectionHtml, instruction, topicContext, qualityIssues}` → calls OpenRouter kimi-k2.5 with strict guardrails → returns rewritten section HTML
- Both `content-library-tab.tsx` and `content-generator-tab.tsx` now have a "↺ Rewrite" button in the article header (shown blue/primary for grade D articles). Opens a panel with quality issues as context chips + instructions textarea + inline SSE progress bar.

**Fix a Section**
- Both tabs now have a "Fix a Section" collapsible panel below the editor. Lists all h2/h3 sections parsed from the article HTML. Click any section to expand an instruction input. Submitting calls `/api/rewrite` and splices only that section's HTML, then auto-saves. Guardrail warning shown inline: "Only this section will be changed."

---

## 2026-03-31 — Bug Fixes + Content Features

### ALL 4 TASKS COMPLETE ✅

**Task 1 — Outline generation crash fix** (`src/outliner.py`)
- `KeyError: 'heading'` crash when Gemini returned a section with `title:` or `name:` key instead of `heading:`
- Fix: 3-line fallback added at start of section loop — tries `title`, then `name`, then generates `"{topic} — Section N"` before any downstream `sec["heading"]` access
- Affected: any topic where Gemini varied its YAML key names (e.g. "CUET Math Syllabus")

**Task 2 — Content Library filter fix** (`content-library-tab.tsx` + `news_writer.py`)
- News articles were counted under "other" pill but filtered OUT when you clicked it — filter used raw `content_type` (`""`) while type-count pills used `|| "other"`
- Fix: filter now uses `(a.content_type || "other")` to match pill logic
- News writer meta now includes `"topic": title` and `"content_type": "news_article"` so new news articles get their own "News Article" type pill
- Existing news articles on disk now correctly appear under "other" pill

**Task 3 — Article download** (`content-generator-tab.tsx` + `content-library-tab.tsx`)
- Download button added to article header in both Content Generator and Content Library
- 3 formats: HTML (clean standalone file with embedded CSS), Word (.doc, Word-compatible HTML with BOM), PDF (opens print window, save as PDF from browser)
- Download always uses currently edited content (includes unsaved edits)
- Button appears top-right of article header with chevron dropdown

**Task 4 — Retry on error** (`content-generator-tab.tsx`)
- Single mode: `↺ Try Again` button added to error banner — re-runs with same topic/keywords
- Bulk mode per-item: `↺ Retry` button on each failed row (visible when batch not running)
- Bulk mode summary: `Retry N Failed` button in completion card when errors > 0 (alongside "New Batch")
- `startBulkGeneration` accepts optional `rowsOverride?: BulkRow[]` param so retry functions pass only failed rows

---

## 2026-03-31 — AEO Navigation Overhaul + SEMrush Competitor Intel

### ALL 3 TASKS COMPLETE ✅

**Task 1 — DataForSEO keyword research** (`src/app/api/aeo/competitor-research/route.ts`)
- Removed homepage HTML fetch (was 12s+)
- Now calls DataForSEO `keywords_for_site` → real Google organic keywords + volumes (~3s)
- AI (kimi-k2.5) only generates 15 conversational AI grounding prompts
- Fallback: if DataForSEO not configured → AI-estimated keywords + amber warning banner
- Total time: ~5s instead of 45s+

**Task 2 — SEMrush-style competitor entry screen** (`src/components/dashboard/tabs/aeo-tab.tsx`)
- Competitor Intel → Website Intelligence shows landing screen when no sites analyzed yet
- "You" field pre-filled from brand config website
- Up to 3 competitor rows (add/remove)
- "Run competitor analysis" button → all sites fetched in parallel (Promise.allSettled)
- After analysis: site chips + keyword table + "↩ New analysis" link

**Task 3 — Unified sidebar navigation** (`content-studio-dashboard.tsx` + `aeo-tab.tsx`)
- Main left sidebar now contains the full AEO sub-tree (no more inner AEO sidebar)
- Clicking "AEO & SRO" expands tree with all 12 sub-items in 3 groups + chevron indicator
- Clicking any sub-item sets both main tab and AEO sub-tab simultaneously
- `AeoTab` is now a pure content panel — accepts `subTab` + `setSubTab` as props
- `SubTab` type and `NAV_GROUPS` exported from aeo-tab.tsx for use in dashboard

---

## 2026-03-30 — AEO Intelligence Upgrade

### ALL 8 TASKS COMPLETE ✅

**Task 1** — `src/app/api/aeo/competitors/route.ts` (NEW)
- GET route. Returns brandSov%, per-competitor SOV%, byProvider breakdown, gapPrompts[], promptMatrix[]

**Task 2** — `src/components/dashboard/tabs/aeo-tab.tsx`
- New "Competitor Intel" sub-tab (13th entry in sidebar under Intelligence)
- SOV bar chart, competitor drill-down, gap prompts, full prompt matrix table
- Visibility Analytics KPI cards upgraded with better labels + SOV as primary metric

**Task 3** — `src/app/api/aeo/suggest/route.ts` (NEW)
- POST route. Calls OpenRouter kimi-k2.5 with brand config → 20 prompts in 4 intent groups

**Task 4** — `src/app/api/aeo/volume/route.ts` (NEW) + `src/lib/server/db.ts`
- Volume API calls DataForSEO for search volume per prompt phrase
- DB: added `volume_data` column to `aeo_prompts`, `updatePromptVolume()` helper

**Task 5** — `src/components/dashboard/tabs/aeo-tab.tsx`
- Prompt Hub: ✨ Suggest button + modal (grouped by intent, checkboxes, Add Selected)
- Fetch Volumes button → volume badges per prompt (e.g. 12.4K/mo ↑)
- List/By Intent toggle → cluster view groups prompts by intent (comparison/awareness/pricing/reviews/feature)

**Task 6** — `src/app/api/aeo/accuracy/route.ts` (NEW) + `src/lib/server/db.ts`
- Accuracy API: POST runId → OpenRouter checks AI response vs brand config → flags hallucinations
- DB: added `accuracy_flags` column to `aeo_runs`, `updateRunAccuracy()` helper

**Task 7** — `src/components/dashboard/tabs/aeo-tab.tsx`
- Responses panel: accuracy badge per card (✓ accurate / ⚠ N issues / — unchecked [Check])
- "Issues Only" filter toggle
- Expanded card shows accuracy issues inline

**Task 8** — `src/app/api/audit/route.ts` + `src/components/dashboard/tabs/aeo-tab.tsx` + `src/lib/server/sro-types.ts`
- Audit route: after 20 checks, calls OpenRouter to generate SWOT + top 3 fixes
- UI: SWOT 2×2 grid (colour-coded) + prioritised fix cards shown below score ring

---
AEO & SRO tab fully built — 11 sub-tabs (vertical sidebar nav), all API routes done.
Configuration tab unified — Brand & AEO section added alongside Project Settings, API Keys, Writing Rules, Industry Presets.
Build passes with zero TypeScript/build errors. Dev server running on localhost:3000.

## 2026-03-30 — AEO & SRO Full Integration — COMPLETE ✅

### API routes (all built)
- ✅ `src/app/api/aeo/config/route.ts` — GET/POST brand config
- ✅ `src/app/api/aeo/prompts/route.ts` — GET/POST/DELETE prompts
- ✅ `src/app/api/aeo/runs/route.ts` — GET list + DELETE (supports ?limit=)
- ✅ `src/app/api/aeo/scrape/route.ts` — SSE streaming, runs all prompts × selected providers via BrightData, computes visibility scores, saves to DB, emits per-result events with drift detection
- ✅ `src/app/api/aeo/analyze/route.ts` — POST type=battlecards|niche|fanout via OpenRouter (kimi-k2.5); GET/DELETE for battlecards
- ✅ `src/app/api/aeo/schedule/route.ts` — GET returns schedule + drift alerts; POST updates schedule or dismisses alert

### Server libs (all built)
- ✅ `src/lib/server/brightdata-scraper.ts` — BrightData AI scraper for 6 platforms (ChatGPT, Perplexity, Copilot, Gemini, Google AI, Grok), answer extraction, source filtering, visibility score computation
- ✅ `src/lib/server/db.ts` — aeo_brand_config, aeo_prompts, aeo_runs, aeo_battlecards, aeo_schedule, aeo_drift_alerts tables + all helpers

### UI (aeo-tab.tsx) — 11 sub-tabs, vertical sidebar nav
- ✅ Sidebar redesigned: vertical grouped nav (Audit Tools / Brand Tracker / Intelligence) instead of horizontal scroll bar
- ✅ AEO Audit — crawl URL, 20 checks, score 0-100
- ✅ SRO Analysis — 5-stage SSE (Gemini → SERP → scrape → context → LLM)
- ✅ Prompt Hub — add/delete prompts, provider picker (6 providers), SSE run with live progress log + brand config warning
- ✅ Responses — filter by provider/mention, expandable cards with answers + source links
- ✅ Visibility Analytics — KPI cards, sentiment bar chart, per-provider score chart, CSV export
- ✅ Citations — domain-grouped citation frequency
- ✅ Opportunities — domains cited in "brand not mentioned" responses
- ✅ Battlecards — generate + browse AI competitive analysis cards (OpenRouter)
- ✅ Fan-Out — persona-based prompt variants (OpenRouter)
- ✅ Niche Explorer — niche AI-search question generation (OpenRouter)
- ✅ Automation — schedule toggle, interval picker, drift alert dismissal

---

## 2026-03-30 — Configuration Tab Unified ✅

### What was changed
- ✅ **Brand & AEO section added** to `configuration-tab.tsx` as a 5th section alongside Project Settings, API Keys, Writing Rules, Industry Presets
- ✅ **Pre-filled with FindMyCollege defaults** — brand name, aliases, website, industry, keywords, description, competitors. Defaults only show if nothing saved yet.
- ✅ **Status chips** — shows which fields are filled (Brand Name, Website, Keywords, Competitors, Description)
- ✅ **Brand Settings removed from AEO sidebar** — no longer duplicated in two places. AEO Prompt Hub shows a warning banner if brand not configured, pointing to Configuration → Brand & AEO
- ✅ Sidebar nav groups reorganised: Brand Tracker group (Prompt Hub, Responses, Analytics, Citations, Opportunities)

### Files changed
`src/components/dashboard/tabs/configuration-tab.tsx`, `src/components/dashboard/tabs/aeo-tab.tsx`

---

## 2026-03-30 — Insight Charts from Researched Data

### What was built
- ✅ **`_generate_article_charts()` (writer.py)** — one Gemini call after article assembly. Uses research summary + article plain text to generate 1-2 charts that show something the tables DON'T already show (fee vs package ROI, ranking trend, score-to-seats ratio, etc.). Returns `<cs-chart>JSON</cs-chart>` blocks embedded in the article HTML.
- ✅ **`renderInsightCharts()` (both frontend tabs)** — detects `<cs-chart>` blocks, parses the JSON, renders as SVG bar chart with title and y-label. Shows at bottom of article before disclaimer.
- Charts are genuinely derived/cross-table insights — not repetitions of visible table data.

### Files changed
`writer.py`, `content-generator-tab.tsx`, `content-library-tab.tsx`

---

## 2026-03-30 — Smarter Dedup + Chart Deduplication

### Repetition fix (writer.py)
- ✅ **Data-value-based checker** — `_llm_check_sections` now finds repeated DATA VALUES (₹ amounts, rankings, percentages, seat counts) across sections rather than repeated sentences. Different sentences, same number = caught.
- ✅ **Anchor-based patching** — replacement searches for the `<p>` containing the duplicate value string (not exact sentence match), so patches reliably land even when sentences differ
- ✅ **Higher limits** — 20 patches max (up from 8), 28000 char budget (up from 18000), 6000 token response (up from 4000)

### Chart fix (content-generator-tab.tsx + content-library-tab.tsx)
- ✅ **One chart per data type** — `generateBarChart` now tracks which column types (fee, salary, rank, score, seats) already have a chart via a `usedColTypes` Set. Same column type in table 2, 3, 4 → no redundant chart
- ✅ **More column types** — added rank/nirf, score/percentile, seats/intake to chart detection (previously only salary/fee/package)

### Files changed
`writer.py` (gas-split), `content-generator-tab.tsx`, `content-library-tab.tsx`

---

## 2026-03-30 — Global Banned Facts Brain (writer.py)

### What was built
- ✅ **`_extract_global_banned_facts()`** — ONE Gemini call fires before any section writes. Reads the research summary and extracts the 10-12 "structural overview facts" specific to this topic — the facts so fundamental that every parallel section writer would independently want to state them as background context. Returns a JSON list of short fact-phrases.
- ✅ **Injected into outline dict** — `outline["_global_banned_facts"]` threads to every section via the existing outline parameter with zero signature changes.
- ✅ **Hard ban in every prompt** — `_build_section_prompt` reads the list and injects a `GLOBALLY BANNED FACTS` block into EVERY section's prompt (intro + all body). Each fact gets a ✗ marker. Section writers must check every paragraph against the list before writing.
- This is the "brain" — shared knowledge extracted once, enforced in all 12 parallel section writers simultaneously.

### Three-layer defense now in place
1. **Global banned facts** (before writing) — topic-specific structural facts extracted from research, banned everywhere
2. **Full repeat ban prompt** (during writing) — every paragraph checked against intro + global ban list
3. **LLM checker** (after writing) — catches anything that slipped through, rewrites with unique content

### File changed
`src/writer.py` (Python, gas-split repo)

---

## 2026-03-30 — Full Repeat Ban + LLM Checker Agent (writer.py)

### Problem diagnosed
CUET article: "13 languages, 23 domain subjects", "NCERT Class 12 curriculum", "language test, domain-specific subject exams", "50 questions, 250 marks, 60 minutes" all repeated verbatim across 5-6 sections. Old fix only banned the FIRST sentence opener — repetition was happening in 2nd and 3rd paragraphs too.

### Two-layer fix
1. **Prompt: Full repeat ban** (`_build_section_prompt` intro_block) — BANNED IN EVERY PARAGRAPH (not just opener): structural overview facts, count stats, structure summaries, basis statements, exam mode, marking scheme. Rule: every paragraph must contain at least one fact not in the intro.
2. **LLM Checker** (`_llm_check_sections`) — post-processing pass after all sections finish. One Gemini call scans all prose, finds repeated facts, returns JSON patches, rewrites (not deletes) duplicate paragraphs with unique content. Fully silent, zero extra UI.

### File changed
`src/writer.py` (Python, gas-split repo)

---

## 2026-03-30 — LLM Checker Agent (writer.py)

### What was built
- ✅ **`_llm_check_sections()`** — Silent post-processing pass added to `ArticleWriter`. After all sections finish writing in parallel, ONE Gemini call scans all prose paragraphs across sections, identifies repeated facts/stats/sentences, and returns surgical patches (JSON) to REWRITE (not delete) the duplicate paragraphs with unique content. Applied before final assembly. User sees zero latency indicator — it runs transparently in the pipeline.
- How it works: strips prose from each section → labels by heading → sends to Gemini at temp=0.1 → parses patch JSON → applies replacements surgically to the `<p>` tags → logs how many were fixed
- Tables and lists are never touched
- If Gemini returns no patches (no duplicates found), no changes applied
- If JSON parse fails, original sections preserved (safe fallback)

### File changed
`src/writer.py` (Python, gas-split repo)

---

## 2026-03-30 — Tab switching no longer kills generation

- ✅ **Generation survives tab switches** — `content-studio-dashboard.tsx` was unmounting inactive tabs (conditional `renderTab()`). All 4 tabs now render simultaneously; inactive tabs are hidden with `hidden` CSS class. SSE connection, progress state, and job tracking stay alive when switching tabs.

### File changed
`src/components/dashboard/content-studio-dashboard.tsx`

---

## 2026-03-30 — Anti-Repetition Prompt Fixes (writer.py)

### Problems fixed
- ✅ **Banned "India has X,XXX+" opener** — hardcoded MBA example in `_build_section_prompt` was training every section to open with this country-count pattern. Replaced example + added explicit BANNED OPENER rule for all body sections.
- ✅ **Duplicate table check** — body sections now forbidden from reusing the same [Rank/College/NIRF/Fee/Package] column set that the intro already contains.
- ✅ **Identical column check** — new rule: if 80%+ of rows share the same value in a column (e.g. same recruiters, same "100%" placement), delete that column. Prevents uniform filler cells.

- ✅ **`UnboundLocalError: _re`** — `write_article` used `_re.sub` at lines 1228-1229 (intro stripping) but also had `import re as _re` at line 1296, making Python treat `_re` as a local variable for the entire function. Fixed by removing the redundant local import (module-level `_re` on line 15 already covers it).

### File changed
`src/writer.py` (Python, in gas-split repo)

---

## 2026-03-30 — Content Quality + Generator Fixes

### Bugs fixed
- ✅ **Sub-keywords stuck** — `main.py` `write --topic` was hardcoding `sub_keywords=""`. Now reads `SUB_KEYWORDS` + `ARTICLE_REGION` env vars set by Content Studio.
- ✅ **Pipeline path** — Fixed `/Users/nishitkumar/...` → `/Volumes/NISHIT_PD/gas new/gas-split/content-generator` in `pipeline.ts` + `article/route.ts`.
- ✅ **Python binary** — Fixed to `/usr/bin/python3` via `PYTHON_BIN` constant.

### Content quality improvements
- ✅ **section_prompt.txt** — Added NO REPETITION block (stop re-defining topic in every section) + DATA COVERAGE block (force 8+ row tables, real numbers, mixed formats).
- ✅ **image/route.ts** — Richer FLUX.1 cover prompt: photo-realistic, campus/students, natural lighting, magazine quality.

### New features
- ✅ **Article Type dropdown** — 8 types (college_profile, ranking_list, fee_reference, exam_guide, career_guide, comparison, cutoff_data, informational) + auto-detect. Passed as `ARTICLE_TYPE` env var to Python.
- ✅ **Custom Outline** — Collapsible textarea. Paste section headings to guide article structure. Passed as `CUSTOM_OUTLINE` env var.

### Files changed
`src/main.py` (Python), `pipeline.ts`, `generate/route.ts`, `content-generator-tab.tsx`, `section_prompt.txt`, `image/route.ts`

---

## 2026-03-30 — Speed + Quality (round 2)

### Speed improvements (estimated ~65s saved per article)
- ✅ **Skip per-section deep research** (`writer.py`) — was firing 1 You.com batch per section (12 sections = ~36 extra API calls). Now skipped by default. Re-enable with `DEEP_SECTION_RESEARCH=1` env var.
- ✅ **Search concurrency 5 → 12** (`search_client.py` + `pipeline.ts`) — reads `SEARCH_CONCURRENCY` env var. Halves research phase time with 17 You.com keys.
- ✅ **Stagger delay 0.5s → 0.1s** (`writer.py`) — saves ~5s on 12-section articles.

### Quality improvement — no more repetitive content
- ✅ **Intro-first writing** (`writer.py`) — intro section now writes first (serial), then all body sections write in parallel. Body sections receive the intro's full text as a hard constraint: "DO NOT repeat what the intro already said." This eliminates the #1 cause of sections re-defining the topic.
- ✅ **`intro_html` context** added to `_build_section_prompt` and `_write_single_section`.

### Files changed
`writer.py` (Python), `search_client.py` (Python), `pipeline.ts`

---

## 2026-03-29 — Phase 7: Performance Analytics Dashboard

### What was built
1. **DB schema** — `analytics_connections` table (OAuth tokens, property selection, email) + `analytics_cache` table (1-hour TTL) + 8 helper functions
2. **OAuth flow** — `/api/analytics/auth` (initiate OAuth, list connections, list properties, save property, disconnect) + `/api/analytics/callback` (handle Google/Microsoft OAuth redirects, exchange code for tokens)
3. **GA4 Data API** — `/api/analytics/ga4` with 5 metrics: overview (sessions/users/pageviews/bounce), timeseries (daily traffic), pages (top 50), sources (channel breakdown), countries
4. **GSC API** — `/api/analytics/gsc` with 6 metrics: overview (clicks/impressions/CTR/position), timeseries (daily search), queries (top 100 keywords), pages (top 100), countries, devices
5. **Bing Webmaster API** — `/api/analytics/bing` with 6 metrics: overview, timeseries, keywords, pages, crawl stats (crawled/indexed/errors), backlinks
6. **Dashboard rewrite** — Complete replacement of dashboard-tab.tsx:
   - Welcome header with content stats (articles, words) always visible
   - 3 connection cards (GA4, GSC, Bing) with one-click OAuth + property picker modal
   - KPI cards: sessions, pageviews, search clicks, avg position
   - SVG area charts with hover tooltips for traffic + search performance time series
   - Top search queries table (15 rows, color-coded positions)
   - Traffic sources breakdown with progress bars
   - Top pages table with traffic bars
   - 3-step getting started guide for new users
   - Date range selector (7d / 28d / 90d)
   - All data cached 1 hour, auto-refreshes expired OAuth tokens

### Files: 1 modified (`db.ts`), 5 new (`auth/route.ts`, `callback/route.ts`, `ga4/route.ts`, `gsc/route.ts`, `bing/route.ts`), 1 rewritten (`dashboard-tab.tsx`)

### Env vars needed
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google Cloud OAuth2 client (enable GA4 Data API + Search Console API)
- `BING_CLIENT_ID` + `BING_CLIENT_SECRET` — Microsoft app registration

---

## 2026-03-29 — Phase 6: Dashboard Page

### What was built
- **Dashboard tab** (`src/components/dashboard/tabs/dashboard-tab.tsx`) — NEW
- **Stats cards** — total articles (with HTML count), total words (with avg/article), avg quality (with graded count), content types (with most common type)
- **Quality Distribution** — horizontal bar chart: A+/A/B+/B/C/D grade counts with colored bars + grade circles
- **Content Types** — horizontal bars showing article count per type (top 8)
- **Recent Articles** — last 5 articles with title, type badge, word count, quality grade; click navigates to Content Library
- **Setup Checklist** — live checks against DB: Gemini, HuggingFace, You.com, WordPress, country/language, first article; progress bar X/6
- **Quick Actions** — Generate Article, Browse Library, Configuration buttons
- **Stats API enhanced** — `getStats()` returns `setup` object with boolean flags for configured providers
- **Default tab** changed from Configuration to Dashboard

### Files: 1 new (`dashboard-tab.tsx`), 2 modified (`db.ts`, `content-studio-dashboard.tsx`)

---

## 2026-03-29 — Phase 5: Content Library Page

### What was built
- **Content Library tab** (`src/components/dashboard/tabs/content-library-tab.tsx`) — NEW
- **Stats bar** — 4 cards: total articles, total words, avg quality, content types
- **Full-width search** — multi-term, own row with large padding
- **Sort** — newest/oldest/highest quality/most words
- **Grid/List toggle** — 3-column cards or compact table
- **Type pill filters** + **Grade filters** (A+/A/B+/B/C/D) with counts
- **Grid cards** — type badge, quality grade circle, title, word/table/section counts, relative dates, hover delete
- **List table** — title, type, words, tables, grade, date, hover delete
- **Delete articles** — confirmation overlay/inline, calls DELETE API, removes folder from disk
- **Article detail** — back button, 4-tab view (Preview, Quality Report, Sections, Outline)
- **Full editor** — Edit/Source/Preview modes, formatting toolbar, image insert, save to disk
- **Cover image** — paste URL or FLUX.1 auto-generate
- **WordPress publish** — draft/publish with result links
- **Article DELETE API** — `DELETE /api/article?slug=...` removes folder recursively

### Files: 1 new (`content-library-tab.tsx`), 2 modified (`article/route.ts`, `content-studio-dashboard.tsx`)

---

## 2026-03-29 — Phase 4: Bulk Generation + News Pipeline

### What was built
1. **Bulk Generation** — upload .xlsx or add rows manually, editable table (topic/keywords/category/region), auto-generate sub-keywords via DataForSEO, live tracker with timers/stages/ETA
2. **News Pipeline** — 3rd tab, discover news from 55+ RSS sources, watch custom topics (auto-creates Google News RSS), suggested feeds (7 categories incl. Reddit), per-item generate button
3. **News Python pipeline** — `news` command (not `write`), 800-1200 words, single Gemini call, competitor scraping, tweet/YouTube/PDF embeds
4. **Bulk API** — xlsx parser + DataForSEO keyword generation
5. **News API** — source CRUD, RSS discovery, suggestions, custom topic feeds
6. **Sub-keywords** now reach Python pipeline via `SUB_KEYWORDS` env var
7. **SSE keepalive** — heartbeat every 15s prevents timeout

### Files: 2 new (`bulk/route.ts`, `news/route.ts`), 3 modified (`db.ts`, `pipeline.ts`, `content-generator-tab.tsx`)

---

## 2026-03-29 — Phase 3: Content Generator Page

### What was built
1. **Python pipeline bridge** — subprocess with unbuffered stdout → structured SSE events
2. **SSE generate endpoint** — real-time article generation with DB tracking
3. **Content Generator tab** — topic input, 7-stage progress bar, cancel support
4. **Article list** — 591 articles browsable with search, type filter, pagination
5. **Article viewer** — 4-tab view (Preview, Quality Report, Sections, Outline)
6. **Rich editor** — Edit/Source/Preview modes, contentEditable WYSIWYG, formatting toolbar
7. **Data charts** — SVG bar charts from table data (salary, fees, packages)
8. **Cover image** — paste URL or FLUX.1 auto-generate
9. **WordPress publishing** — draft/publish with cover image upload
10. **Article save** — save edits back to disk
11. **Content analysis strip** — 6 metrics (grade, readability, data density, fact check, tables, FAQ)

### API routes added
`POST /api/generate` (SSE), `GET/PUT /api/article`, `POST /api/publish`, `POST /api/image`

### E2E verified
"Scope of BCA in India" — 3,221 words, 6 tables, 15 API calls, 83.1s, Quality B (79.7/100), 99% facts verified

---

## 2026-03-29 — Phase 2: Server Foundation + Configuration

### What was built
1. **Next.js 16 project** — TypeScript, Tailwind v4, dark/light theme (30+ CSS vars)
2. **SQLite DB** — sessions, config, api_keys, content, jobs, writing_rules, news_sources tables
3. **Session middleware** — cookie-based, httpOnly, auto-creation, 30-day TTL, default seeding
4. **5 API routes** — config, keys, rules, health, stats
5. **Configuration page** — project settings, API keys (11 providers with structured forms), writing rules (banned phrases, AI replacements, quality thresholds), industry presets (9), country/language selector
6. **FindMyCollege defaults** — 60+ config values, 23 API keys, 55 RSS feeds, all writing rules seeded from .env.local
7. **API key health testing** — Gemini, HuggingFace, You.com, WordPress, YouTube
