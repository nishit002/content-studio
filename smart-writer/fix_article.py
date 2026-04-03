#!/usr/bin/env python3
"""
One-pass fix script for article.html:
1. Strip markdown code fences
2. None values → —
3. Empty table cells → —
4. Fix corrupted PDF OCR sector names
5. Remove <p> wrapping tables
6. Remove FAQ items with "Not available in current data." + matching JSON-LD entries
7. Add <style> block to <head>
"""

import re
import sys

FILE = "/Volumes/NISHIT_PD/smart-writer/output/005-iim-ahmedabad-placements-2024/article.html"

with open(FILE, "r", encoding="utf-8") as f:
    html = f.read()

# ── 1. Strip markdown code fences ────────────────────────────────────────────
# Lines that are exactly ```html or ``` (with optional trailing spaces)
html = re.sub(r'(?m)^```html\s*\n', '', html)
html = re.sub(r'(?m)^```\s*\n', '', html)
# Also handle inline occurrences without newline context (safety)
html = re.sub(r'```html', '', html)
html = re.sub(r'```', '', html)

# ── 2. None values ────────────────────────────────────────────────────────────
html = re.sub(r'<td>\s*None\s*</td>', '<td>—</td>', html)

# ── 3. Empty table cells ─────────────────────────────────────────────────────
html = re.sub(r'<td>\s*</td>', '<td>—</td>', html)

# ── 4. Corrupted PDF OCR sector names ────────────────────────────────────────
# Order matters: longer/more-specific strings first
corruptions = [
    (r'Banking, Financial Services and lhsurance \(BFSI\)', 'Banking, Financial Services and Insurance (BFSI)'),
    (r'fr\'harmaceutical/Healthcare', 'Pharmaceutical/Healthcare'),
    (r'ifiternalional', 'International'),
    (r'~3rand Total', 'Grand Total'),
    (r'~Dthers\*', 'Others'),
    (r'TSoftware', 'IT Software'),
    (r'T Solutions', 'IT Solutions'),
    (r'T Consulting', 'IT Consulting'),
    (r'Velecom', 'Telecom'),
    (r'~ner8y', 'Energy'),
    (r':~,fl~3', 'FMCG'),
    (r':onsulting', 'Consulting'),
    (r'\\utomotive', 'Automotive'),  # backslash-u
    (r'\utomotive', 'Automotive'),   # literal \u in source
    (r'rôtal', 'Total'),
]
for pattern, replacement in corruptions:
    try:
        html = re.sub(pattern, replacement, html)
    except re.error:
        # Fallback to literal string replacement if regex fails
        html = html.replace(pattern.replace('\\', ''), replacement)

# Also do plain string replacements for the trickier ones
plain_fixes = [
    ('\x5cutomotive', 'Automotive'),  # \utomotive
    ('rôtal', 'Total'),
    ('Banking, Financial Services and lhsurance (BFSI)', 'Banking, Financial Services and Insurance (BFSI)'),
    ("fr'harmaceutical/Healthcare", 'Pharmaceutical/Healthcare'),
    ('ifiternalional', 'International'),
    ('~3rand Total', 'Grand Total'),
    ('~Dthers*', 'Others'),
    ('TSoftware', 'IT Software'),
    ('T Solutions', 'IT Solutions'),
    ('T Consulting', 'IT Consulting'),
    ('Velecom', 'Telecom'),
    ('~ner8y', 'Energy'),
    (':~,fl~3', 'FMCG'),
    (':onsulting', 'Consulting'),
]
for old, new in plain_fixes:
    html = html.replace(old, new)

# ── 5. Tables wrapped in <p> tags ────────────────────────────────────────────
html = re.sub(r'<p>\s*(<table)', r'\1', html)
html = re.sub(r'(</table>)\s*</p>', r'\1', html)

# ── 6. Remove FAQ items with "Not available in current data." ─────────────────
# Remove the <div class="faq-item">...</div> blocks containing that phrase
def remove_faq_items_with_no_data(content):
    # Collect question texts from items to remove (for JSON-LD cleanup)
    removed_questions = []

    def replace_faq(m):
        block = m.group(0)
        if 'Not available in current data.' in block:
            # Extract the question text for JSON-LD removal
            q_match = re.search(r'<[^>]+class="faq-question"[^>]*>(.*?)</[^>]+>', block, re.DOTALL)
            if q_match:
                q_text = re.sub(r'<[^>]+>', '', q_match.group(1)).strip()
                removed_questions.append(q_text)
            return ''
        return block

    # Match faq-item divs (possibly nested content, non-greedy with DOTALL)
    result = re.sub(
        r'<div\s+class="faq-item">.*?</div>\s*(?=<div\s+class="faq-item">|</div>|</section>|<script)',
        replace_faq,
        content,
        flags=re.DOTALL
    )
    return result, removed_questions

html, removed_qs = remove_faq_items_with_no_data(html)

