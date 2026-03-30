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
- Backend: Python content-generator (at /Users/nishitkumar/Documents/gas-split/content-generator/)
- AI: Gemini Flash, Qwen3-235B (HuggingFace), You.com Search
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

## Key files
- `src/lib/server/db.ts` — SQLite schema, all DB helpers (config, keys, rules, content, stats, news)
- `src/lib/server/session.ts` — Session middleware + seedDefaults() that loads all env vars
- `src/lib/server/pipeline.ts` — Python subprocess bridge: `runPipeline()` for regular articles, `runNewsPipeline()` for news, `discoverNews()` for RSS fetching. Keepalive heartbeat every 15s.
- `src/app/api/keys/route.ts` — API key CRUD (GET masked, GET?raw=true unmasked, POST, PUT, DELETE)
- `src/app/api/config/route.ts` — Config key-value store
- `src/app/api/rules/route.ts` — Writing rules CRUD
- `src/app/api/health/route.ts` — API key health testing
- `src/app/api/stats/route.ts` — Dashboard stats + setup checklist
- `src/app/api/generate/route.ts` — SSE endpoint for article generation (POST starts, GET polls job). Supports `type: "news"` for news pipeline.
- `src/app/api/article/route.ts` — Article artifacts (GET list/detail, PUT save edits, DELETE remove)
- `src/app/api/publish/route.ts` — Publish to WordPress (POST with title/content/slug)
- `src/app/api/image/route.ts` — FLUX.1 image generation via HuggingFace
- `src/app/api/bulk/route.ts` — Xlsx upload parser (POST) + DataForSEO keyword generation (PUT)
- `src/app/api/news/route.ts` — News source CRUD, RSS discovery, feed suggestions, custom topic watching
- `src/components/dashboard/tabs/dashboard-tab.tsx` — Dashboard: performance analytics, OAuth connections, KPI cards, time series charts, top queries/pages/sources
- `src/components/dashboard/tabs/content-generator-tab.tsx` — Content Generator: single/bulk/news modes, pipeline progress, article viewer/editor
- `src/components/dashboard/tabs/content-library-tab.tsx` — Content Library: grid/list browse, search, sort, filters, article detail/edit/publish, delete
- `src/components/dashboard/tabs/configuration-tab.tsx` — Config page (all sections)
- `src/components/dashboard/types.ts` — Provider definitions, presets, content types
- `src/components/dashboard/content-studio-dashboard.tsx` — Main dashboard layout + tabs

## Rules Claude must follow
1. Never touch more than 3 files per task
2. Always read files before assuming what is in them
3. Always write a plan before writing code
4. After every task, update PROGRESS.md
5. Stop and ask if the task feels too large
6. NEVER make things client-side — always server-side API routes
7. Every feature needs session validation
8. After /clear, ALWAYS read CLAUDE.md and PROGRESS.md before doing anything

## Pages (4 total — all built)
1. **Dashboard** — Performance analytics hub: welcome header with content stats, GA4/GSC/Bing OAuth connection cards, KPI cards (sessions, pageviews, clicks, position), SVG time series charts with tooltips, top search queries, traffic sources, top pages, getting started guide for new users, date range selector (7d/28d/90d) (Phase 7)
2. **Content Generator** — 3 modes: Single Article, Bulk Generate (xlsx upload + DataForSEO keywords), News Pipeline (RSS discovery + news-specific generation). 7-stage live progress bar, rich article editor, cover image gen, WordPress publish (Phase 3-4)
3. **Content Library** — grid/list views, full-width search, sort (newest/oldest/quality/words), type + grade filters, article detail with 4-tab view (preview/quality/sections/outline), rich editor, publish, delete articles (Phase 5)
4. **Configuration** — API keys (11 providers) with structured forms, writing rules, presets, country/language selector, news sources (Phase 2)

## Current phase
Phase 7 complete. All 4 pages fully functional. Dashboard rebuilt with performance analytics. Default tab: Dashboard.

## Active issues (2026-03-30)
- Python pipeline path was wrong — fixed to `/Volumes/NISHIT_PD/gas new/gas-split/content-generator`
- Python binary was wrong — fixed to `/usr/bin/python3` via `PYTHON_BIN` constant in pipeline.ts
- Sub-keywords stuck: `write --topic` in main.py ignores `SUB_KEYWORDS` env var (hardcodes `""`) — fix: read env var
- Cover image too generic — FLUX.1 prompt needs topic/type context
- Content quality: intro lines repeated in body, needs stronger prompt anti-repetition rules
- Planned: article type selector + custom outline input in Content Generator UI

## API routes (18 total)
- `GET/POST /api/config` — config key-value store
- `GET/POST/PUT/DELETE /api/keys` — API key management
- `GET/POST/PUT/DELETE /api/rules` — writing rules
- `GET /api/health` — API key health testing
- `GET /api/stats` — dashboard stats + setup checks
- `POST /api/generate` (SSE) — article generation with streaming
- `GET/PUT/DELETE /api/article` — article CRUD + list
- `POST /api/publish` — WordPress publishing
- `POST /api/image` — FLUX.1 image generation
- `POST/PUT /api/bulk` — xlsx upload + DataForSEO keywords
- `GET/POST/DELETE /api/news` — news source management + RSS discovery
- `GET/POST/DELETE /api/analytics/auth` — OAuth flow initiation, property selection, disconnect, list connections
- `GET /api/analytics/callback` — OAuth callback handler (Google + Microsoft)
- `GET /api/analytics/ga4` — GA4 traffic data (overview, timeseries, pages, sources, countries)
- `GET /api/analytics/gsc` — Search Console data (overview, timeseries, queries, pages, countries, devices)
- `GET /api/analytics/bing` — Bing Webmaster data (overview, timeseries, keywords, pages, crawl, backlinks)

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
All phases built with zero TypeScript/build errors. Phases 2-7 completed 2026-03-29.

## Analytics env vars
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google Cloud OAuth2 client
- `BING_CLIENT_ID` + `BING_CLIENT_SECRET` — Microsoft app registration
