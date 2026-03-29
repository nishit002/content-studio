# Progress

## 2026-03-29 — Session 3 (Phase 3: Content Generator — Task 1)

### Completed
- **Python bridge utility** (`src/lib/server/pipeline.ts`):
  - Spawns `python3 -m src.main write --topic "..."` as subprocess
  - Builds full environment from session DB (all 11 API providers mapped to env vars)
  - Parses stdout/stderr line-by-line into structured `PipelineEvent` objects
  - Detects stages: classifying → researching → outlining → writing → post_processing → done/error
  - Captures section-level progress, quality scores, word/table counts
  - Async generator pattern for streaming
- **SSE generate endpoint** (`src/app/api/generate/route.ts`):
  - POST with `{topic, subKeywords?, region?}` → creates job + content row in DB → streams SSE events
  - Each SSE event is a JSON PipelineEvent with jobId + contentId
  - DB updated in real-time as stages progress (pending → outline_ready → writing → done/error)
  - GET fallback for polling job status
- Build passes with zero errors, `/api/generate` route registered

### Files created this task
- `src/lib/server/pipeline.ts` — Python subprocess bridge + stdout parser
- `src/app/api/generate/route.ts` — SSE endpoint for article generation
- `src/components/dashboard/tabs/content-generator-tab.tsx` — Content Generator tab UI

### Files modified this task
- `src/components/dashboard/content-studio-dashboard.tsx` — Wired in ContentGeneratorTab (replaced placeholder)

### What the Content Generator tab includes
- **Topic input form:** Topic (required), sub-keywords (optional), region field, generate/cancel buttons
- **7-stage pipeline progress bar:** Queued → Classifying → Researching → Outlining → Writing → Post-Processing → Done
  - Active stage has spinner + accent ring, completed stages get green checkmarks
  - Error state shows red X with error message
- **Result summary card:** Word count, table count, API calls, quality score, completion time
- **Collapsible event log:** Shows every SSE event with stage badge, message, and timestamp
- **How-it-works tips:** Shown when idle (no generation running)
- **SSE streaming:** Real-time connection to /api/generate, parses events as they arrive
- **Cancel support:** AbortController kills the SSE stream

### E2E Test Result (sample topic: "Scope of BCA in India")
- Pipeline ran end-to-end successfully via SSE
- Stages streamed in real-time: queued → classifying → outlining (career_guide, 8 sections) → researching (661 snippets, research index, deep research) → writing (8 sections, 1622-5594 chars each) → post-processing (3 banned phrases removed) → done
- Final result: **3,221 words | 6 tables | 15 API calls | 83.1s | Quality: B (79.7/100) | Facts: 99% verified**
- Article generated at: `output/scope-of-bca-in-india/scope-of-bca-in-india_v1.html`
- Parser fixes applied: quality score regex (decimals), post-processor detection, outline path vs article path distinction, unbuffered Python output

### Task 3: Article Result View — Completed
- **Article API** (`src/app/api/article/route.ts`):
  - `GET /api/article?slug=...&part=all` — returns HTML + meta.json + outline.yaml from Python output folder
  - `GET /api/article?slug=...&part=html` — returns raw HTML
  - Path traversal protection via slug sanitization
  - YAML parsing via js-yaml
- **Article result view** (added to content-generator-tab.tsx):
  - 4 tabbed panels: Article Preview | Quality Report | Sections | Outline
  - **Preview tab:** Full HTML rendered in scrollable container, title + content type badge + word/table/section counts
  - **Quality tab:** Overall grade (A-F) with progress bar, data density, readability, fact-check rate, content structure, quality issues list, post-processing summary (banned phrases, names redacted, hallucination flags)
  - **Sections tab:** Table of all sections (heading, chars, latency, model), char distribution bar chart with color coding
  - **Outline tab:** Content type + intent + confidence badges, section list with tier indicators (color-coded 1-4), format/priority/columns/targets, user persona with core questions
  - Auto-fetches from `/api/article` when generation completes (extracts slug from articlePath)
- Tested with "Scope of BCA in India" — API returns all data correctly (8 sections, 28KB HTML, quality B/79.7)

### Files created/modified this task
- `src/app/api/article/route.ts` — NEW: article artifact API
- `src/components/dashboard/tabs/content-generator-tab.tsx` — MODIFIED: added 4-tab result view + ArticleMeta types + fetch logic
- `package.json` — js-yaml + @types/js-yaml added

### Task 3b: Article List + Click-to-View — Completed
- **Article list API** (`/api/article?list=true`): Scans Python output folder, reads meta.json from each article directory, returns sorted list (newest first) with title, type, word count, quality grade, etc.
- **Recent Articles section** in Content Generator tab: Shows all 591 previously generated articles with clickable cards
  - Each card shows: title, content type badge, word count, tables, sections, generation time, quality grade circle
  - "outline only" badge for articles without HTML
  - Click any article → loads full result view (Preview, Quality, Sections, Outline tabs)
  - "Back to list" link to return
  - Auto-refreshes list after new article generation
- Files modified: `src/app/api/article/route.ts`, `src/components/dashboard/tabs/content-generator-tab.tsx`

