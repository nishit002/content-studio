import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/* ── Database singleton ── */
const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "content-studio.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  migrate(_db);
  return _db;
}

/* ── Schema migrations ── */
function migrate(db: Database.Database) {
  db.exec(`
    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Project config (key-value store, per session)
    CREATE TABLE IF NOT EXISTS config (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, key),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- API keys (encrypted values stored as text)
    CREATE TABLE IF NOT EXISTS api_keys (
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      key_value TEXT NOT NULL,
      label TEXT DEFAULT '',
      status TEXT DEFAULT 'untested',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, provider, key_value),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Content library
    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      title TEXT DEFAULT '',
      slug TEXT DEFAULT '',
      content_type TEXT DEFAULT 'blog_post',
      primary_intent TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      word_count INTEGER DEFAULT 0,
      table_count INTEGER DEFAULT 0,
      quality_score INTEGER DEFAULT 0,
      html TEXT DEFAULT '',
      outline_yaml TEXT DEFAULT '',
      research_json TEXT DEFAULT '',
      meta_json TEXT DEFAULT '',
      error TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Generation jobs
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      job_type TEXT NOT NULL DEFAULT 'single',
      status TEXT DEFAULT 'queued',
      total_items INTEGER DEFAULT 1,
      completed_items INTEGER DEFAULT 0,
      failed_items INTEGER DEFAULT 0,
      config_json TEXT DEFAULT '{}',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Writing rules presets
    CREATE TABLE IF NOT EXISTS writing_rules (
      session_id TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      rules_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, rule_type),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- News sources
    CREATE TABLE IF NOT EXISTS news_sources (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      source_type TEXT DEFAULT 'rss',
      category TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Discovered news items
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      published TEXT DEFAULT '',
      status TEXT DEFAULT 'discovered',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (session_id, url),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- News discovery runs
    CREATE TABLE IF NOT EXISTS news_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      items_found INTEGER DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Analytics connections (GA4, GSC, Bing)
    CREATE TABLE IF NOT EXISTS analytics_connections (
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      token_expires_at TEXT NOT NULL DEFAULT '',
      property_id TEXT NOT NULL DEFAULT '',
      property_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, provider),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Analytics data cache
    CREATE TABLE IF NOT EXISTS analytics_cache (
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      date_range TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, provider, metric_type, date_range),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_content_session ON content(session_id);
    CREATE INDEX IF NOT EXISTS idx_content_status ON content(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_session ON jobs(session_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_session ON api_keys(session_id);
    CREATE INDEX IF NOT EXISTS idx_news_items_session ON news_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_news_items_url ON news_items(session_id, url);
    CREATE INDEX IF NOT EXISTS idx_news_runs_session ON news_runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_conn ON analytics_connections(session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_cache ON analytics_cache(session_id, provider);
  `);
}

/* ── Config helpers ── */
export function getConfig(sessionId: string): Record<string, string> {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM config WHERE session_id = ?")
    .all(sessionId) as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function setConfig(sessionId: string, key: string, value: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO config (session_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (session_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(sessionId, key, value);
}

export function setConfigBatch(sessionId: string, entries: Record<string, string>) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO config (session_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (session_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      stmt.run(sessionId, key, value);
    }
  });
  tx();
}

/* ── API key helpers ── */
export function getApiKeys(sessionId: string) {
  const db = getDb();
  return db
    .prepare("SELECT provider, key_value, label, status, updated_at FROM api_keys WHERE session_id = ? ORDER BY provider, label")
    .all(sessionId) as { provider: string; key_value: string; label: string; status: string; updated_at: string }[];
}

export function upsertApiKey(sessionId: string, provider: string, keyValue: string, label: string = "") {
  const db = getDb();
  db.prepare(
    `INSERT INTO api_keys (session_id, provider, key_value, label, status, updated_at)
     VALUES (?, ?, ?, ?, 'untested', datetime('now'))
     ON CONFLICT (session_id, provider, key_value) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`
  ).run(sessionId, provider, keyValue, label);
}

export function deleteApiKey(sessionId: string, provider: string, keyValue: string) {
  const db = getDb();
  db.prepare("DELETE FROM api_keys WHERE session_id = ? AND provider = ? AND key_value = ?").run(sessionId, provider, keyValue);
}

export function updateApiKeyStatus(sessionId: string, provider: string, keyValue: string, status: string) {
  const db = getDb();
  db.prepare("UPDATE api_keys SET status = ?, updated_at = datetime('now') WHERE session_id = ? AND provider = ? AND key_value = ?").run(
    status,
    sessionId,
    provider,
    keyValue
  );
}

/* ── Writing rules helpers ── */
export function getWritingRules(sessionId: string, ruleType: string): Record<string, unknown> | null {
  const db = getDb();
  const row = db
    .prepare("SELECT rules_json FROM writing_rules WHERE session_id = ? AND rule_type = ?")
    .get(sessionId, ruleType) as { rules_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.rules_json);
  } catch {
    return null;
  }
}

