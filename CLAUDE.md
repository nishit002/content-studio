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
- Storage: SQLite (server-side), cookies (session)
- Deploy: Vercel
- GitHub: nishit002/content-studio

## Architecture
- ALL logic server-side (Next.js API routes)
- Session via httpOnly cookies
- Python pipeline called via subprocess from API routes
- SSE (Server-Sent Events) for real-time generation progress
- SQLite for config, content library, job tracking

## Rules Claude must follow
1. Never touch more than 3 files per task
2. Always read files before assuming what is in them
3. Always write a plan before writing code
4. After every task, update PROGRESS.md
5. Stop and ask if the task feels too large
6. NEVER make things client-side — always server-side API routes
7. Every feature needs session validation

## Pages to build (4 total)
1. **Dashboard** — stats, recent activity, quick-start
2. **Content Generator** — single article, bulk, news pipeline
3. **Content Library** — browse/search/view/manage generated content
4. **Configuration** — API keys, writing rules, presets, templates, news sources, publishing

## Current phase
Phase 2 — Server foundation (session, DB, config API routes, config page)

## What is working
- Project scaffolded with Next.js 16 + Tailwind v4
- Theme system (dark/light mode with CSS variables)
- GitHub repo created at nishit002/content-studio
- Full codebase analysis of content-generator complete

## What is broken or missing
- No server-side foundation yet (session, DB, API routes)
- No config page yet
- No content generation flow yet
- Old client-side tabs need to be replaced with server-side architecture
