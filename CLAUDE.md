# Project: Content Studio

## What this is
A unified web platform for AI content generation that works for ANY industry.
Wraps the Python content-generator pipeline (from gas-split repo) in a modern GUI.
Server-side architecture, session-based. No client-side API calls.

## Owner
Nishit — not a coder. Explain everything simply.
Ask before touching more than 3 files at once.
Always make a plan in plain English before writing code.

## Single session strategy
I prefer to work in one continuous chat. To make this safe:

1. After completing each task, always do a mini-reset:
   - Update PROGRESS.md
   - Run /clear to clean the conversation context
   - Then read CLAUDE.md and PROGRESS.md again fresh
   - Confirm you are ready for the next task

2. This gives me a fresh context window without opening
   a new session. The files on disk are our memory,
   not the conversation history.

3. Never hold more than one completed task in active memory.
   Finish → write to disk → clear → reload → continue.

## Current stack
- Frontend: Next.js 16, TypeScript, Tailwind v4
- Backend (CG): Python content-generator at `/Volumes/NISHIT_PD/content-generator/`
- Backend (ATLAS): Python smart-writer at `/Volumes/NISHIT_PD/content-studio/smart-writer/`
- AI: Gemini 2.5 Flash, Qwen3-235B (HuggingFace), You.com Search, OpenRouter (kimi-k2.5)
- Storage: SQLite (server-side via better-sqlite3), cookies (session)
- Deploy: Vercel
- GitHub: nishit002/content-studio

## Architecture
- ALL logic server-side (Next.js API routes)
- Session via httpOnly cookies (auto-created, 30-day TTL)
- New sessions seeded with complete FindMyCollege production config from .env.local
- Python pipeline called via subprocess from API routes (`runPipeline()` + `runNewsPipeline()`)
- SSE (Server-Sent Events) for real-time generation progress streaming
- SQLite for config, content library, job tracking
- Article files stored on disk in Python output folder (`content-generator/output/{slug}/`)
- URL routing via `useSearchParams` + `router.replace` — every module has a deep-link URL, no page reload

## Key files
- `src/lib/client/cover-image.ts` — `composeCoverImage(bgUrl, title)`: canvas utility, draws background + gradient + title text, returns 1200×630 JPEG data URL
- `src/lib/server/db.ts` — SQLite schema + ALL DB helpers (config, keys, rules, content, stats, news, aeo_*)
- `src/lib/server/session.ts` — Session middleware + seedDefaults()
- `src/lib/server/pipeline.ts` — Python subprocess bridge
- `src/lib/server/sro-types.ts` — AuditReport, SROResult, LLMAnalysisResult types
- `src/lib/server/sro-pipeline.ts` — Gemini grounding, SERP, page scraper, SRO analysis (OpenRouter)
- `src/lib/server/brightdata-scraper.ts` — BrightData AI scraper for 6 platforms + visibility score computation
- `src/app/api/audit/route.ts` — AEO audit (POST, no auth deps, pure HTML fetch + checks)
- `src/app/api/sro/route.ts` — SRO analysis SSE pipeline (POST)
- `src/app/api/aeo/config/route.ts` — Brand config GET/POST
- `src/app/api/aeo/prompts/route.ts` — Prompts GET/POST/DELETE
- `src/app/api/aeo/scrape/route.ts` — SSE streaming, prompts × providers via BrightData, drift detection
- `src/app/api/aeo/runs/route.ts` — GET list (supports ?limit=), DELETE single or all
- `src/app/api/aeo/analyze/route.ts` — POST battlecards/niche/fanout (OpenRouter kimi-k2.5); GET/DELETE battlecards
- `src/app/api/aeo/schedule/route.ts` — GET schedule+alerts, POST update schedule or dismiss alert
- `src/app/api/aeo/competitors/route.ts` — GET competitor SOV, gap prompts, prompt matrix
- `src/app/api/aeo/suggest/route.ts` — POST brand config → 20 suggested prompts grouped by intent
- `src/app/api/aeo/volume/route.ts` — POST prompt list → DataForSEO search volume per prompt
- `src/app/api/aeo/accuracy/route.ts` — POST runId → OpenRouter accuracy check → flags hallucinations
- `src/app/api/aeo/competitor-research/route.ts` — GET/POST/DELETE competitor keyword research (DataForSEO keywords_for_site + AI prompts)
- `src/app/api/rewrite/route.ts` — POST single-section rewrite via OpenRouter (kimi-k2.5); guardrails prevent scope creep
- `src/components/dashboard/tabs/aeo-tab.tsx` — AEO & SRO tab: pure content panel (no inner sidebar), exports SubTab + NAV_GROUPS
- `src/components/dashboard/tabs/configuration-tab.tsx` — 5-section config: Project, API Keys, Writing Rules, Presets, Brand & AEO
- `src/components/dashboard/content-studio-dashboard.tsx` — Main layout: unified left sidebar with AEO sub-tree, URL routing (useSearchParams + router.replace), passes subTab/setSubTab to AeoTab

## Rules Claude must follow
1. Never touch more than 3 files per task
2. Always read files before assuming what is in them
3. Always write a plan before writing code
4. After every task, update PROGRESS.md
5. Stop and ask if the task feels too large
6. NEVER make things client-side — always server-side API routes
7. Every feature needs session validation
8. After /clear, ALWAYS read CLAUDE.md and PROGRESS.md before doing anything

## Pages (5 total — ALL COMPLETE)
1. **Dashboard** — Performance analytics hub: GA4/GSC/Bing OAuth, KPI cards, SVG charts, top queries/pages/sources
2. **Content Generator** — Single/Bulk/News modes, 7-stage progress, editor, cover image, WordPress publish
3. **Content Library** — grid/list browse, search, sort, filters, editor, publish, delete
4. **AEO & SRO** — ✅ COMPLETE. Vertical sidebar nav with 12 sub-tabs: AEO Audit, SRO Analysis, Prompt Hub, Responses, Visibility Analytics, Citations, Opportunities, Competitor Intel, Battlecards, Fan-Out, Niche Explorer, Automation
5. **Configuration** — ✅ COMPLETE. 5 sections: Project Settings, API Keys (11 providers), Writing Rules, Industry Presets, Brand & AEO (pre-filled with FindMyCollege data)

## Current phase
Login is DONE. Next: signup module + admin panel.
See PROGRESS.md → NEXT for pending tasks.