export function setWritingRules(sessionId: string, ruleType: string, rules: Record<string, unknown>) {
  const db = getDb();
  db.prepare(
    `INSERT INTO writing_rules (session_id, rule_type, rules_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (session_id, rule_type) DO UPDATE SET rules_json = excluded.rules_json, updated_at = excluded.updated_at`
  ).run(sessionId, ruleType, JSON.stringify(rules));
}

/* ── Content helpers ── */
export function getContentList(sessionId: string, filters?: { status?: string; type?: string; search?: string }) {
  const db = getDb();
  let sql = "SELECT id, topic, title, slug, content_type, primary_intent, status, word_count, table_count, quality_score, error, created_at, updated_at FROM content WHERE session_id = ?";
  const params: unknown[] = [sessionId];

  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.type) {
    sql += " AND content_type = ?";
    params.push(filters.type);
  }
  if (filters?.search) {
    sql += " AND (topic LIKE ? OR title LIKE ?)";
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  sql += " ORDER BY updated_at DESC";
  return db.prepare(sql).all(...params);
}

export function getContentById(sessionId: string, id: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM content WHERE session_id = ? AND id = ?").get(sessionId, id);
}

/* ── News source helpers ── */
export function getNewsSources(sessionId: string) {
  const db = getDb();
  return db
    .prepare("SELECT id, name, url, source_type, category, enabled, created_at FROM news_sources WHERE session_id = ? ORDER BY category, name")
    .all(sessionId);
}

