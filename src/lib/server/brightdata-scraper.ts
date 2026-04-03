/**
 * BrightData AI Scraper — queries 6 AI platforms via BrightData datasets.
 * Ported from fmc-aeo-tracker/lib/server/brightdata-scraper.ts
 */

export type AeoProvider = "chatgpt" | "perplexity" | "copilot" | "gemini" | "google_ai" | "grok";

export const PROVIDER_LABELS: Record<AeoProvider, string> = {
  chatgpt: "ChatGPT", perplexity: "Perplexity", copilot: "Copilot",
  gemini: "Gemini", google_ai: "Google AI", grok: "Grok",
};

const providerToDatasetEnv: Record<AeoProvider, string> = {
  chatgpt: "BRIGHT_DATA_DATASET_CHATGPT", perplexity: "BRIGHT_DATA_DATASET_PERPLEXITY",
  copilot: "BRIGHT_DATA_DATASET_COPILOT", gemini: "BRIGHT_DATA_DATASET_GEMINI",
  google_ai: "BRIGHT_DATA_DATASET_GOOGLE_AI", grok: "BRIGHT_DATA_DATASET_GROK",
};

const providerBaseUrl: Record<AeoProvider, string> = {
  chatgpt: "https://chatgpt.com/", perplexity: "https://www.perplexity.ai/",
  copilot: "https://copilot.microsoft.com/", gemini: "https://gemini.google.com/",
  google_ai: "https://www.google.com/", grok: "https://grok.com/",
};

export interface ScrapeResult {
  provider: AeoProvider;
  prompt: string;
  answer: string;
  sources: string[];
  snapshotId: string;
  createdAt: string;
}

function withAuthHeaders() {
  const key = process.env.BRIGHT_DATA_KEY;
  if (!key) throw new Error("Missing BRIGHT_DATA_KEY");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function getDatasetId(provider: AeoProvider): string {
  const id = process.env[providerToDatasetEnv[provider]];
  if (!id) throw new Error(`Missing dataset env: ${providerToDatasetEnv[provider]}`);
  return id;
}

// ─── URL filter ───────────────────────────────────────────────────────────

const BLOCKED_HOSTS = ["chatgpt.com","openai.com","perplexity.ai","copilot.microsoft.com","grok.com","gemini.google.com","cloudfront.net","cdn.jsdelivr.net","amazonaws.com","connect.facebook.net","google-analytics.com","googletagmanager.com","hotjar.com","w3.org","schema.org"];
const ASSET_EXT = /\.(js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|mp4|mp3)(\?|$)/i;
const JUNK_PATHS = ["/signals/","/pixel","/tracking","/beacon","/analytics","/__","/wp-includes/"];

function isValidSource(url: string): boolean {
  try {
    const p = new URL(url);
    if (!["http:","https:"].includes(p.protocol)) return false;
    const host = p.hostname.toLowerCase();
    if (BLOCKED_HOSTS.some(b => host === b || host.endsWith(`.${b}`))) return false;
    if (ASSET_EXT.test(p.pathname)) return false;
    if (JUNK_PATHS.some(j => `${host}${p.pathname}`.includes(j))) return false;
    if (p.search.length > 200 || !host) return false;
    return true;
  } catch { return false; }
}

function normalizeUrl(url: string): string {
  try { const p = new URL(url); p.hash = ""; return p.toString(); } catch { return url; }
}

function extractSources(answer: string, rawRecord: Record<string, unknown>): string[] {
  const found = new Set<string>();
  // From answer text
  (answer.match(/https?:\/\/[^\s)\]}"']+/g) ?? []).map(u => u.replace(/[),.;:!?]+$/, "")).filter(isValidSource).map(normalizeUrl).forEach(u => found.add(u));
  (answer.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g) ?? []).forEach(m => { const u = m.match(/\((https?:\/\/[^)]+)\)/)?.[1]?.replace(/[),.;:!?]+$/, ""); if (u && isValidSource(u)) found.add(normalizeUrl(u)); });
  // From structured fields
  for (const field of ["citations","links_attached","sources"]) {
    const arr = rawRecord[field];
    if (Array.isArray(arr)) arr.forEach(item => {
      const u = typeof item === "string" ? item : (item as Record<string, unknown>)?.url as string;
      if (typeof u === "string" && u.startsWith("http") && isValidSource(u)) found.add(normalizeUrl(u));
    });
  }
  return [...found];
}

function stripAnswerHtml(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripAnswerHtml);
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) { if (k.toLowerCase() !== "answer_html") out[k] = stripAnswerHtml(val); }
    return out;
  }
  return v;
}

