/**
 * news-worker.mjs — Server-side news auto-discovery daemon
 *
 * Runs as a PM2 process. Reads news_auto_discovery and
 * news_auto_discovery_interval from the DB config every minute.
 * When enabled, fires discovery at the configured interval.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, 'data/content-studio.db');
const API_BASE = 'http://localhost:3000';

// Load CRON_SECRET from .env.local
function loadEnv() {
  try {
    const env = readFileSync(resolve(__dirname, '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const [key, ...vals] = line.split('=');
      if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
    }
  } catch { /* ignore */ }
}
loadEnv();

const CRON_SECRET = process.env.CRON_SECRET || '';
const PROJECT_SESSION_ID = process.env.PROJECT_SESSION_ID || '';

function getConfig(key, fallback) {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare(
      "SELECT value FROM config WHERE session_id = ? AND key = ?"
    ).get(PROJECT_SESSION_ID, key);
    db.close();
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

async function triggerDiscovery() {
  try {
    const res = await fetch(`${API_BASE}/api/news`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ action: 'discover' }),
    });
    const data = await res.json();
    console.log(`[news-worker] ${new Date().toISOString()} Discovery triggered — runId: ${data.runId}`);
  } catch (err) {
    console.error(`[news-worker] ${new Date().toISOString()} Discovery failed:`, err.message);
  }
}

async function main() {
  console.log(`[news-worker] Started. DB: ${DB_PATH}`);

  let lastRunTime = 0;

  // Check every 60 seconds whether discovery should fire
  setInterval(async () => {
    const enabled = getConfig('news_auto_discovery', '0');
    if (enabled !== '1') return;

    const intervalMinutes = parseInt(getConfig('news_auto_discovery_interval', '30'), 10);
    const intervalMs = Math.max(intervalMinutes, 5) * 60 * 1000; // min 5 minutes
    const now = Date.now();

    if (now - lastRunTime >= intervalMs) {
      lastRunTime = now;
      await triggerDiscovery();
    }
  }, 60_000);
}

main();
