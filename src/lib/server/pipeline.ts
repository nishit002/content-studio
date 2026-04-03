/**
 * Python pipeline bridge — spawns content-generator subprocess and
 * yields structured progress events by parsing stdout/stderr.
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { getApiKeys, getConfig, getWritingRules } from "./db";

/* ── Path to the Python content-generator repo ── */
const PIPELINE_DIR = process.env.PIPELINE_DIR
  || path.resolve("/Volumes/NISHIT_PD/gas new/gas-split/content-generator");

/* ── Path to the ATLAS smart-writer module ── */
const ATLAS_DIR = process.env.ATLAS_DIR
  || path.resolve("/Volumes/NISHIT_PD/content-studio/smart-writer");

const PYTHON_BIN = process.env.PYTHON_BIN || "/usr/bin/python3";

/* ── Progress event types ── */
export type PipelineStage =
  | "queued"
  | "classifying"
  | "researching"
  | "outlining"
  | "writing"
  | "post_processing"
  | "done"
  | "error";

export interface PipelineEvent {
  stage: PipelineStage;
  message: string;
  detail?: Record<string, unknown>;
  timestamp: number;
}

/* ── Build environment variables from session DB ── */
function buildEnv(sessionId: string): NodeJS.ProcessEnv {
  const keys = getApiKeys(sessionId);
  const config = getConfig(sessionId);
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Gemini keys (up to 3)
  const geminiKeys = keys.filter((k) => k.provider === "gemini");
  geminiKeys.forEach((k, i) => {
    env[i === 0 ? "GEMINI_API_KEY" : `GEMINI_API_KEY_${i + 1}`] = k.key_value;
  });

  // HuggingFace keys — set both HF_API_KEY (read by llm_client.py) and HF_TOKEN (HF standard)
  const hfKeys = keys.filter((k) => k.provider === "huggingface");
  hfKeys.forEach((k, i) => {
    env[i === 0 ? "HF_TOKEN" : `HF_TOKEN_${i + 1}`] = k.key_value;
    env[i === 0 ? "HF_API_KEY" : `HF_API_KEY_${i + 1}`] = k.key_value;
  });
  // Also pass comma-separated pool from .env.local if present
  if (process.env.HF_API_KEYS) env.HF_API_KEYS = process.env.HF_API_KEYS;

  // You.com Search keys (rotation pool)
  const youKeys = keys.filter((k) => k.provider === "you_search");
  youKeys.forEach((k, i) => {
    env[i === 0 ? "YDC_API_KEY" : `YDC_API_KEY_${i + 1}`] = k.key_value;
  });

  // WordPress (pipe-delimited: url|username|app_password)
  const wpKey = keys.find((k) => k.provider === "wordpress");
  if (wpKey) {
    const [url, username, password] = wpKey.key_value.split("|");
    if (url) env.WORDPRESS_SITE_URL = url;
    if (username) env.WORDPRESS_USERNAME = username;
    if (password) env.WORDPRESS_APP_PASSWORD = password;
  }

  // Supabase
  const supaKey = keys.find((k) => k.provider === "supabase");
  if (supaKey) {
    const [url, serviceKey] = supaKey.key_value.split("|");
    if (url) env.SUPABASE_URL = url;
    if (serviceKey) env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  }

  // Google Ads (pipe-delimited)
  const gadsKey = keys.find((k) => k.provider === "google_ads");
  if (gadsKey) {
    const parts = gadsKey.key_value.split("|");
    if (parts[0]) env.GADS_DEVELOPER_TOKEN = parts[0];
    if (parts[1]) env.GADS_CLIENT_ID = parts[1];
    if (parts[2]) env.GADS_CLIENT_SECRET = parts[2];
    if (parts[3]) env.GADS_REFRESH_TOKEN = parts[3];
    if (parts[4]) env.GADS_LOGIN_CUSTOMER_ID = parts[4];
  }

  // DataForSEO
  const dfKey = keys.find((k) => k.provider === "dataforseo");
  if (dfKey) {
    const [login, password] = dfKey.key_value.split("|");
    if (login) env.DATAFORSEO_LOGIN = login;
    if (password) env.DATAFORSEO_PASSWORD = password;
  }

  // SerpAPI
  const serpKey = keys.find((k) => k.provider === "serpapi");
  if (serpKey) env.SERPAPI_KEY = serpKey.key_value;

  // YouTube
  const ytKey = keys.find((k) => k.provider === "youtube");
  if (ytKey) env.YOUTUBE_API_KEY = ytKey.key_value;

  // Image Gen
  const imgKey = keys.find((k) => k.provider === "image_gen");
  if (imgKey) env.IMAGE_GEN_API_KEY = imgKey.key_value;

  // Config values
  if (config.default_country) env.DEFAULT_COUNTRY = config.default_country;
  if (config.content_languages) env.CONTENT_LANGUAGES = config.content_languages;

  return env;
}