function extractAnswer(record: Record<string, unknown>): string {
  for (const key of ["answer_text","answer_text_markdown","answer","response_raw","response","output","result","text","content"]) {
    if (typeof record[key] === "string" && (record[key] as string).trim()) return (record[key] as string).trim();
  }
  function deep(obj: unknown, depth: number): string | null {
    if (depth > 3) return null;
    if (typeof obj === "string" && obj.trim().length > 20) return obj.trim();
    if (Array.isArray(obj)) { for (const e of obj) { const f = deep(e, depth+1); if (f) return f; } }
    if (obj && typeof obj === "object") {
      const r = obj as Record<string, unknown>;
      for (const k of ["answer_text","answer","response","text","content","message"]) { if (typeof r[k] === "string" && (r[k] as string).trim().length > 20) return (r[k] as string).trim(); }
      for (const v of Object.values(r)) { const f = deep(v, depth+1); if (f) return f; }
    }
    return null;
  }
  return deep(record, 0) ?? JSON.stringify(record).slice(0, 2000);
}

async function monitorUntilReady(snapshotId: string) {
  for (let i = 0; i < 90; i++) {
    const res = await fetch(`https://api.brightdata.com/datasets/v3/progress/${snapshotId}`, { headers: withAuthHeaders() });
    if (!res.ok) throw new Error(`Monitor failed (${res.status})`);
    const { status } = await res.json() as { status: string };
    if (status === "ready") return;
    if (status === "failed") throw new Error("Snapshot failed");
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for snapshot");
}

export async function runAiScraper(provider: AeoProvider, prompt: string): Promise<ScrapeResult> {
  const datasetId = getDatasetId(provider);
  const scrapeRes = await fetch(
    `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${datasetId}&notify=false&include_errors=true&format=json`,
    { method: "POST", headers: withAuthHeaders(), body: JSON.stringify({ input: [{ url: providerBaseUrl[provider], prompt, index: 1 }] }) }
  );

  let payload: unknown;
  if (scrapeRes.status === 202) {
    const { snapshot_id } = await scrapeRes.json() as { snapshot_id: string };
    await monitorUntilReady(snapshot_id);
    const dlRes = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${snapshot_id}?format=json`, { headers: withAuthHeaders() });
    if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
    payload = await dlRes.json();
  } else {
    if (!scrapeRes.ok) throw new Error(`Scrape failed (${scrapeRes.status}): ${await scrapeRes.text()}`);
    payload = await scrapeRes.json();
  }

  const rawFirst = Array.isArray(payload) ? (payload as Record<string, unknown>[])[0] : payload as Record<string, unknown>;
  const rawRecord = rawFirst ?? {} as Record<string, unknown>;
  const sanitized = stripAnswerHtml(payload);
  const sanitizedFirst = Array.isArray(sanitized) ? sanitized[0] : sanitized as Record<string, unknown>;
  const record = sanitizedFirst ?? {} as Record<string, unknown>;

  const answer = extractAnswer(record as Record<string, unknown>);
  const sources = extractSources(answer, rawRecord as Record<string, unknown>);

  return {
    provider, prompt, answer, sources,
    snapshotId: typeof record.snapshot_id === "string" ? record.snapshot_id as string : "",
    createdAt: new Date().toISOString(),
  };
}

// ─── Visibility Score + Sentiment ─────────────────────────────────────────

export function computeVisibilityScore(answer: string, brandTerms: string[], sources: string[]): { score: number; sentiment: string; brandMentioned: boolean; competitorsMentioned: string[] } {
  const lower = answer.toLowerCase();
  let mentions = 0;
  let firstPos = 1;
  for (const term of brandTerms.filter(Boolean)) {
    const t = term.toLowerCase().trim();
    if (!t) continue;
    const idx = lower.indexOf(t);
    if (idx !== -1) {
      firstPos = Math.min(firstPos, idx / Math.max(lower.length, 1));
      let count = 0;
      let pos = 0;
      while ((pos = lower.indexOf(t, pos)) !== -1) { count++; pos += t.length; }
      mentions += count;
    }
  }
  const score = Math.min(100, mentions * 15 + Math.round((1 - firstPos) * 10) + Math.min(sources.length * 2, 20));
  const posWords = ["best","top","leading","recommended","trusted","popular","excellent"];
  const negWords = ["worst","avoid","bad","poor","terrible","unreliable","scam"];
  const window = brandTerms.flatMap(t => { const i = lower.indexOf(t.toLowerCase()); return i !== -1 ? [lower.slice(Math.max(0, i-100), i+100)] : []; }).join(" ");
  const sentiment = negWords.some(w => window.includes(w)) ? "negative" : posWords.some(w => window.includes(w)) ? "positive" : "neutral";
  return { score, sentiment, brandMentioned: mentions > 0, competitorsMentioned: [] };
}
