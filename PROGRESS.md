# Progress

## Current State
All 4 pages fully functional. Phases 2-7 complete. Dashboard rebuilt as performance analytics hub. Build passes with zero errors.

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