/* ── Parse a line of stdout/stderr into a PipelineEvent ── */
function parseLine(line: string): PipelineEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const ts = Date.now();

  // Classification result
  if (trimmed.includes("content_type") && trimmed.includes("primary_intent")) {
    return { stage: "classifying", message: trimmed, timestamp: ts };
  }

  // Outline stage markers
  if (trimmed.startsWith("Processing ") && trimmed.includes("topic(s)")) {
    return { stage: "outlining", message: trimmed, timestamp: ts };
  }
  if (trimmed.startsWith("Outlining")) {
    return { stage: "outlining", message: "Generating outline...", timestamp: ts };
  }
  if (trimmed.includes("✓") && trimmed.includes("sections") && !trimmed.includes("words")) {
    // "  ✓ college_profile | 12 sections | 5 API calls"  or  "  ✓ Outline generated: ranking_list | 6 sections"
    const match = trimmed.match(/(\w+)\s*\|\s*(\d+)\s*sections?/);
    const apiMatch = trimmed.match(/(\d+)\s*API/);
    return {
      stage: "outlining",
      message: trimmed.replace(/^\s*✓\s*/, ""),
      detail: match ? { contentType: match[1], sections: Number(match[2]), apiCalls: apiMatch ? Number(apiMatch[1]) : 0 } : undefined,
      timestamp: ts,
    };
  }
  if (trimmed.includes("✓ Outline:")) {
    return { stage: "outlining", message: trimmed.replace(/^\s*✓\s*/, ""), timestamp: ts };
  }

  // Write stage
  if (trimmed.includes("Writing [") && trimmed.includes("]")) {
    return { stage: "writing", message: trimmed.replace(/^\s*/, ""), timestamp: ts };
  }
  if (trimmed.includes("article(s)") && (trimmed.includes("sequentially") || trimmed.includes("Processing"))) {
    return { stage: "writing", message: trimmed, timestamp: ts };
  }

  // Section-level logging from stderr (logger.info)
  if (trimmed.includes("Writing ") && trimmed.includes("sections (staggered")) {
    const match = trimmed.match(/Writing (\d+) sections/);
    return {
      stage: "writing",
      message: `Writing ${match?.[1] || "?"} sections...`,
      detail: match ? { totalSections: Number(match[1]) } : undefined,
      timestamp: ts,
    };
  }
  if (trimmed.includes("Section '") && trimmed.includes("chars")) {
    // "Section 'Introduction': 2.1s, 1234 chars, model=..."
    const match = trimmed.match(/Section '([^']+)'.*?([\d.]+)s.*?(\d+) chars/);
    return {
      stage: "writing",
      message: `Section done: ${match?.[1] || "unknown"}`,
      detail: match ? { section: match[1], time: Number(match[2]), chars: Number(match[3]) } : undefined,
      timestamp: ts,
    };
  }
  if (trimmed.includes("FAQ generation")) {
    return { stage: "writing", message: "Generating FAQ...", timestamp: ts };
  }

  // Research
  if (trimmed.includes("Deep research") || trimmed.includes("research index") || trimmed.includes("per-section research")) {
    return { stage: "researching", message: trimmed, timestamp: ts };
  }

  // Post-processing
  if (trimmed.includes("banned phrases") || trimmed.includes("Redacted") || trimmed.includes("placeholder") || trimmed.includes("post_processor")) {
    return { stage: "post_processing", message: trimmed.replace(/^\s*⚠\s*/, ""), timestamp: ts };
  }

  // Completion: "  ✓ 3500 words | 4 tables | 12 calls | 45s"
  if (trimmed.includes("✓") && trimmed.includes("words") && trimmed.includes("tables")) {
    const match = trimmed.match(/(\d+)\s*words.*?(\d+)\s*tables.*?(\d+)\s*calls.*?([\d.]+)s/);
    const qMatch = trimmed.match(/Quality:\s*(\w+)\s*\(([\d.]+)\/100\)/);
    return {
      stage: "done",
      message: trimmed.replace(/^\s*✓\s*/, ""),
      detail: {
        wordCount: match ? Number(match[1]) : 0,
        tableCount: match ? Number(match[2]) : 0,
        apiCalls: match ? Number(match[3]) : 0,
        time: match ? Number(match[4]) : 0,
        qualityGrade: qMatch?.[1],
        qualityScore: qMatch ? Number(qMatch[2]) : undefined,
      },
      timestamp: ts,
    };
  }

  // Error
  if (trimmed.includes("✗") || trimmed.toLowerCase().includes("error:")) {
    return { stage: "error", message: trimmed.replace(/^\s*✗\s*/, ""), timestamp: ts };
  }

  // Article path output — only article.html is "done", outline paths are "outlining"
  if (trimmed.startsWith("→") || trimmed.startsWith("  →")) {
    const pathStr = trimmed.replace(/^\s*→\s*/, "");
    if (pathStr.includes("article") || pathStr.includes(".html")) {
      return { stage: "done", message: pathStr, detail: { articlePath: pathStr }, timestamp: ts };
    }
    // Outline/research paths
    return { stage: "outlining", message: pathStr, timestamp: ts };
  }

  // Generic progress (anything else with content)
  return null;
}

