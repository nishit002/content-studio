# Smart Writer

Source-first AI content pipeline. Reads official websites directly, extracts verified data, writes data-dense SEO-optimized articles using a local LLM.

## Why this beats search-snippet pipelines

| Search snippets (old way) | Smart Writer (this) |
|---|---|
| 200-500 chars per result | Complete page content |
| Tables truncated, rows cut off | Every table row extracted |
| LLM guesses missing numbers | LLM only writes what data exists |
| Generic SEO meta-tag tricks | Depth + zero repetition = real SEO |

## How it works (6 stages)

```
Topic
  ↓
1. Source Discovery  — finds 5-8 official URLs (nta.ac.in, nirfindia.org, josaa.nic.in etc.)
  ↓
2. BrightData Fetch  — pulls complete page HTML, strips nav/ads, keeps main content
  ↓
3. Gemini Extraction — reads full page, extracts every fact into structured JSON
  ↓
4. Outline Creation  — Gemini builds section plan from the actual extracted data
  ↓
5. LM Studio Writing — Llama 3.1 8B converts data tables into readable HTML prose
  ↓
6. SEO Assembly      — TOC, FAQ schema (JSON-LD), source citations, final HTML
```

## Setup

**1. Install dependencies**
```bash
pip3 install -r requirements.txt
```

**2. Create `.env` file** (copy from `.env.example`)
```
GEMINI_API_KEY=your-gemini-key
BRIGHT_DATA_KEY=your-brightdata-token      # optional but recommended
BRIGHT_DATA_ZONE=web_unlocker1             # your BrightData zone name
LM_STUDIO_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=meta-llama-3.1-8b-instruct
```

**3. Start LM Studio**
- Open LM Studio app
- Go to **Local Server** tab
- Load a model (`meta-llama-3.1-8b-instruct` confirmed working)
- Click **Start Server**

**4. BrightData Web Unlocker (optional)**
- Log into app.brightdata.com
- Go to **Proxies & Scraping → Web Unlocker**
- Create a zone, copy the zone name
- Without this the script uses direct HTTP (works fine for most .gov.in/.ac.in sites)

## Usage

```bash
# Exam guide
python3 smart_writer.py "CUET UG 2026 Mathematics Syllabus" --type exam_guide

# College profile
python3 smart_writer.py "IIT Bombay Placements 2024" --type college_profile

# Rankings article
python3 smart_writer.py "Top MBA Colleges India NIRF 2025" --type ranking_list

# Career guide
python3 smart_writer.py "Data Science Career in India 2026" --type career_guide

# Custom keyword
python3 smart_writer.py "JEE Main 2026" --keyword "JEE Main exam pattern 2026" --type exam_guide

# Force re-fetch (ignore 24hr cache)
python3 smart_writer.py "CUET 2026" --force
```

## Content types

| Type | Use for |
|---|---|
| `exam_guide` | Syllabus, exam pattern, preparation |
| `college_profile` | Single college: fees, placements, cutoffs, rankings |
| `ranking_list` | Top N colleges comparison table |
| `career_guide` | Career scope, salaries, job roles |
| `informational` | General explainer (default) |

## Output

Saved to `output/{slug}/`:
- `article.html` — final SEO-optimized article
- `extracted_data.json` — all facts extracted from official sources
- `outline.json` — section plan with headings and data hints

## SEO approach

Real SEO is not about meta tags. It's about:
- Content written around the keyword that actually answers every question
- No repetition — each section covers a unique sub-topic, exhaustively
- Data density — every sentence carries a specific fact (number, name, date)
- Focus keyword appears naturally in content where it makes sense — not forced

The pipeline enforces this by:
- Giving the writer pre-extracted, verified data → forces specificity
- Tracking what each earlier section covered → prevents repetition
- Rejecting sections with no real data → no filler headings

## Requirements

- Python 3.9+
- Gemini API key (free tier works)
- LM Studio running locally with any model loaded
- BrightData account with Web Unlocker zone (optional)
