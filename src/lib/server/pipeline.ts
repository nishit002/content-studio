/**
 * Python pipeline bridge — spawns content-generator subprocess and
 * yields structured progress events by parsing stdout/stderr.
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { getApiKeys, getConfig, getWritingRules } from "./db";

/* ── Path to the Python content-generator repo ── */
const PIPELINE_DIR = process.env.PIPELINE_DIR
  || path.resolve("/Users/nishitkumar/Documents/gas-split/content-generator");

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

  // HuggingFace keys
  const hfKeys = keys.filter((k) => k.provider === "huggingface");
  hfKeys.forEach((k, i) => {
    env[i === 0 ? "HF_TOKEN" : `HF_TOKEN_${i + 1}`] = k.key_value;
  });

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
  options?: { subKeywords?: string; region?: string }
): AsyncGenerator<PipelineEvent> {
  const env = buildEnv(sessionId);

  // Use the write command with --topic (it auto-generates outline if needed)
  // -u = unbuffered stdout/stderr so SSE gets events in real-time
  const args = ["-u", "-m", "src.main", "write", "--topic", topic];

  // Force unbuffered Python output
  env.PYTHONUNBUFFERED = "1";

  yield { stage: "queued", message: `Starting pipeline for: ${topic}`, timestamp: Date.now() };

  const child: ChildProcess = spawn("python3", args, {
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

  // Poll for events
  while (!done || lineQueue.length > 0) {
    if (lineQueue.length > 0) {
      const line = lineQueue.shift()!;
      const event = parseLine(line);
      if (event) yield event;
    } else {
      // Wait a bit before polling again
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