/* ── Spawn pipeline and yield events ── */
export async function* runPipeline(
  sessionId: string,
  topic: string,
  options?: { subKeywords?: string; region?: string; articleType?: string; customOutline?: string }
): AsyncGenerator<PipelineEvent> {
  const env = buildEnv(sessionId);

  // Use the write command with --topic (it auto-generates outline if needed)
  // -u = unbuffered stdout/stderr so SSE gets events in real-time
  const args = ["-u", "-m", "src.main", "write", "--topic", topic];

  // Pass all options as env vars so Python outliner picks them up
  if (options?.subKeywords?.trim()) env.SUB_KEYWORDS = options.subKeywords.trim();
  if (options?.region?.trim()) env.ARTICLE_REGION = options.region.trim();
  if (options?.articleType?.trim()) env.ARTICLE_TYPE = options.articleType.trim();
  if (options?.customOutline?.trim()) env.CUSTOM_OUTLINE = options.customOutline.trim();

  // Speed: raise You.com search concurrency to match available key pool (17 keys)
  env.SEARCH_CONCURRENCY = "12";

  // Force unbuffered Python output
  env.PYTHONUNBUFFERED = "1";

  yield { stage: "queued", message: `Starting pipeline for: ${topic}`, timestamp: Date.now() };

  const child: ChildProcess = spawn(PYTHON_BIN, args, {
    cwd: PIPELINE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Collect lines from stdout and stderr
  const lineQueue: string[] = [];
  let done = false;
  let exitCode: number | null = null;
  let stderrBuffer = "";

  const processStream = (stream: NodeJS.ReadableStream) => {
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        lineQueue.push(line);
      }
    });
    stream.on("end", () => {
      if (buffer) lineQueue.push(buffer);
    });
  };

  if (child.stdout) processStream(child.stdout);
  if (child.stderr) {
    let buf = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      buf += text;
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) lineQueue.push(line);
    });
    child.stderr.on("end", () => {
      if (buf) lineQueue.push(buf);
    });
  }

  child.on("close", (code) => {
    exitCode = code;
    done = true;
  });

  child.on("error", (err) => {
    lineQueue.push(`✗ Error: ${err.message}`);
    done = true;
  });

  // Yield classifying stage immediately
  yield { stage: "classifying", message: "Classifying topic...", timestamp: Date.now() };

  // Poll for events — send keepalive heartbeat every 15s to prevent connection timeout
  let lastYield = Date.now();
  let lastKnownStage: PipelineStage = "classifying";

  while (!done || lineQueue.length > 0) {
    if (lineQueue.length > 0) {
      const line = lineQueue.shift()!;
      const event = parseLine(line);
      if (event) {
        yield event;
        lastYield = Date.now();
        lastKnownStage = event.stage;
      }
    } else {
      // Send keepalive if no events for 15 seconds (prevents browser/proxy timeout)
      if (Date.now() - lastYield > 15000) {
        yield { stage: lastKnownStage, message: "Pipeline running...", timestamp: Date.now() };
        lastYield = Date.now();
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Final event
  if (exitCode !== 0 && exitCode !== null) {
    // Extract last meaningful error from stderr
    const errLines = stderrBuffer.split("\n").filter((l) => l.trim());
    const lastErr = errLines[errLines.length - 1] || `Process exited with code ${exitCode}`;
    yield { stage: "error", message: lastErr, timestamp: Date.now() };
  }
}

/* ── Kill a running process (for cancel) ── */
export function killProcess(child: ChildProcess) {
  if (!child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 5000);
  }
}

/* ── ATLAS Smart Writer Pipeline ── */
export async function* runAtlasPipeline(
  sessionId: string,
  topic: string,
  options?: { contentType?: string; force?: boolean }
): AsyncGenerator<PipelineEvent> {
  const env = buildEnv(sessionId);
  env.PYTHONUNBUFFERED = "1";

  // Layer in any keys from the ATLAS .env that aren't already set
  const atlasEnvPath = path.join(ATLAS_DIR, ".env");
  if (fs.existsSync(atlasEnvPath)) {
    const lines = fs.readFileSync(atlasEnvPath, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }

  // Map content-studio article types to ATLAS content types
  const atlasTypeMap: Record<string, string> = {
    college_profile:   "college_profile",
    college_placement: "college_placement",
    exam_guide:        "exam",
    ranking_list:      "ranking",
    career_guide:      "career",
  };
  const contentType = atlasTypeMap[options?.contentType || ""] || "college_placement";

  const args = ["atlas.py", topic, "--type", contentType, "--use-you-research"];
  if (options?.force) args.push("--force");

  yield { stage: "queued", message: `Starting ATLAS pipeline for: ${topic}`, timestamp: Date.now() };
  yield { stage: "classifying", message: "Building topic blueprint...", timestamp: Date.now() };

  const child: ChildProcess = spawn(PYTHON_BIN, args, {
    cwd: ATLAS_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lineQueue: string[] = [];
  let done = false;
  let exitCode: number | null = null;
  let stderrBuffer = "";

  const processStream = (stream: NodeJS.ReadableStream) => {
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) lineQueue.push(line);
    });
    stream.on("end", () => { if (buffer) lineQueue.push(buffer); });
  };

  if (child.stdout) processStream(child.stdout);
  if (child.stderr) {
    let buf = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      buf += text;
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) lineQueue.push(line);
    });
    child.stderr.on("end", () => { if (buf) lineQueue.push(buf); });
  }

  child.on("close", (code) => { exitCode = code; done = true; });
  child.on("error", (err) => { lineQueue.push(`✗ Error: ${err.message}`); done = true; });

  let lastYield = Date.now();
  let lastKnownStage: PipelineStage = "classifying";

  while (!done || lineQueue.length > 0) {
    if (lineQueue.length > 0) {
      const line = lineQueue.shift()!;
      const event = parseAtlasLine(line);
      if (event) {
        yield event;
        lastYield = Date.now();
        lastKnownStage = event.stage;
      }
    } else {
      if (Date.now() - lastYield > 15000) {
        yield { stage: lastKnownStage, message: "Pipeline running...", timestamp: Date.now() };
        lastYield = Date.now();
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (exitCode !== 0 && exitCode !== null) {
    const errLines = stderrBuffer.split("\n").filter((l) => l.trim());
    const lastErr = errLines[errLines.length - 1] || `Process exited with code ${exitCode}`;
    yield { stage: "error", message: lastErr, timestamp: Date.now() };
  }
}

function parseAtlasLine(line: string): PipelineEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const ts = Date.now();

  // Stage header: "  Stage N/11 — Name"
  const stageMatch = trimmed.match(/Stage\s+(\d+)\/11\s*[—\-]+\s*(.+)/);
  if (stageMatch) {
    const n = parseInt(stageMatch[1]);
    const name = stageMatch[2].trim();
    let stage: PipelineStage = "classifying";
    if (n <= 2)      stage = "classifying";
    else if (n <= 5) stage = "researching";
    else if (n === 7) stage = "outlining";
    else if (n <= 9) stage = "writing";
    else             stage = "post_processing";
    return { stage, message: `Stage ${n}: ${name}`, timestamp: ts };
  }

  // Section written: "Stage 8 [3]: writing: Some Heading"
  if (trimmed.includes("Stage 8") && trimmed.includes("writing:")) {
    return { stage: "writing", message: trimmed.replace(/^\S+\s+/, ""), timestamp: ts };
  }

  // Sections complete: "Stage 8: N sections written, N total words"
  if (trimmed.includes("Stage 8:") && trimmed.includes("sections written")) {
    return { stage: "writing", message: trimmed.replace(/^.*Stage 8:\s*/, ""), timestamp: ts };
  }

  // Coherence: "Stage 10: article saved — N words, READY/NEEDS REVIEW"
  if (trimmed.includes("article saved") && trimmed.includes("words")) {
    const wMatch = trimmed.match(/(\d+)\s*words/);
    const ready = !trimmed.includes("NEEDS REVIEW");
    return {
      stage: "done",
      message: trimmed.replace(/^.*Stage 10:\s*/, ""),
      detail: { wordCount: wMatch ? Number(wMatch[1]) : 0, coherencePassed: ready },
      timestamp: ts,
    };
  }

  // Proofread done: "Stage 11: N paragraphs corrected"
  if (trimmed.includes("Stage 11:") && trimmed.includes("paragraphs")) {
    return { stage: "post_processing", message: trimmed.replace(/^.*Stage 11:\s*/, ""), timestamp: ts };
  }

  // Output path from summary: "  Output:   output/006-slug/article.html"
  const outputMatch = trimmed.match(/Output:\s+(output\/[^\s]+\/article\.html)/);
  if (outputMatch) {
    const relPath = outputMatch[1];
    const articlePath = path.join(ATLAS_DIR, relPath);
    // Extract slug: the directory between output/ and /article.html
    const slugMatch = relPath.match(/output\/([^/]+)\/article\.html/);
    return {
      stage: "done",
      message: articlePath,
      detail: { articlePath, atlasSlug: slugMatch?.[1] },
      timestamp: ts,
    };
  }

  // Error — startsWith("✗") catches errors pushed directly to queue;
  // "Pipeline failed" catches Python-level failures; "error:" catches exception traces.
  // Deliberately NOT trimmed.includes("✗") because INFO log lines contain "→ ✗ entity mismatch"
  // which are informational recovery messages, not pipeline failures.
  if (trimmed.startsWith("✗") || trimmed.includes("Pipeline failed") ||
      (trimmed.toLowerCase().includes("error:") && !trimmed.includes("ERROR: 0"))) {
    return { stage: "error", message: trimmed.replace(/^\s*✗\s*/, ""), timestamp: ts };
  }

  return null;
}

/* ── News Article Generation Pipeline ── */
export async function* runNewsPipeline(
  sessionId: string,
  title: string,
  options?: { competitorUrl?: string; tags?: string; status?: string }
): AsyncGenerator<PipelineEvent> {
  const env = buildEnv(sessionId);
  env.PYTHONUNBUFFERED = "1";
  env.SEARCH_CONCURRENCY = "12";

  // Create a temporary Excel file with the news item
  // The Python `news` command reads from Excel: title | competitor_url | tags | source
  const tmpDir = path.join(PIPELINE_DIR, "input");
  const tmpFile = path.join(tmpDir, `_studio_news_${Date.now()}.xlsx`);

  try {
    // Write a minimal xlsx using a simple XLSX writer
    // We use Python to create it since openpyxl is already available
    const createScript = `
import openpyxl, sys
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "News"
ws.append(["title", "competitor_url", "tags", "source"])
ws.append([sys.argv[1], sys.argv[2], sys.argv[3], "content-studio"])
wb.save(sys.argv[4])
`;
    const createArgs = [
      "-c", createScript,
      title,
      options?.competitorUrl || "",
      options?.tags || "",
      tmpFile,
    ];

    // Create the temp Excel synchronously
    const { execFileSync } = await import("child_process");
    execFileSync(PYTHON_BIN, createArgs, { cwd: PIPELINE_DIR, env, timeout: 10000 });

    yield { stage: "queued", message: `Starting news pipeline for: ${title}`, timestamp: Date.now() };
    yield { stage: "classifying", message: "Preparing news article...", timestamp: Date.now() };

    // Run: python -m src.main news --row 2 --input {tmpFile} --status draft
    const newsStatus = options?.status || "draft";
    const args = ["-u", "-m", "src.main", "news", "--row", "2", "--input", tmpFile, "--status", newsStatus];

    const child: ChildProcess = spawn(PYTHON_BIN, args, {
      cwd: PIPELINE_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const lineQueue: string[] = [];
    let done = false;
    let exitCode: number | null = null;
    let stderrBuffer = "";

    const processStream = (stream: NodeJS.ReadableStream) => {
      let buffer = "";
      stream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) lineQueue.push(line);
      });
      stream.on("end", () => { if (buffer) lineQueue.push(buffer); });
    };

    if (child.stdout) processStream(child.stdout);
    if (child.stderr) {
      let buf = "";
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuffer += text;
        buf += text;
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) lineQueue.push(line);
      });
      child.stderr.on("end", () => { if (buf) lineQueue.push(buf); });
    }

    child.on("close", (code) => { exitCode = code; done = true; });
    child.on("error", (err) => { lineQueue.push(`✗ Error: ${err.message}`); done = true; });

    // Poll for events with keepalive
    let lastYield = Date.now();
    let lastKnownStage: PipelineStage = "classifying";

    while (!done || lineQueue.length > 0) {
      if (lineQueue.length > 0) {
        const line = lineQueue.shift()!;
        const event = parseNewsLine(line);
        if (event) {
          yield event;
          lastYield = Date.now();
          lastKnownStage = event.stage;
        }
      } else {
        if (Date.now() - lastYield > 15000) {
          yield { stage: lastKnownStage, message: "Pipeline running...", timestamp: Date.now() };
          lastYield = Date.now();
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (exitCode !== 0 && exitCode !== null) {
      const errLines = stderrBuffer.split("\n").filter((l) => l.trim());
      const lastErr = errLines[errLines.length - 1] || `Process exited with code ${exitCode}`;
      yield { stage: "error", message: lastErr, timestamp: Date.now() };
    }
  } finally {
    // Clean up temp file
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/* ── Parse news pipeline output lines ── */
function parseNewsLine(line: string): PipelineEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const ts = Date.now();

  // Scraping competitor
  if (trimmed.includes("Scraping") || trimmed.includes("scraping") || trimmed.includes("competitor")) {
    return { stage: "researching", message: trimmed.replace(/^\s*[✓⚠✗]\s*/, ""), timestamp: ts };
  }

  // Research
  if (trimmed.includes("research") || trimmed.includes("Research") || trimmed.includes("snippets") ||
      trimmed.includes("Building research") || trimmed.includes("search") || trimmed.includes("query")) {
    return { stage: "researching", message: trimmed.replace(/^\s*[✓⚠✗]\s*/, ""), timestamp: ts };
  }

  // Writing
  if (trimmed.includes("Writing news") || trimmed.includes("Generating") || trimmed.includes("Gemini") ||
      trimmed.includes("gemini") || trimmed.includes("LLM call") || trimmed.includes("prompt")) {
    return { stage: "writing", message: trimmed.replace(/^\s*[✓⚠✗]\s*/, ""), timestamp: ts };
  }

  // Media enrichment
  if (trimmed.includes("YouTube") || trimmed.includes("youtube") || trimmed.includes("tweet") ||
      trimmed.includes("Twitter") || trimmed.includes("x.com") || trimmed.includes("PDF") ||
      trimmed.includes("media") || trimmed.includes("embed") || trimmed.includes("enrichment")) {
    return { stage: "post_processing", message: `Media: ${trimmed.replace(/^\s*[✓⚠✗]\s*/, "")}`, timestamp: ts };
  }

  // Post-processing
  if (trimmed.includes("post_process") || trimmed.includes("banned") || trimmed.includes("clean") ||
      trimmed.includes("internal links") || trimmed.includes("chart")) {
    return { stage: "post_processing", message: trimmed.replace(/^\s*[✓⚠✗]\s*/, ""), timestamp: ts };
  }

  // Publishing
  if (trimmed.includes("Publishing") || trimmed.includes("WordPress") || trimmed.includes("wp_post") ||
      trimmed.includes("Published") || trimmed.includes("draft")) {
    return { stage: "post_processing", message: trimmed.replace(/^\s*[✓⚠✗]\s*/, ""), timestamp: ts };
  }

  // Google Indexing
  if (trimmed.includes("indexing") || trimmed.includes("Indexing") || trimmed.includes("Google Index")) {
    return { stage: "post_processing", message: trimmed.replace(/^\s*[✓⚠✗]\s*/, ""), timestamp: ts };
  }

  // Completion
  if (trimmed.includes("✓") && (trimmed.includes("words") || trimmed.includes("published") || trimmed.includes("done"))) {
    const wMatch = trimmed.match(/(\d+)\s*words/);
    const tMatch = trimmed.match(/([\d.]+)s/);
    return {
      stage: "done",
      message: trimmed.replace(/^\s*✓\s*/, ""),
      detail: {
        wordCount: wMatch ? Number(wMatch[1]) : 0,
        time: tMatch ? Number(tMatch[1]) : 0,
        articleType: "news",
      },
      timestamp: ts,
    };
  }

  // Article path
  if (trimmed.startsWith("→") || trimmed.startsWith("  →")) {
    const pathStr = trimmed.replace(/^\s*→\s*/, "");
    if (pathStr.includes("article") || pathStr.includes(".html")) {
      return { stage: "done", message: pathStr, detail: { articlePath: pathStr, articleType: "news" }, timestamp: ts };
    }
    return null;
  }

  // Skipping (already published)
  if (trimmed.includes("Skipping") || trimmed.includes("already")) {
    return { stage: "done", message: trimmed.replace(/^\s*[✓⚠]\s*/, ""), timestamp: ts };
  }

  // Error
  if (trimmed.includes("✗") || trimmed.toLowerCase().includes("error:")) {
    return { stage: "error", message: trimmed.replace(/^\s*✗\s*/, ""), timestamp: ts };
  }

  return null;
}

/* ── News Discovery — fetch RSS feeds and extract items ── */
interface NewsDiscoveryItem {
  title: string;
  url: string;
  source: string;
  tags: string;
  published: string;
}

export async function discoverNews(sessionId: string): Promise<NewsDiscoveryItem[]> {
  const { getNewsSources } = await import("./db");
  const sources = getNewsSources(sessionId) as {
    id: string; name: string; url: string; source_type: string; category: string; enabled: number;
  }[];

  const enabledSources = sources.filter((s) => s.enabled);
  if (enabledSources.length === 0) return [];

  const allItems: NewsDiscoveryItem[] = [];
  const seenUrls = new Set<string>();

  // Fetch feeds in parallel batches of 10
  const batchSize = 10;
  for (let i = 0; i < enabledSources.length; i += batchSize) {
    const batch = enabledSources.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (source) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          const res = await fetch(source.url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; ContentStudio/1.0)",
              Accept: "application/rss+xml, application/xml, text/xml, */*",
            },
          });
          clearTimeout(timeout);

          if (!res.ok) return [];

          const xml = await res.text();
          return parseRssItems(xml, source.name, source.category);
        } catch {
          return [];
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          // Deduplicate by normalized URL
          const norm = item.url.replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "");
          if (seenUrls.has(norm)) continue;
          seenUrls.add(norm);

          // Skip non-education items from general feeds
          if (isEducationRelevant(item.title)) {
            allItems.push(item);
          }
        }
      }
    }
  }

  return allItems;
}

