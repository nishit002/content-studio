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
- Python pipeline will be called via subprocess from API routes (not built yet)
- SSE (Server-Sent Events) for real-time generation progress (not built yet)
- SQLite for config, content library, job tracking

## Key files
- `src/lib/server/db.ts` — SQLite schema, all DB helpers (config, keys, rules, content, stats)
- `src/lib/server/session.ts` — Session middleware + seedDefaults() that loads all env vars
- `src/lib/server/pipeline.ts` — Python subprocess bridge, spawns content-generator, parses stdout→SSE events
- `src/app/api/keys/route.ts` — API key CRUD (GET masked, GET?raw=true unmasked, POST, PUT, DELETE)
- `src/app/api/config/route.ts` — Config key-value store
- `src/app/api/rules/route.ts` — Writing rules CRUD
- `src/app/api/health/route.ts` — API key health testing
- `src/app/api/stats/route.ts` — Dashboard stats
- `src/app/api/generate/route.ts` — SSE endpoint for article generation (POST starts, GET polls job)
- `src/app/api/article/route.ts` — Article artifacts (GET list/detail, PUT save edits)
- `src/app/api/publish/route.ts` — Publish to WordPress (POST with title/content/slug)
- `src/app/api/image/route.ts` — FLUX.1 image generation via HuggingFace
- `src/components/dashboard/tabs/configuration-tab.tsx` — Config page (all sections)
- `src/components/dashboard/tabs/content-generator-tab.tsx` — Content Generator: input, pipeline progress, article viewer/editor
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

## Pages to build (4 total)
1. **Dashboard** — stats, recent activity, quick-start
2. **Content Generator** — single article, bulk, news pipeline
3. **Content Library** — browse/search/view/manage generated content
4. **Configuration** — API keys, writing rules, presets, templates, news sources, publishing

## Current phase
Phase 3 complete. Next: Phase 4 — Bulk Generation & News Pipeline

## API providers managed in UI (11 total)
Core: Gemini, HuggingFace, You.com (required)
Publishing: WordPress, Supabase
SEO: Google Ads (Keyword Planner), DataForSEO, SerpAPI
Media: YouTube, Google Indexing, Image Gen (FLUX.1)

Each provider has structured add/edit forms with proper labeled fields (not pipe-delimited text).
Keys stored server-side in SQLite, masked in UI, raw values only fetched for edit mode.

## Config values that matter
- `default_country` — country code (IN, US, etc.)
- `content_languages` — comma-separated languages for research & writing (e.g. "English,Hindi")
- `wp_site_url`, `wp_username`, `wp_app_password` — WordPress publishing
- `supabase_url`, `supabase_service_role_key` — Supabase publishing
- All LLM settings (gemini_model, writer_model, temperatures, etc.)
