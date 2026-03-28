# Project: Content Studio

## What this is
A unified web platform combining content generation, AEO (Answer Engine Optimization),
GEO (Generative Engine Optimization), and SEO optimization into one tool.
Generates content for any niche with auto-detected templates, and lets users
optimize content individually or in bulk.

## Owner
Nishit — not a coder. Explain everything simply.
Ask before touching more than 3 files at once.
Always make a plan in plain English before writing code.

## Current stack
- Frontend: Next.js 16, TypeScript, Tailwind v4, Recharts
- Backend: Python (content-generator/ subfolder in gas-split repo)
- AI: Gemini Flash, Qwen3, OpenRouter, Bright Data
- Storage: IndexedDB (frontend), SQLite (Python)
- Deploy: Vercel

## Rules Claude must follow
1. Never touch more than 3 files per task
2. Always read files before assuming what is in them
3. Always write a plan before writing code
4. After every task, update PROGRESS.md
5. Stop and ask if the task feels too large

## Current phase
Phase 1 — Building the full frontend interface (dashboard shell, all 6 tabs)

## What is working
- Project scaffolded with Next.js 16 + Tailwind v4
- Theme system (dark/light mode with CSS variables)
- GitHub repo created at nishit002/content-studio
- Types and data models defined for all modules

## What is broken or missing
- All tab UIs are being built (in progress)
- No API routes yet (backend integration)
- No AI model integration yet
- No publishing pipeline yet