/* ── Simple RSS XML parser (no external dependency) ── */
function parseRssItems(xml: string, sourceName: string, category: string): NewsDiscoveryItem[] {
  const items: NewsDiscoveryItem[] = [];

  // Match <item> or <entry> blocks
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    // Extract title
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    let title = titleMatch?.[1]?.trim() || "";
    title = title.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    // Extract link
    let url = "";
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (linkMatch) url = linkMatch[1]?.trim() || "";
    // For Google News, extract the actual URL from the redirect
    if (url.includes("news.google.com") && url.includes("&url=")) {
      const actualUrl = url.match(/[&?]url=([^&]+)/);
      if (actualUrl) url = decodeURIComponent(actualUrl[1]);
    }

    // Extract published date
    const pubMatch = block.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);
    const published = pubMatch?.[1]?.trim() || "";

    // Extract description/summary
    const descMatch = block.match(/<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/i);
    let description = descMatch?.[1]?.trim() || "";
    description = description.replace(/<[^>]*>/g, "").slice(0, 200);

    // Strip " - Publisher Name" from Google News titles
    title = title.replace(/\s*-\s*[^-]{3,30}$/, "");

    if (title && url) {
      items.push({
        title,
        url,
        source: sourceName,
        tags: category,
        published,
      });
    }
  }

  return items.slice(0, 20); // Max 20 per source
}

/* ── Education relevance filter ── */
const EDU_KEYWORDS = /\b(exam|admit|card|result|cutoff|neet|jee|gate|cat|clat|cuet|upsc|ssc|ibps|ctet|tet|board|cbse|icse|university|college|admission|scholarship|placement|ranking|nirf|nta|ugc|aicte|recruitment|vacancy|notification|registration|counselling|merit|answer.key|datesheet|syllabus|preparation|mbbs|btech|mba|bca|mca|phd|degree|diploma|education|student|school|teacher|faculty|campus|hostel|fee|loan|career|salary|job|internship)\b/i;
const NON_EDU = /\b(cricket|ipl|bollywood|movie|weather|horoscope|astrology|recipe|fashion|entertainment|sports|stock.market|sensex|nifty)\b/i;

function isEducationRelevant(title: string): boolean {
  if (NON_EDU.test(title)) return false;
  if (EDU_KEYWORDS.test(title)) return true;
  // If it doesn't clearly match education, still allow — better to have false positives than miss news
  return true;
}