## Login module (COMPLETE — 2026-04-07 session 5)
- `/login` — username + password + math CAPTCHA
- Credentials: `fmcteam` / `fmccontent123`
- `src/middleware.ts` — blocks all routes; allows `/login` + `/api/auth/`
- Token: static pre-computed string (NOT HMAC — Edge Runtime doesn't support `crypto.createHmac`)
- `VALID_TOKEN` must match in BOTH `src/middleware.ts` AND `src/app/api/auth/login/route.ts`
- Logout: `GET /api/auth/logout` (linked from dashboard header)
- **DO NOT use crypto.createHmac in middleware** — Edge Runtime only has Web Crypto API

## CG outliner fix (COMPLETE — 2026-04-07 session 5)
- `outline_prompt.txt` has literal `{entity}`, `{exam}` etc. examples → Python `.format()` crashed every outline
- Fix: `_safe_prompt()` in `content-generator/src/outliner.py` escapes unknown placeholders before `.format()`
- `import re` added at top level of `outliner.py`

## ATLAS previous runs panel (COMPLETE — 2026-04-07 session 5)
- `GET /api/article?atlasRuns=true` — reads `runs.json`, returns all runs with checkpoint progress
- Single ATLAS tab shows panel with status badges + View/Resume/Retry buttons
- Resume works because atlas.py auto-resumes any non-done run for the same topic
- Stage 8 (writing) resumes per-section: loads existing `.html` checkpoints, writes only missing sections

### What was completed (2026-04-07) — ATLAS + CG article quality hardening
- **ATLAS entity validation fix** — acronym generator skips stop words (RUHS not RUOHS); was causing 61/89 pages to fail validation → thin 500-word articles. Now pages with RUHS/BHU/IIT abbreviations pass correctly.
- **No TOC** — removed `<nav class="toc">` from ATLAS article output (`stage10_coherence.py`)
- **Concise headings** — section headings changed from sentence-style statements to 5-12 word keyword/topic phrases across ATLAS (`stage7_outline.py`), CG (`outline_prompt.txt`), and News (`news_prompt.txt`)
- **Direct opening paragraph** — first `<p>` after each heading must jump to the key fact, not re-introduce the institution (`stage8_write.py` rule 9)
- **Default year = 2026** — ATLAS no longer defaults to null year; 2026 used when topic doesn't specify (`stage1_blueprint.py`)
- **Dead run cleanup** — runs 004 + 006 marked failed in runs.json (dead processes cleaned up)
- All fixes deployed to EC2 (content-studio + content-generator both pulled)

## content-generator repo (NEW — 2026-04-06)
- GitHub: nishit002/content-generator (private)
- EC2 path: `/home/ubuntu/content-generator/`
- Local path: `/Volumes/NISHIT_PD/content-generator/`
- Deploy: `git push origin main` from local, then on EC2: `cd /home/ubuntu/content-generator && git pull origin main`
- Auth for EC2 git pull: use `gh auth token` on Mac to get token, embed in remote URL
- `.env` on EC2: copied from content-studio `.env.local` (same keys)
- Local data files NOT in git (gitignored): `data/tracker.db`, `input/news.xlsx`, `input/articles.xlsx`

## EC2 deploy procedure (updated 2026-04-06)
```bash
# content-studio changes:
git push origin main   # from /Volumes/NISHIT_PD/content-studio/
ssh -i ~/content-studio-key.pem ubuntu@13.51.193.49
cd /home/ubuntu/content-studio && git pull origin main
NODE_OPTIONS="--max-old-space-size=1536" npm run build  # only if .tsx/.ts changed
pm2 restart content-studio

# content-generator changes:
git push origin main   # from /Volumes/NISHIT_PD/content-generator/
ssh -i ~/content-studio-key.pem ubuntu@13.51.193.49
TOKEN=$(gh auth token)  # on Mac first, then paste into EC2 remote URL
cd /home/ubuntu/content-generator && git pull origin main
# No restart needed — pipeline.py spawns Python fresh each time
```

AEO Enhancement Phase — queued after ATLAS stabilises.

## Active issues
None. Build is clean, zero TS errors, dev server runs on localhost:3000.
Python pipeline path: `/Volumes/NISHIT_PD/content-generator/` (NOT Documents/gas-split)

## Content-generator pipeline — key files
- `src/researcher.py` — You.com query builder (intents, official sites, PDF queries)
- `src/indexer.py` — Gemini extracts structured data from research into research_index.json
- `src/outliner.py` — Gemini creates YAML outline from research + template + intent map
- `src/writer.py` — Qwen writes sections in parallel; calls checker after all sections done
- `src/checker.py` — NEW: Gemini post-write accuracy check; finds & fixes errors before save
- `config/prompts/outline_prompt.txt` — Full outline generation rules (abbreviations, column uniqueness, blueprint columns mandatory, research_query rules)
- `config/prompts/system_prompt.txt` — Writer system prompt
- `config/templates/exam_guide.yaml` — Section structure for exam/syllabus articles (differentiated columns)
- `config/templates/college_profile.yaml` — Section structure for college profile articles
- `config/intent_maps.yaml` — Blueprint section structures per intent (exam_info, syllabus, etc.); columns here are MANDATORY — Gemini must use them, not fall back to Parameter|Details

## Content-generator pipeline flow (6 steps)
1. **Research** (`researcher.py`) — You.com fetches based on topic + intent + content type
   - Intents: exam_info / syllabus / placement / ranking / fees / cutoff / admission / career_scope
   - Smart fallback: exam topics get exam queries; college topics get placement/fees queries
   - Official site queries: nta.ac.in for CUET/JEE/NEET, nirfindia.org for rankings, josaa.nic.in for cutoffs
   - PDF queries for information bulletins, placement reports, official notifications
2. **Index** (`indexer.py`) — Gemini extracts all facts from research into structured categories:
   - colleges, fees, placements, cutoffs, rankings, courses, admission, scholarships, salaries
   - exam_sections (official Q counts + attempt limits), cutoff_scores (score-based with max), books_resources
   - RULES: impossible cutoff scores NOT extracted; books only if explicitly in research
3. **Outline** (`outliner.py`) — Gemini creates section plan using template + research + intent map
   - Rule: "Parameter | Details" table format limited to ONE section per article
   - Exam guide: section 2 must use `Section | Total Q | Q to Attempt | Max Marks | Duration`
   - Exam guide: section 3 must use `Unit/Topic | Key Subtopics | Type | Chapter Count` (no fake weightage %)
4. **Write** (`writer.py`) — Qwen writes all sections in parallel, each with research index + section data
5. **Check** (`checker.py`) — NEW: Gemini validates the full article against research index:
   - Impossible scores caught (CUET max=250, JEE max=300, NEET max=720)
   - Invented weightages removed
   - International books replaced with NCERT + India prep series
   - Fabricated table data flagged (e.g., "Avg Package" in a CUET admissions table)
   - Saves checker_report.json alongside article for audit trail
   - Non-blocking: if Gemini fails, original article saved unchanged
6. **Post-process** (`post_processor.py`) — HTML cleanup, banned phrases, quality score

## CG pipeline H1 title rules (2026-04-03) — DO NOT UNDO
Baked into `content-generator/config/prompts/outline_prompt.txt` and `content-generator/src/outliner.py`.

**Banned title patterns** (added to outline_prompt.txt, enforced by `_sanitize_h1_title()` in outliner.py):
- `"{entity}: Overview, Key Highlights & Why IT Matters"`
- `"{entity}: What It Is, Key Facts & Why It Matters"`
- `"{entity}: Types, Categories & Key Components Explained"`
- `"{entity}: Complete Guide"`, `"Everything You Need to Know"`, etc.
- Any title where "it" is capitalised as "IT" unless IT is explicitly in the topic

**`_sanitize_h1_title(title, topic, content_type, year)`** — module-level function in outliner.py:
- Runs on every outline after parse (catches both Gemini output and fallback outlines)
- Matches against `_GENERIC_TITLE_PATTERNS` list
- Detects wrong "IT" capitalisation (e.g. "IIM Indore" → "Why IT Matters" = wrong)
- Replaces with structured `_FALLBACK_TITLE_TEMPLATES[content_type]`

**YAML colon fix** — regex in outliner.py now covers `title:` lines (was only `heading:` before):
- Fixes: `title: IIM Indore: Courses & Fees` → `title: "IIM Indore: Courses & Fees"` (valid YAML)
- Without this, any title with a colon caused YAML parse failure → fallback outline → worse title

## ATLAS data accuracy rules (2026-04-03) — DO NOT UNDO
These are baked into stage5_extract.py and stage6_verify.py. They exist because bare numbers without context (e.g. "₹12.23 lakh" with no course/duration) are useless and cause reader confusion. Fees accuracy is a critical ranking factor.

**Stage 5 contextual extraction rules:**
- Fees: must include programme name + annual/semester/total duration + academic year. BAD: "₹12.23 lakh" GOOD: "₹3.07 lakh per year for B.Tech (2024-25)"
- Packages: must include batch year + avg/median/highest qualifier + branch if stated
- Dates: confirmed vs tentative/expected must be noted
- Rankings: must include ranking body (NIRF/QS/Times) + year + category
- Conflicting sources: both values logged in extraction_notes; official site value used in data{}

**Stage 6 context-aware verification rules:**
- Verifies context AND number together — number alone is insufficient
- "₹3.07 lakh" with no course/duration in value → verified=false
- "₹3.07 lakh total" when source says "annual" → verified=false
- Conflict detection: two different values in same source → verified=false, both logged
- source_snippet must quote full sentence (not just the number)
- Table context_note appended to table title so writer knows what the table covers
- Data 2+ years old: "(data from [year] — may be outdated)" appended

## Accuracy rules baked into pipeline (2026-03-31)
These protect against the most common factual errors. Claude must not undo them.

**Math sanity (writer + checker):**
- Any score/cutoff > mathematical max for that exam → blocked
- CUET: 50 × 5 = 250 max. JEE Main: 90 × 4 = 300. NEET: 180 × 4 = 720.

**Protected data types (writer):**
- Exam structure (section counts, Q per section) — only from research, never guessed
- Subject/topic weightages — never written unless research explicitly states the %
- Book recommendations — India-only: NCERT, Arihant, MTG, Oswaal, RD Sharma, HC Verma etc.
  NEVER recommend international university textbooks (Spivak, Rudin, Zill, Apostol etc.)
- Syllabus scope — no absolute "does not include Class 11"; use "primarily based on Class 12 NCERT"
- Dates — unconfirmed dates must have "Expected:" prefix

**No repetition (outline + writer):**
- "Parameter | Details" catch-all table: max ONE per article
- Each section must use unique columns that no other section already has
- Rows already written in earlier sections cannot reappear in later sections
- Non-overview sections (index > 0) must NOT open with exam-wide background facts (dates, mode, total questions, total marks) — those belong only in Section 1
- Banned column names (outline_prompt Rule 12): "Expected Weightage", "Weightage (%)", "Approximate Weightage", "Topic Weightage" — unless research explicitly has official published percentages

## Pipeline bugs fixed (2026-03-31)
- `outliner.py` — `heading_seed` → `heading` promotion. When a blueprint is provided to Gemini, it echoes back `heading_seed:` from the blueprint but writes `heading: ''` (empty). Writer then gets no section heading and uses the article title for every section (all 8 sections identical). Fix: in `_ensure_fields`, if `heading` is empty and `heading_seed` is non-empty, promote `heading_seed` to `heading` before writer runs.
- `intent_maps.yaml` — `informational/general`: removed ALL `heading_seed` values. Gemini was copying them verbatim (substituting only `{topic}`), producing "DHMS: What It Is, Key Facts & Why It Matters" for every informational article. Now sections have only `purpose` — Gemini must derive headings from research.
- `intent_maps.yaml` — Added `college_profile/general` blueprint (8 sections: Overview → Courses → Admission → Fees → Placements → Rankings → Campus → How to Apply). Before this, `college_profile/general` had no blueprint so Gemini fell back to the informational/general template and produced generic "What It Is" headings for college profiles.
- `outline_prompt.txt` — Added Rule 13: "Research-Derived Headings — mandatory when no heading_seed is provided." Explicit bad/good examples. Headings must contain at least one specific fact from research (NIRF rank, NAAC grade, programme name, fees, etc.).
- `outline_prompt.txt` — Added abbreviation rule: when topic has parenthetical like (SRMIST), use that exact abbreviation in headings, never re-extract letters. Also added bare college name structure: if primary_intent = "general" + content_type = "college_profile" → use fixed 8-section college overview order.
- `outline_prompt.txt` — Rule 12: banned weightage column names ("Expected Weightage", "Weightage (%)" etc.) — prevents Gemini from adding columns that force the writer to invent percentages.
- `outline_prompt.txt` — Added "BLUEPRINT COLUMNS ARE MANDATORY" rule with ✓/✗ examples. Gemini was ignoring `columns:` from intent_maps.yaml and defaulting to `Parameter|Details` for every section, causing identical table structure across the entire article.
- `writer.py` — Non-overview sections (index > 0) must open with content specific to their heading, not exam-wide background facts (dates, mode, total questions). These belong only in Section 1.
- `writer.py` — Added `_dedup_table_rows()` post-write deduplication pass. Sections are written in parallel so each writer independently adds the same rows. After assembly, identical data rows are removed from later tables; empty tables are removed entirely.
- `writer.py` — Added `_build_section_research_query()` to generate unique per-section You.com queries. Previous: `f"{topic} {heading}"[:80]` — for exam articles every heading starts with topic name, truncation makes all queries identical → same You.com results → same rows in every table. Fix: strips topic prefix to extract unique part, falls back to `purpose` field, then columns. Exam-specific targeted queries added per section type (syllabus → nta.ac.in, exam pattern → section-wise marks, etc.).
- `llm_client.py` — Gemini 2.5 Flash thinking model response parsing. `parts[0]` is the internal thinking trace (`"thought": true`), real answer is in `parts[1]+`. Code was reading `parts[0]["text"]` = garbage → JSON parse failed → checker.py silently skipped on EVERY article since day 1. Fix: filter out thought parts and join only real output.
- `llm_client.py` — HF key loading now reads all variants: HF_API_KEY, HF_TOKEN, HF_API_KEYS (comma-sep pool), HF_API_KEY_2..5 — deduped into `self._hf_keys` list with round-robin rotation.
- `llm_client.py` — Model check after HF response: if served model is not Qwen (HF Router silently serves Llama when auth fails), reject and fall through to Gemini fallback.
- `pipeline.ts` — Was setting HF_TOKEN; llm_client.py was reading HF_API_KEY — name mismatch meant hf_key was always None. Fix: now sets both HF_TOKEN and HF_API_KEY; also forwards HF_API_KEYS pool from .env.local.
- `intent_maps.yaml` (exam_info) — Syllabus section: changed blueprint columns from `[Section, Topics, Expected Weightage]` to `[Unit/Topic, Key Subtopics, Type (Core/Applied), Chapter Count]` — eliminates invented weightage percentages.
- `intent_maps.yaml` (exam_info) — Previous Year Analysis: replaced "Difficulty" column (no official source) with `[Year, Registrations, Participating Universities, Qualifying Marks]` — all verifiable.
- `intent_maps.yaml` (exam_info) — Tier 4: replaced "Preparation Strategy / Study Plan / Topper Tips" with "Official Resources: Syllabus PDF, Mock Tests & Important Links" — factual table, stops article from framing everything as competition/prep advice. Added prep-related topics to `rejected_topics`.
- `content-generator-tab.tsx` — Post-generation stats (Words/Tables/API Calls/Quality) showed "—". Root cause: Python emits two `done` SSE events; second overwrote result state. Fix: merge instead of replace.
- `/api/rewrite` — "Fix a Section" was hallucinating because rewrite had zero research data. Now loads `research_index.json` for the article's slug and passes it as VERIFIED RESEARCH DATA in the prompt. Also: `rewriteInstructions` field no longer required — empty box gets smart default instruction.
- `content-library-tab.tsx` — Removed `!rewriteInstructions.trim()` from "Start Rewrite" disabled condition; added smart default instruction when textarea is empty.

## AEO Enhancement Roadmap (next phase — priority order)

### Phase 1 — High ROI (builds on existing data)
1. **AEO Overview Dashboard** — New "Overview" sub-tab as the landing page for AEO & SRO.
   Shows: Visibility % (big KPI), Responses Mentioned, Market Share %, Market Position (#N),
   AI Visibility Leaderboard (brand vs competitors), Visibility trend line chart over time,
   Platform-wise visibility table (ChatGPT/Gemini/Perplexity/Grok/Copilot % with trend arrows).
   Data comes from existing `aeo_runs` table — no new API needed.

2. **Sentiment Themes Drill-down** — Parse AI responses for recurring positive/negative themes.
   Shows: Theme | Sentiment | Occurrences table. Click a theme → see actual AI response cards.
   New API: `GET /api/aeo/sentiment` — aggregates aeo_runs responses via OpenRouter.

3. **Visibility Score History** — Store per-run visibility % over time in DB.
   Area chart showing improvement week-over-week (like Profound's 47.1% chart).
   New DB column: store aggregate visibility per run. Chart in Visibility Analytics sub-tab.

### Phase 2 — New features
4. **Action Center** — AI-generated prioritized fix list.
   Categories: Fix Technical Issues (from AEO Audit), Get External Mentions (from Opportunities),
   Boost Content Visibility (from gap prompts). Each item has Effort (bar) + Impact (High/Med/Low).
   New API: `GET /api/aeo/actions` — aggregates audit + opportunities + gaps into ranked list.

5. **Date Range Filters** — Add date picker across Responses, Visibility Analytics, Citations.
   Filter all AEO views by last 7d / 30d / 90d / custom range.

6. **Missed Opportunities Visual Matrix** — Upgrade current gap prompts into a proper table:
   Prompt | Topic | You (mentions) | Competitor A | Competitor B | Competitor C
   With search box + CSV export. Currently shown as a plain list — needs table format.

### Phase 3 — Bigger builds
7. **Content AEO Optimizer (GEO Score)** — Score existing articles from Content Library for AI-readiness.
   Checks: Content Freshness (last updated), Structure (H2/H3 count), Word count vs ideal,
   FAQ presence, Schema markup, Internal links. Score 0-100 with breakdown.
   New sub-tab under Audit Tools.

8. **Agent Analytics** — Track AI bot visits to the user's site.
   Requires: log file parsing OR Cloudflare Worker integration.
   Shows: Bot visits by AI engine, AI Citations to site, Human Referrals, AI Indexing count.

9. **Guided Article Wizard** — Multi-step flow for Content Generator (like Writesonic Article Writer).
   Steps: Topic → SERP References → Primary Keyword → Title Options → Headings → Generate.
   Replaces the current single-form approach for single article mode.

## Context window note
When context is getting large, tell Nishit: "Context filling — run /clear then re-read CLAUDE.md + PROGRESS.md"

## AEO & SRO tab — sub-tabs (12 total, ALL DONE)
Layout: navigation lives in the MAIN left sidebar (NOT inside AEO tab). Clicking "AEO & SRO" expands a tree with 3 groups.

**Audit Tools**
1. ✅ AEO Audit — crawl URL, 20 checks, score 0-100, SWOT analysis + top 3 fixes (OpenRouter)
2. ✅ SRO Analysis — 5-stage SSE pipeline (Gemini → SERP → scrape → context → LLM)

**Brand Tracker**
3. ✅ Prompt Hub — add/delete prompts, ✨ Suggest modal (20 AI prompts by intent), 📊 Fetch Volumes (DataForSEO), List/By Intent cluster view, SSE run with live log
4. ✅ Responses — filter by provider/mention/issues, accuracy badge per card (✓ accurate / ⚠ N issues), Issues Only toggle, inline accuracy detail
5. ✅ Visibility Analytics — SOV as primary KPI, sentiment bars, per-provider score chart, CSV export
6. ✅ Citations — domain-grouped citation frequency
7. ✅ Opportunities — domains cited in "brand not mentioned" responses

**Intelligence**
8. ✅ Competitor Intel — SOV bar chart vs rivals, per-competitor drill-down, gap prompts, full prompt × competitor matrix → `/api/aeo/competitors`
9. ✅ Battlecards — AI competitive analysis cards → `/api/aeo/analyze`
10. ✅ Fan-Out — persona-specific prompt variants → `/api/aeo/analyze`
11. ✅ Niche Explorer — AI-generated niche queries → `/api/aeo/analyze`
12. ✅ Automation — schedule toggle, interval picker, drift alert list + dismiss

**Brand settings** live in Configuration → Brand & AEO (not in AEO tab — unified for better UX)

## AEO env vars (already in .env.local)
- `BRIGHT_DATA_KEY` — BrightData API key
- `BRIGHT_DATA_DATASET_CHATGPT/PERPLEXITY/COPILOT/GEMINI/GOOGLE_AI/GROK` — dataset IDs
- `OPENROUTER_KEY` — OpenRouter (model: moonshotai/kimi-k2.5 for analyze/suggest/accuracy/swot, google/gemini-2.0-flash-001 for SRO)
- `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` — prompt search volume via `/api/aeo/volume`

## API routes (18 content + 10 AEO — all complete)
- `GET/POST /api/config` — config key-value store
- `GET/POST/PUT/DELETE /api/keys` — API key management
- `GET/POST/PUT/DELETE /api/rules` — writing rules
- `GET /api/health` — API key health testing
- `GET /api/stats` — dashboard stats + setup checks
- `POST /api/generate` (SSE) — article generation with streaming
- `GET/PUT/DELETE /api/article` — article CRUD + list; `?part=sources` returns research sources as .txt file
- `POST /api/publish` — WordPress publishing
- `POST /api/image` — FLUX.1 image generation
- `GET/POST/PUT/PATCH/DELETE /api/bulk` — xlsx upload + DataForSEO keywords; GET/PATCH/DELETE manage named bulk runs (persist to SQLite with progress snapshots)
- `GET/POST/DELETE /api/news` — news source management + RSS discovery
- `GET/POST/DELETE /api/analytics/auth` — OAuth flow initiation, property selection, disconnect, list connections
- `GET /api/analytics/callback` — OAuth callback handler (Google + Microsoft)
- `GET /api/analytics/ga4` — GA4 traffic data (overview, timeseries, pages, sources, countries)
- `GET /api/analytics/gsc` — Search Console data (overview, timeseries, queries, pages, countries, devices)
- `GET /api/analytics/bing` — Bing Webmaster data (overview, timeseries, keywords, pages, crawl, backlinks)
- `GET/POST /api/aeo/config` — Brand config (name, aliases, website, industry, keywords, description, competitors)
- `GET/POST/DELETE /api/aeo/prompts` — Tracking prompts CRUD (now includes volume_data column)
- `POST /api/aeo/scrape` (SSE) — Run prompts × providers via BrightData, stream results with visibility scores
- `GET/DELETE /api/aeo/runs` — Browse/delete scrape run history (now includes accuracy_flags column)
- `GET/POST/DELETE /api/aeo/analyze` — Battlecards, niche queries, fan-out via OpenRouter (kimi-k2.5)
- `GET/POST /api/aeo/schedule` — Schedule config + drift alert management
- `GET /api/aeo/competitors` — Competitor SOV%, gap prompts, prompt × competitor matrix (aggregates aeo_runs)
- `POST /api/aeo/suggest` — AI-generates 20 tracking prompts in 4 intent groups from brand config
- `POST /api/aeo/volume` — Fetches DataForSEO search volume for all tracked prompts, saves to DB
- `POST /api/aeo/accuracy` — Checks AI responses for hallucinations vs brand config (single or batch runIds)
- `POST /api/rewrite` — Rewrites a single HTML section via OpenRouter (kimi-k2.5); strict guardrails keep changes scoped to that section only

## API providers managed in UI (11 total)
Core: Gemini, HuggingFace, You.com (required)
Publishing: WordPress, Supabase
SEO: Google Ads (Keyword Planner), DataForSEO, SerpAPI
Media: YouTube, Google Indexing, Image Gen (FLUX.1)

Each provider has structured add/edit forms with proper labeled fields.
Keys stored server-side in SQLite, masked in UI, raw values only fetched for edit mode.

## Config values that matter
- `default_country` — country code (IN, US, etc.)
- `content_languages` — comma-separated languages for research & writing (e.g. "English,Hindi")
- `wp_site_url`, `wp_username`, `wp_app_password` — WordPress publishing
- `supabase_url`, `supabase_service_role_key` — Supabase publishing
- All LLM settings (gemini_model, writer_model, temperatures, etc.)

## Build history
All phases built with zero TypeScript/build errors.
- CG + ATLAS quality hardening 2026-04-03 (session 3):
  - CG outliner.py: _sanitize_h1_title() catches generic titles post-parse; YAML colon-fix covers title: lines
  - CG outline_prompt.txt: H1 title rules section added (banned patterns + required format per content_type)
  - ATLAS stage5: contextual extraction rules (fees/packages/dates/rankings must carry qualifying context)
  - ATLAS stage6: context-aware verification (checks context + number together; conflict detection; outdated data flags)
  - ATLAS stage7: article_type in outline prompt; _is_generic_title() + _build_fallback_title() safety net
  - /api/article/analyze: new endpoint — independent article analysis before rewrite pipeline
  - Smart rewrite: analyzing state, analysis block prepended as AUTO-DETECTED ISSUES in customOutline
- UI polish + ATLAS writing quality 2026-04-03 (session 2):
  - Rewrite button: double icon fixed in both tabs; instructions no longer mandatory
  - Smart rewrite auto-fill: buildSmartRewriteInstructions() pre-fills textarea with targeted fixes when score < 80
  - Cover image: composeCoverImage() in src/lib/client/cover-image.ts — canvas composites background + title text overlay (1200×630 JPEG)
  - stage9_humanize.py: _polish_intro_outro() — 3 Gemini variants for opening + closing paragraph, best selected
  - stage10_coherence.py: CRITICAL_LABELS + _inject_key_callouts() — auto key-stat callout boxes before data tables, all 7 article types
- ATLAS deep integration + Stage 1 rewrite 2026-04-03 (session 1)
- Phases 2-7 completed 2026-03-29
- AEO & SRO full integration completed 2026-03-30
- Configuration tab unified (Brand & AEO section) 2026-03-30
- AEO tab UI redesigned (vertical sidebar nav) 2026-03-30
- Qwen writer fixed (timeout/retries/semaphore) 2026-03-31
- Content Library auto-refresh + Resume runs + Sources download 2026-03-31
- Content-generator accuracy hardening 2026-03-31:
  - writer.py: PROTECTED FACTS block (math sanity, no invented weightages, India-only books)
  - indexer.py: exam_sections + cutoff_scores + books_resources categories
  - researcher.py: exam_info/syllabus/exam_pattern intents + smart fallback (no more placement queries for exam articles)
  - checker.py: NEW post-write Gemini accuracy checker (find+replace patches, saves checker_report.json)
  - exam_guide.yaml: differentiated column structures per section (no more 3× Parameter|Details)
  - outline_prompt.txt: Rule 11 — Parameter|Details limited to 1 per article; template columns mandatory
- Content writing flow + redundancy fixes 2026-03-31:
  - content-library-tab.tsx: startRewrite now auto-reloads new HTML after pipeline done (was: "open from library")
  - writer.py: non-overview sections banned from opening with repeated exam-wide background facts
  - outline_prompt.txt: Rule 12 — banned weightage column names (Expected Weightage, Weightage %, etc.)
  - /api/rewrite: new endpoint — rewrites a single article section in-place via OpenRouter
  - /api/bulk: GET/PATCH/DELETE added — named bulk runs with SQLite persistence + progress snapshots
- URL routing for all modules 2026-03-31:
  - content-studio-dashboard.tsx: useSearchParams + router.replace — every tab and AEO sub-tab has a deep-link URL
  - src/app/page.tsx: wrapped in Suspense (required by Next.js for useSearchParams)
  - URL scheme: /?tab=dashboard|generator|library|aeo|config — AEO sub-tabs add &sub={key}

## Dev server
Run: `npm run dev` → localhost:3000
If port shows "can't be reached": run `rm -rf .next && npm run dev` (clears Turbopack cache)

## Analytics env vars
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google Cloud OAuth2 client
- `BING_CLIENT_ID` + `BING_CLIENT_SECRET` — Microsoft app registration

---

## Smart Writer — ATLAS Pipeline
Path: `/Volumes/NISHIT_PD/content-studio/smart-writer/` ← lives INSIDE content-studio now
Status: **FULLY INTEGRATED into Content Studio (2026-04-03)**
- Select **✦ ATLAS Smart Writer** toggle at the top of Content Generator tab
- Toggle is universal — applies to Single Article AND Bulk Generate modes
- News Pipeline always uses CG (toggle hidden for news)
- Output articles appear in Content Library + Content Generator list with `✦ ATLAS` badge
- Terminal: `cd /Volumes/NISHIT_PD/content-studio/smart-writer && python3 atlas.py "topic" --use-you-research`
- Old path `/Volumes/NISHIT_PD/smart-writer/` kept as backup — do NOT use it, use the one inside content-studio

### What ATLAS means
ATLAS = Adaptive Topic-Led Article System.
Unlike v1 (generic fetch → extract everything → write), ATLAS builds a topic blueprint first.
Every fetch, every extraction, every section is driven by that blueprint.
Nothing reaches the writer that hasn't been verified against the original source.

### 11-Stage Pipeline (updated 2026-04-03)

**Stage 1 — Topic Blueprint (Python classifier + Gemini)**
- **Python pre-classifies the topic** via `classify_topic()` — 30+ keyword signals, 7 article types
  - `college_profile` — just a college/university name, no specific angle
  - `college_placement` — "placements", "salary", "package", "LPA", "recruiter"
  - `exam_guide` — JEE/NEET/CUET/CAT/GATE or "syllabus", "exam pattern"
  - `ranking_list` — "ranking", "NIRF", "top colleges"
  - `fee_reference` — "fees", "tuition", "cost of"
  - `admission_guide` — "admission", "cutoff", "eligibility"
  - `career_guide` — "career in", "scope of", "jobs after"
- **Structure is hardcoded in Python** — Gemini never chooses sub-topics, only fills them
- Two Gemini calls: (1) entity + year identification (temp=0.1), (2) data_needed + search_queries per section (temp=0.2)
- Saves: `blueprint.json`
- This is the core quality gate — wrong topic type = wrong article forever. Python classifier eliminates that risk.

**Stage 2 — Article Character Research (Gemini + BrightData)**
- DDG searches for 3-5 top-ranking existing articles on the exact same topic
- BrightData fetches them (direct HTTP first, BrightData fallback)
- Gemini analyses: section order, data depth, content character
  (data-heavy / narrative / comparison table / timeline / FAQ-first)
- Saves: `character.json`
- Why: IIM placement article ≠ exam syllabus article ≠ ranking list — character adapts to topic

**Stage 3 — Targeted Source Discovery (per sub-topic)**
- For each sub-topic in blueprint: run specific DDG queries (from blueprint.search_queries)
- Filter: only .gov.in / .ac.in / .nic.in / official institute domains
- Prioritise PDFs (placement reports, annual data) over generic pages
- Dedup URLs across sub-topics
- Saves: `sources.json` (sub_topic_id → list of URLs)

**Stage 4 — Targeted Fetch (BrightData, cached)**
- Fetch each URL (24-hour disk cache at `.cache/pages/`)
- Use BrightData Web Unlocker for PDF / JS-heavy / anti-bot pages
- **Validation**: fetched page text must contain the primary entity name.
  If "IIM Mumbai" article fetches iimb.ac.in (IIM Bangalore) → that page is dropped.
- Saves: fetched pages per sub-topic

**Stage 5 — Sub-topic Extraction (Gemini)**
- For each sub-topic: extract ONLY the data fields blueprint defines
- Targeted extraction = much higher accuracy than "extract everything"
- Saves: `extracted/{subtopic_id}.json` for each sub-topic

**Stage 6 — Data Verification (Gemini)**
- Re-reads the source page text alongside the extracted data
- For each extracted fact: does this number/name/date actually appear in the source? Yes = verified. No = flagged.
- Drops unverified data points entirely — they never reach the writer
- Saves: `verified_data.json` with `verified: true/false` per data point

**Stage 7 — Outline (Gemini)**
- Input: blueprint + character.json + verified_data
- Only creates sections where verified data exists (no empty sections, no invented headings)
- Adds content extensions derived from character research:
  if character = "comparison" → add comparison table column
  if character = "timeline" → add year-wise section
- Word targets: 700-900 per section (total: 5000-7000 words)
- Saves: `outline.json`

**Stage 8 — Section Writing (Llama via LM Studio)**
- Each section receives: verified data block + section insight (from Stage 6 analysis)
- HARD RULE: no verified data for a section = section is dropped, not written from memory
- Target 700-900 words per section, max_tokens 3000
- Format (table/bullet/prose) decided per sub-topic at Stage 1

**Stage 9 — Humanization (Llama)**
- Second Llama pass on each section's prose content (`<p>` tags only, tables untouched)
- Rewrite for natural flow: vary sentence length, remove AI patterns
  ("It is worth noting", "Furthermore", "This highlights", "In conclusion")
- Temperature 0.75
- Saves revised section HTML files to `sections/` (overwrite)

**Stage 10 — Coherence Check (Gemini)**
- Reads the full assembled draft
- Checks: logical section flow, data used correctly, no contradictions, reader queries answered
- Produces: `coherence_report.json` with a pass/fail and list of issues
- Minor issues (missing transition, wrong tense): auto-patched via Llama
- Major issues: flagged for user review
- FAQs validated against article content (answers must exist in the article)
- `_sanitize_html()` final cleanup pass: strips code fences, None cells, empty cells, p-wrapped tables
- `_ARTICLE_STYLE` CSS injected: table borders, typography, TOC box, FAQ styling

**Stage 9 — Humanization (Qwen) — UPDATED 2026-04-03**
- After humanizing all sections, `_polish_intro_outro()` runs:
  - Reads `blueprint.json` for topic + article_type
  - Finds first `<p>` in section[0] (opening) + last `<p>` in section[-1] (closing)
  - One Gemini call per paragraph: generates 3 variants + picks best_index
  - Non-blocking: if Gemini fails, original kept

**Stage 10 — Coherence + Final Assembly (Gemini) — UPDATED 2026-04-03**
- `CRITICAL_LABELS` dict: maps 7 article types → row labels to scan for (avg package, fees, exam date, etc.)
- `_inject_key_callouts()`: finds first table with 2+ matching rows, injects `<div class="cs-highlights">` before it
- CSS: `.cs-highlights`, `.cs-stat`, `.cs-stat-value`, `.cs-stat-label` added to `_ARTICLE_STYLE`
- `run()` reads article_type from `blueprint.json`, passes to `_build_final_html()`

**Stage 11 — Proofread (Gemini) — ADDED 2026-04-03**
- Reads all `<p>` tags from finished article.html, sends in batches of 15 to Gemini
- Fixes: spelling mistakes, garbled PDF/OCR chars (â€™→', â€"→—, Â→removed), basic grammar
- Does NOT touch: numbers, percentages, names, rankings, table data
- Saves backup as `article_pre_proofread.html` before overwriting
- Non-blocking: if Gemini fails, unproofread article is kept as-is
- File: `stage11_proofread.py`

### Key principles
- Data flows top-down: entity → sub-topics → targeted fetch → verified → writing
- If a sub-topic has no verified data after deep search → section is dropped, never invented
- BrightData used surgically: cached, only for pages that block direct HTTP
- Article character adapts to topic type — not one template for everything
- FAQs are generated from actual reader intent (what students search for), not generic questions
- Every article targets 5000-7000 words by default

### Resume system (run IDs)
- Each run gets a numeric ID: 001, 002, 003...
- Output folder: `output/{id}-{slug}/`
- `output/runs.json` tracks all runs: id → topic, status, date, checkpoints reached
- `--resume N`: skip stages already checkpointed
- `--list`: show all runs
- `--force`: ignore all checkpoints, re-run from scratch

### Files per run (output/{id}-{slug}/)
```
blueprint.json              Stage 1 checkpoint
character.json              Stage 2 checkpoint
sources.json                Stage 3 checkpoint
fetched_pages.json          Stage 3 (you-research) checkpoint
extracted/                  Stage 5 checkpoints (one file per sub-topic)
verified_data.json          Stage 6 checkpoint
outline.json                Stage 7 checkpoint
sections/                   Stage 8+9 checkpoints (one HTML file per section)
coherence_report.json       Stage 10 output
article_pre_proofread.html  Stage 11 backup (pre-proofread)
article.html                Final assembled + proofread article
```

### ATLAS credentials (.env in /Volumes/NISHIT_PD/content-studio/smart-writer/)
- `GEMINI_API_KEY` — Gemini 2.5 Flash (all LLM calls in ATLAS)
- `YOU_API_KEYS` — comma-separated pool of 17 You.com keys (research)
- `BRIGHT_DATA_KEY` — `d21a04c7-3ff3-4b95-bc9e-8710e243d632`
- `BRIGHT_DATA_ZONE` — `web_unlocker3studio`
- `HF_API_KEYS` — HuggingFace keys for Qwen3-235B writer
- `HF_MODEL` — `Qwen/Qwen3-235B-A22B`
- `GEMINI_MODEL` — `gemini-2.5-flash`

### Content Studio integration (fully integrated 2026-04-03)
- `src/lib/server/pipeline.ts` — `runAtlasPipeline()` + `parseAtlasLine()`; ATLAS_DIR = `content-studio/smart-writer/`
- `src/app/api/generate/route.ts` — routes `pipeline: "atlas"` to ATLAS
- `src/app/api/article/route.ts` — merges ATLAS runs.json into article list; PUT/DELETE work on both CG + ATLAS dirs; sources download reads sources.json for ATLAS
- `src/components/dashboard/tabs/content-generator-tab.tsx` — universal pipeline toggle (top of tab, Single + Bulk); `cleanArticleHtml()` strips `<style>` tags so ATLAS CSS doesn't leak
- `src/components/dashboard/tabs/content-library-tab.tsx` — ATLAS badge shown; `cleanArticleHtml()` strips `<style>` tags
- `smart-writer/fetcher.py` — entity validation strips commas before matching (fixes "Amity University, Noida" mismatch)
- `smart-writer/stage1_blueprint.py` — Python classifier + fixed sub-topic skeletons (rewritten 2026-04-03)

### ATLAS article_type flow — verified end-to-end (2026-04-06)
This is the complete chain. Every link must stay intact. Do NOT break any part of this.

```
User enters topic (+ optional type dropdown)
  ↓
content-generator-tab.tsx — sends { topic, articleType, pipeline:"atlas" } to POST /api/generate
  (bulk mode: also sends category field from each row as articleType)
  ↓
generate/route.ts — passes { contentType: articleType } to runAtlasPipeline()
  ↓
pipeline.ts runAtlasPipeline() — atlasTypeMap converts UI type to atlas type name
  atlasTypeMap: { college_profile, college_placement, admission_guide, fee_reference,
                  exam_guide, ranking_list, career_guide }
  if articleType is blank → mappedType = undefined → --type NOT passed to atlas.py
  ↓
atlas.py argparse — --type default=None (NOT college_placement — that was the bug)
  if --type passed → use it; if None → classify_topic() reads topic keywords
  ↓
stage1_blueprint.classify_topic(topic, content_type)
  Keyword detection order: exam → placement → fees → ranking → admission → career → college
  "Admission" → admission_guide, "Fees/Course" → fee_reference, "Ranking" → ranking_list
  "Placement" → college_placement, "College name only" → college_profile
  ↓
Blueprint built with correct sub-topics for that article type
  (admission_guide has 7 sub-topics: overview, eligibility, entrance exams,
   selection process, cutoff trends, application steps, important dates)
  ↓
researcher.py builds You.com queries per article_type:
  admission_guide → eligibility, entrance exam, cutoff, counselling queries
  fee_reference   → fee structure, hostel charges, scholarship queries
  ranking_list    → NIRF, ranking parameters queries
  college_placement → salary, placement report, top recruiters queries
  ↓
stage7_outline.py — title validated against article_type via _is_type_mismatch()
  admission article CANNOT get "Placements 2024" title (TYPE_MISMATCH_FORBIDDEN)
  fallback titles baked in _FALLBACK_TITLE_TEMPLATES per type
```

### ATLAS article types — what each does
| Type | Keyword triggers | Sub-topics structure |
|---|---|---|
| `college_placement` | placement, salary, package, recruiters, LPA | stats, salary breakdown, sector, recruiters, dept-wise, YoY, PPO |
| `admission_guide` | admission, cutoff, eligibility, apply, merit list | overview, eligibility, entrance exams, selection, cutoff trends, steps, dates |
| `fee_reference` | fee, fees, tuition, cost of, scholarship | fee overview, programme-wise, hostel, scholarships, payment, comparison |
| `ranking_list` | ranking, NIRF, best college, top college | overview, top colleges list, category rankings, YoY changes, factors, how to use |
| `exam_guide` | jee, neet, cuet, cat, syllabus, exam pattern | overview, eligibility, syllabus, pattern, preparation, dates, past analysis |
| `career_guide` | career, scope of, jobs after, career in | overview, skills, job roles, salary, employers, path, how to enter |
| `college_profile` | university, college, institute (no angle) | overview, courses, admission, fees, placements, rankings, campus, how to apply |

### ATLAS robustness rules (2026-04-06) — DO NOT REVERT
- **`{entity}` escaping** — ANY dynamic content from scraped web (research_summary, verified_summary, page text, extracted data) MUST be escaped with `.replace("{","{{").replace("}","}}")` before being passed to Python's `.format()`. JSON-LD on websites contains `{entity}`, `{value}`, etc. Applies to: stage2, 5, 6, 7, 8 (ATLAS) and outliner.py (CG).
- **Entity validation ≥ 2 occurrences** — `fetcher.py _validate_entity()` requires entity name to appear ≥ 2 times. Compact/acronym checks remain 1-occurrence (they are specific enough).
- **Stage progress regex** — `parseAtlasLine()` in `pipeline.ts` uses `/Stage\s+(\d+)\/1[01]/` to match both `/10` and `/11`. atlas.py prints `Stage N/10`. Do NOT change to `/11` only.
- **SIGTERM handler** — `atlas.py` registers `signal.SIGTERM` handler that updates `runs.json` to "failed" before exit. Do not remove.
- **runs.json stuck as "running"** — if a run shows "running" but process is dead, mark it failed manually: `python3 -c "import json; from pathlib import Path; r=json.loads(Path('output/runs.json').read_text()); r['NNN']['status']='failed'; r['NNN']['error']='killed'; Path('output/runs.json').write_text(json.dumps(r,indent=2))"` — then Restart button appears in UI.

### Known issues fixed (2026-04-06) — DO NOT REVERT
- **atlas.py `--type default="college_placement"`** — argparse default forced every run without explicit `--type` to placement type, overriding `classify_topic`. Fix: `default=None`. (`atlas.py`, `stage1_blueprint.py`)
- **Bulk category not passed to generate API** — `category` field was collected in bulk rows but silently dropped. Fix: pass as `articleType` in fetch body. (`content-generator-tab.tsx`)
- **atlasTypeMap missing admission_guide + fee_reference** — if user selected these from dropdown, they mapped to `undefined` and were ignored. Fix: added to map with full type names. (`pipeline.ts`)
- **Stage progress regex mismatch** — parseAtlasLine() matched `Stage N/11` but atlas.py prints `Stage N/10`. UI stuck at "classifying" for entire run. Fix: regex `/1[01]/`. (`pipeline.ts`)
- **`{entity}` KeyError in `.format()`** — scraped web pages contain JSON-LD `{curly_braces}`. Fixed in stage2, 5, 6, 7, 8 (ATLAS) and `outliner.py` (CG).
- **Entity validation 1-occurrence too loose** — ranking list pages listing entity once in a table row passed. Fix: require ≥ 2 occurrences. (`fetcher.py`)
- **researcher.py missing article-type query patterns** — admission/fee/ranking types had no You.com queries → 0 results → pipeline died silently after Stage 4. Fix: added query patterns for `admission_guide`, `fee_reference`, `ranking_list`. (`researcher.py`)
- **SIGTERM kills process silently** — runs.json stuck as "running" forever, Restart button never appeared. Fix: SIGTERM signal handler updates runs.json before exit. (`atlas.py`)

### Known issues fixed (2026-04-03)
- ATLAS articles not showing in library → runs.json uses relative paths; fixed with `path.join(ATLAS_DIR, runDir)`
- CSS distortion on ATLAS article open → `_ARTICLE_STYLE` leaked into dashboard; fixed by stripping `<style>` in cleanArticleHtml
- Wrong article type (general topic → placement article) → Stage 1 rewritten; Python classifier now owns this decision
- Entity mismatch flood → comma normalization in fetcher.py entity validation

### v1 problems that ATLAS fixes
- Wrong institution: fixed by Stage 4 entity validation
- Wrong article type: fixed by Stage 1 Python classifier (never Gemini's decision)
- Hallucinated tables: fixed by Stage 6 verification + hard block in Stage 8
- Thin content (1452 words): fixed by 700-900 word targets + deep sub-topic research
- No analytical depth: fixed by Stage 6 data analysis producing insights for writer
- AI-sounding text: fixed by Stage 9 humanization pass
- Spelling/OCR garbling: fixed by Stage 11 Gemini proofread pass