### Task 4: Article Editor + Cover Image + Analysis + WordPress Publish — Completed
- **WordPress publish API** (`src/app/api/publish/route.ts`):
  - POST with title, content, slug, coverImageUrl, status (draft/publish)
  - Reads WordPress credentials from session DB
  - Uploads cover image to WP media library if URL provided
  - Resolves category name to WP category ID
  - Strips H1 from content (WP renders title separately)
  - Returns post_id, post_url, edit_url
- **Article save API** (`src/app/api/article/route.ts` — PUT added):
  - Saves edited HTML back to disk (output/{slug}/article.html)
- **Enhanced ArticlePreview** (content-generator-tab.tsx):
  - **Edit button** → opens HTML source in textarea editor, Save/Cancel buttons
  - **Content Analysis bar** — 6-metric summary: Grade, Readability, Data Points, Fact Check %, Tables, FAQ
  - **Cover Image input** — paste URL, shows preview thumbnail, used when publishing
  - **Publish to WordPress panel** — draft/publish status selector, publish button with spinner, success/error result with view post + edit in WordPress links

### Files created/modified
- `src/app/api/publish/route.ts` — NEW: WordPress publishing endpoint
- `src/app/api/article/route.ts` — MODIFIED: added PUT for saving edits
- `src/components/dashboard/tabs/content-generator-tab.tsx` — MODIFIED: enhanced ArticlePreview

### Task 5: Rich Editor + Auto-Generate Images + Improved UX — Completed
- **Image generation API** (`src/app/api/image/route.ts`):
  - POST with `{prompt, type: "cover"|"illustration"}`
  - Uses FLUX.1-schnell via HuggingFace inference API
  - Cover: 1200x630, professional blog style
  - Illustration: 800x450, clean informational style
  - Returns base64 data URL
- **Rich contentEditable editor** (replaced textarea):
  - 3-mode toolbar: **Edit** (rich WYSIWYG) | **Source** (raw HTML) | **Preview** (read-only render)
  - Formatting buttons: Bold, Italic, H2, H3, Bullet List
  - **Add Illustration** button: generates AI image at cursor position, inserts as `<figure>` with caption, editable in-place
  - Save Changes / Discard buttons with status feedback
- **Cover Image improvements**:
  - Full-width preview with hover-to-remove (X button)
  - Paste URL input + **Auto-Generate** button (calls FLUX.1 API)
- **Button UX improvements**:
  - Segmented toggle for Edit/Source/Preview modes
  - Publish bar redesigned as compact horizontal strip
  - All buttons have consistent sizing, hover states, loading spinners
  - Discard button instead of Cancel for clarity

### Files created/modified
- `src/app/api/image/route.ts` — NEW: FLUX.1 image generation endpoint
- `src/components/dashboard/tabs/content-generator-tab.tsx` — MODIFIED: rich editor, illustration insertion, cover auto-gen

### Task 6: Data Charts + Rendering Fixes — Completed
- **Auto-generated SVG bar charts** from actual table data:
  - Parses every table in article HTML for numeric columns (salary, fees, packages)
  - Generates color-coded horizontal bar charts with labels and values
  - Handles salary ranges (₹3.5-5 LPA → takes midpoint for bar length)
  - Auto-inserted below each relevant table
- **Article CSS overhaul** (`globals.css` → `.cs-article` class):
  - Tables: blue header, alternating row stripes, hover highlight, rounded corners
  - Lists: disc markers with blue accent, proper indentation and spacing
  - Headings: H2 with blue bottom border, proper hierarchy
  - FAQs: card-style with blue question headings
  - Blockquotes, links, disclaimers, illustrations all styled
- **Replaced AI illustration with image URL insert**: "Add Image" button in edit toolbar opens URL input popup
- **Stripped inline table styles** so CSS takes over (removes cellspacing, cellpadding, border attributes)
- Files modified: `src/app/globals.css`, `src/components/dashboard/tabs/content-generator-tab.tsx`

---

## Phase 3 Summary — Content Generator Page (Complete)

### What was built
1. **Python pipeline bridge** — subprocess spawner with unbuffered stdout parsing into structured SSE events
2. **SSE generate endpoint** — real-time article generation with DB tracking
3. **Content Generator tab** — topic input, 7-stage pipeline progress bar, cancel support
4. **Article list with search** — 591 articles browsable with search, type filter, pagination (20 per page)
5. **Article viewer** — 4-tab view (Preview, Quality Report, Sections, Outline)
6. **Rich editor** — Edit/Source/Preview modes, contentEditable WYSIWYG, formatting toolbar
7. **Auto-generated data charts** — SVG bar charts from table data (salary, fees, packages)
8. **Cover image** — paste URL or auto-generate with FLUX.1 AI
9. **WordPress publishing** — draft/publish with cover image upload, category resolution
10. **Article save** — save edits back to disk
11. **Content analysis strip** — 6 metrics at a glance (grade, readability, data density, fact check, tables, FAQ)