export function upsertNewsSource(sessionId: string, id: string, name: string, url: string, sourceType: string, category: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO news_sources (id, session_id, name, url, source_type, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, url = excluded.url, source_type = excluded.source_type, category = excluded.category`
  ).run(id, sessionId, name, url, sourceType, category);
}

export function deleteNewsSource(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM news_sources WHERE id = ?").run(id);
}

/* ── Analytics connection helpers ── */
export interface AnalyticsConnection {
  provider: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  property_id: string;
  property_name: string;
  email: string;
  connected_at: string;
  updated_at: string;
}

export function getAnalyticsConnection(sessionId: string, provider: string): AnalyticsConnection | null {
  const db = getDb();
  return (db.prepare(
    "SELECT provider, access_token, refresh_token, token_expires_at, property_id, property_name, email, connected_at, updated_at FROM analytics_connections WHERE session_id = ? AND provider = ?"
  ).get(sessionId, provider) as AnalyticsConnection | undefined) ?? null;
}

export function getAllAnalyticsConnections(sessionId: string): AnalyticsConnection[] {
  const db = getDb();
  return db.prepare(
    "SELECT provider, access_token, refresh_token, token_expires_at, property_id, property_name, email, connected_at, updated_at FROM analytics_connections WHERE session_id = ? ORDER BY provider"
  ).all(sessionId) as AnalyticsConnection[];
}

export function upsertAnalyticsConnection(
  sessionId: string,
  provider: string,
  data: { access_token: string; refresh_token: string; token_expires_at: string; email?: string }
) {
  const db = getDb();
  db.prepare(
    `INSERT INTO analytics_connections (session_id, provider, access_token, refresh_token, token_expires_at, email, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (session_id, provider) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = CASE WHEN excluded.refresh_token = '' THEN analytics_connections.refresh_token ELSE excluded.refresh_token END,
       token_expires_at = excluded.token_expires_at,
       email = CASE WHEN excluded.email = '' THEN analytics_connections.email ELSE excluded.email END,
       updated_at = excluded.updated_at`
  ).run(sessionId, provider, data.access_token, data.refresh_token, data.token_expires_at, data.email ?? "");
}

export function setAnalyticsProperty(sessionId: string, provider: string, propertyId: string, propertyName: string) {
  const db = getDb();
  db.prepare(
    "UPDATE analytics_connections SET property_id = ?, property_name = ?, updated_at = datetime('now') WHERE session_id = ? AND provider = ?"
  ).run(propertyId, propertyName, sessionId, provider);
}

export function deleteAnalyticsConnection(sessionId: string, provider: string) {
  const db = getDb();
  db.prepare("DELETE FROM analytics_connections WHERE session_id = ? AND provider = ?").run(sessionId, provider);
  db.prepare("DELETE FROM analytics_cache WHERE session_id = ? AND provider = ?").run(sessionId, provider);
}

export function getAnalyticsCache(sessionId: string, provider: string, metricType: string, dateRange: string) {
  const db = getDb();
  const row = db.prepare(
    "SELECT data_json, fetched_at FROM analytics_cache WHERE session_id = ? AND provider = ? AND metric_type = ? AND date_range = ?"
  ).get(sessionId, provider, metricType, dateRange) as { data_json: string; fetched_at: string } | undefined;
  if (!row) return null;
  // Cache valid for 1 hour
  const age = Date.now() - new Date(row.fetched_at + "Z").getTime();
  if (age > 3600000) return null;
  try { return JSON.parse(row.data_json); } catch { return null; }
}

export function setAnalyticsCache(sessionId: string, provider: string, metricType: string, dateRange: string, data: unknown) {
  const db = getDb();
  db.prepare(
    `INSERT INTO analytics_cache (session_id, provider, metric_type, date_range, data_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (session_id, provider, metric_type, date_range) DO UPDATE SET
       data_json = excluded.data_json, fetched_at = excluded.fetched_at`
  ).run(sessionId, provider, metricType, dateRange, JSON.stringify(data));
}

/* ── Stats ── */
export function getStats(sessionId: string) {
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT status, COUNT(*) as count FROM content WHERE session_id = ? GROUP BY status`
    )
    .all(sessionId) as { status: string; count: number }[];

  const total = db
    .prepare("SELECT COUNT(*) as count FROM content WHERE session_id = ?")
    .get(sessionId) as { count: number };

  const avgQuality = db
    .prepare("SELECT AVG(quality_score) as avg FROM content WHERE session_id = ? AND quality_score > 0")
    .get(sessionId) as { avg: number | null };

  // Check which required API key providers are configured
  const configuredProviders = db
    .prepare("SELECT DISTINCT provider FROM api_keys WHERE session_id = ?")
    .all(sessionId) as { provider: string }[];
  const providerSet = new Set(configuredProviders.map((p) => p.provider));

  // Check if country/language are set
  const countryRow = db
    .prepare("SELECT value FROM config WHERE session_id = ? AND key = 'default_country'")
    .get(sessionId) as { value: string } | undefined;

  return {
    total: total.count,
    byStatus: Object.fromEntries(stats.map((s) => [s.status, s.count])),
    avgQuality: avgQuality.avg ? Math.round(avgQuality.avg) : 0,
    setup: {
      gemini: providerSet.has("gemini"),
      huggingface: providerSet.has("huggingface"),
      you_search: providerSet.has("you_search"),
      wordpress: providerSet.has("wordpress"),
      country: !!countryRow?.value,
    },
  };
}