# Broader fallback: match faq-item blocks with a greedy end marker
# (handles cases where the pattern above might miss the last item)
def remove_faq_no_data_v2(content):
    removed = []
    pattern = re.compile(r'<div\s[^>]*class="faq-item"[^>]*>.*?(?:</div>\s*){2,}', re.DOTALL)
    def replacer(m):
        block = m.group(0)
        if 'Not available in current data.' in block:
            q_match = re.search(r'<[^>]+class="faq-question"[^>]*>(.*?)</[^>]+>', block, re.DOTALL)
            if q_match:
                q_text = re.sub(r'<[^>]+>', '', q_match.group(1)).strip()
                removed.append(q_text)
            return ''
        return block
    return pattern.sub(replacer, content), removed

# Use a cleaner targeted approach
faq_blocks = re.findall(r'<div class="faq-item">.*?</div>\s*</div>', html, re.DOTALL)
removed_question_texts = []
for block in faq_blocks:
    if 'Not available in current data.' in block:
        q_match = re.search(r'<(?:h3|p|div)[^>]*class="faq-question"[^>]*>(.*?)</(?:h3|p|div)>', block, re.DOTALL)
        if q_match:
            q_text = re.sub(r'<[^>]+>', '', q_match.group(1)).strip()
            removed_question_texts.append(q_text)
        html = html.replace(block, '', 1)

# Remove corresponding JSON-LD entries
# JSON-LD FAQ entries look like:
# {"@type": "Question", "name": "...", "acceptedAnswer": {...}}
if removed_question_texts:
    def remove_jsonld_faq(content, questions):
        # Find the JSON-LD script block
        script_match = re.search(
            r'(<script type="application/ld\+json">)(.*?)(</script>)',
            content, re.DOTALL
        )
        if not script_match:
            return content

        import json
        script_content = script_match.group(2).strip()
        try:
            data = json.loads(script_content)
        except json.JSONDecodeError:
            return content  # Can't parse, skip

        # Handle both single object and array
        schemas = data if isinstance(data, list) else [data]
        for schema in schemas:
            if schema.get('@type') == 'FAQPage' and 'mainEntity' in schema:
                # Filter out questions that were removed
                schema['mainEntity'] = [
                    q for q in schema['mainEntity']
                    if not any(
                        removed_q.lower() in q.get('name', '').lower() or
                        q.get('name', '').lower() in removed_q.lower()
                        for removed_q in questions
                    )
                ]

        new_script_content = json.dumps(data if not isinstance(data, list) else schemas, indent=2)
        new_script_block = script_match.group(1) + '\n' + new_script_content + '\n' + script_match.group(3)
        return content[:script_match.start()] + new_script_block + content[script_match.end():]

    html = remove_jsonld_faq(html, removed_question_texts)

# ── 7. Add <style> block to <head> ───────────────────────────────────────────
style_block = """<style>
  body { font-family: Georgia, serif; max-width: 860px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.7; color: #1a1a1a; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.4rem; margin-top: 2.5rem; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.3rem; }
  h3 { font-size: 1.1rem; margin-top: 1.5rem; }
  p { margin: 0.8rem 0; }
  table.data-table { border-collapse: collapse; width: 100%; margin: 1.2rem 0; font-size: 0.92rem; }
  table.data-table th, table.data-table td { border: 1px solid #bbb; padding: 0.5rem 0.75rem; text-align: left; }
  table.data-table th { background: #f2f2f2; font-weight: 600; }
  table.data-table tr:nth-child(even) td { background: #fafafa; }
  nav.toc { background: #f7f7f7; border: 1px solid #ddd; padding: 1rem 1.5rem; margin: 1.5rem 0; border-radius: 4px; }
  nav.toc ol { margin: 0; padding-left: 1.2rem; }
  nav.toc li { margin: 0.3rem 0; }
  .faq-section { margin-top: 2rem; }
  .faq-item { margin-bottom: 1.2rem; }
  .faq-question { font-size: 1rem; margin-bottom: 0.3rem; }
</style>"""

# Only add if not already present
if '<style>' not in html:
    # Insert after the last <meta> tag in <head>
    # Find end of last meta tag before </head>
    meta_matches = list(re.finditer(r'<meta[^>]*/?>|<meta[^>]*>', html))
    if meta_matches:
        last_meta = meta_matches[-1]
        insert_pos = last_meta.end()
        html = html[:insert_pos] + '\n' + style_block + html[insert_pos:]
    else:
        # Fallback: insert before </head>
        html = html.replace('</head>', style_block + '\n</head>', 1)

# ── Write output ──────────────────────────────────────────────────────────────
with open(FILE, "w", encoding="utf-8") as f:
    f.write(html)

print("Done. File overwritten.")
print(f"Removed FAQ items with 'Not available in current data.': {len(removed_question_texts)}")
if removed_question_texts:
    for q in removed_question_texts:
        print(f"  - {q}")