### API routes added (Phase 3)
- `POST /api/generate` — SSE article generation
- `GET /api/generate?jobId=` — poll job status
- `GET /api/article?list=true` — list all generated articles
- `GET /api/article?slug=&part=all` — get article HTML + meta + outline
- `PUT /api/article` — save edited HTML
- `POST /api/publish` — publish to WordPress
- `POST /api/image` — generate image with FLUX.1

### Next Up — Phase 4: Bulk Generation & News Pipeline

---

## 2026-03-29 — Session 2 (Phase 2 continued: Config page fixes)

### Completed
- **API key seeding fix:** WordPress, Supabase, Google Ads, DataForSEO, SerpAPI, YouTube, Google Indexing now all seed from .env.local on first session
- **Expanded API providers to 11:** Added Supabase, Google Ads (Keyword Planner), DataForSEO, SerpAPI to types.ts
- **Structured add/edit forms per provider:** Each provider gets proper labeled fields instead of single pipe-delimited input
  - WordPress: Site URL, Username, App Password
  - Supabase: Project URL, Service Role Key
  - Google Ads: Developer Token, Client ID, Client Secret, Refresh Token, Customer ID
  - DataForSEO: Login/Email, Password
  - Single-key providers: just one labeled API Key field
- **Edit existing keys:** Each key now has Edit button that fetches raw values and opens pre-filled form
- **API route updates:** GET?raw=true for unmasked values, PUT for update-in-place (delete old + insert new)
- **Improved key masking:** Multi-field providers mask each pipe-separated part individually
- **Country + Language selector:** Replaced plain-text "Default Region" with:
  - Country dropdown (25 countries)
  - Smart language multi-select (clickable pills) that auto-populates based on country
  - India: 12 languages, English+Hindi default
  - Other countries: spoken languages + English always included
  - Stored as `default_country` (code) + `content_languages` (comma-separated)

### Files changed this session
- `src/components/dashboard/tabs/configuration-tab.tsx` — Structured key forms, edit mode, country/language selector
- `src/components/dashboard/types.ts` — 11 API providers (was 7)
- `src/lib/server/session.ts` — Seed all providers + default_country/content_languages
- `src/app/api/keys/route.ts` — raw param, PUT method, per-part masking

---

## 2026-03-29 — Session 1 (Phase 2: Server Foundation)

### Completed
- Created Next.js 16 project with TypeScript + Tailwind v4
- Set up GitHub repo: nishit002/content-studio
- Built theme system with 30+ CSS variables (light/dark mode)
- Deep analysis of entire content-generator codebase (37 modules, 20+ CLI commands)
- Documented all writing rules, banned phrases, quality thresholds, prompts
- **Server Foundation:**
  - Installed better-sqlite3 for server-side DB
  - Created full DB schema: sessions, config, api_keys, content, jobs, writing_rules, news_sources
  - Session middleware (cookie-based, httpOnly, auto-creation with default seeding)
  - 5 API routes: /api/config, /api/keys, /api/rules, /api/health, /api/stats
  - API key health testing for Gemini, HuggingFace, You.com, WordPress, YouTube
- **Configuration Page (server-side):**
  - Project Settings, Content Defaults, WordPress Publishing sections
  - API Keys with add/delete/test per provider (masked display, server-stored)
  - Writing Rules: banned phrases (104), AI replacements (86), table banned values (30), quality thresholds
  - Industry Presets (9 presets)
- **FindMyCollege Defaults Prefilled:**
  - 60+ config values loaded from .env.local
  - 23 API keys (3 Gemini, 2 HF, 17 You.com, 1 image gen)
  - 55 RSS news feeds (Direct Publisher, Google News, Regional, Banking)
  - All writing rules, gov sites, competitor sites, trusted PDF domains
- 4-page architecture: Dashboard, Content Generator, Content Library, Configuration

### Architecture
- All state server-side (SQLite), secrets in .env.local
- Session via httpOnly cookies (auto-created, 30-day TTL)
- New sessions seeded with complete FindMyCollege production config

### What is working
- Config page fully functional (reads/writes server via API routes)
- API key management with add/edit/delete/test for all 11 providers
- Writing rules CRUD with pills/tag editors
- All API keys load from env and display correctly
- Country + language selection with smart defaults
- Dashboard with stats from server
- Dark/light theme toggle
- Build passes with zero errors

### Next Up — Phase 3: Content Generator Page
The Content Generator page needs to show the FULL pipeline flow, not just a generate button.

**Pipeline View (what user sees for each article):**
1. Topic Input -> Auto-classify (type + intent + confidence displayed)
2. Research Panel (sources found, snippets, PDFs discovered, query count)
3. Outline Editor (YAML sections with tiers, headings, formats — user can edit before writing)
4. Section-by-Section Writing (each section shows progress, word count, table count)
5. Post-Processing (banned phrases removed, quality score, hallucination check)
6. Final Article View (HTML preview, outline sidebar, research data, quality report)

**You.com Key Rotation** must be visible — show which key is active, which are in cooldown, health status per key.

**Needs:**
- SSE (Server-Sent Events) for real-time progress streaming
- Python bridge (subprocess calling content-generator pipeline stages)
- Article detail view showing all pipeline artifacts (research, outline, HTML, quality)
