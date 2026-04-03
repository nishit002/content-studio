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

    -- AEO / SRO audits
    CREATE TABLE IF NOT EXISTS aeo_audits (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      audit_type TEXT NOT NULL DEFAULT 'aeo',
      url TEXT NOT NULL,
      keyword TEXT DEFAULT '',
      score INTEGER DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- AEO Brand Config (one row per session)
    CREATE TABLE IF NOT EXISTS aeo_brand_config (
      session_id TEXT PRIMARY KEY,
      brand_name TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      competitors TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- AEO Tracking Prompts
    CREATE TABLE IF NOT EXISTS aeo_prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      volume_data TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- AEO Scrape Runs (one row per provider × prompt execution)
    CREATE TABLE IF NOT EXISTS aeo_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      sources_json TEXT NOT NULL DEFAULT '[]',
      visibility_score INTEGER NOT NULL DEFAULT 0,
      sentiment TEXT NOT NULL DEFAULT 'neutral',
      brand_mentioned INTEGER NOT NULL DEFAULT 0,
      competitors_json TEXT NOT NULL DEFAULT '[]',
      snapshot_id TEXT DEFAULT '',
      accuracy_flags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- AEO Battlecards
    CREATE TABLE IF NOT EXISTS aeo_battlecards (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      competitor TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      sections_json TEXT NOT NULL DEFAULT '[]',
      sentiment TEXT NOT NULL DEFAULT 'neutral',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- AEO Schedule settings (one row per session)
    CREATE TABLE IF NOT EXISTS aeo_schedule (
      session_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_ms INTEGER NOT NULL DEFAULT 86400000,
      last_run_at TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- AEO Drift Alerts
    CREATE TABLE IF NOT EXISTS aeo_drift_alerts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      provider TEXT NOT NULL,
      old_score INTEGER NOT NULL DEFAULT 0,
      new_score INTEGER NOT NULL DEFAULT 0,
      delta INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    CREATE INDEX IF NOT EXISTS idx_aeo_audits_session ON aeo_audits(session_id);
    CREATE INDEX IF NOT EXISTS idx_aeo_prompts_session ON aeo_prompts(session_id);
    CREATE INDEX IF NOT EXISTS idx_aeo_runs_session ON aeo_runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_aeo_runs_provider ON aeo_runs(session_id, provider);
    CREATE INDEX IF NOT EXISTS idx_aeo_battlecards_session ON aeo_battlecards(session_id);
    CREATE INDEX IF NOT EXISTS idx_aeo_drift_session ON aeo_drift_alerts(session_id);

    -- Bulk generation run history
    CREATE TABLE IF NOT EXISTS bulk_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      status TEXT DEFAULT 'running',
      total INTEGER DEFAULT 0,
      done INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      total_words INTEGER DEFAULT 0,
      items_json TEXT DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bulk_runs_session ON bulk_runs(session_id);

    -- AEO Competitor Research (URL-based keyword intelligence, cached per domain)
    CREATE TABLE IF NOT EXISTS aeo_competitor_research (
      session_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, domain),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_aeo_competitor_research ON aeo_competitor_research(session_id);
  `);

  // Column migrations — ADD COLUMN is idempotent via try/catch (SQLite has no IF NOT EXISTS for columns)
  const colMigrations = [
    "ALTER TABLE aeo_prompts ADD COLUMN volume_data TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE aeo_runs ADD COLUMN accuracy_flags TEXT NOT NULL DEFAULT ''",
  ];
  for (const sql of colMigrations) {
    try { db.exec(sql); } catch { /* column already exists — safe to ignore */ }
  }
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

/* ── AEO / SRO Audit helpers ── */
export function saveAudit(sessionId: string, id: string, auditType: "aeo" | "sro", url: string, keyword: string, score: number, result: unknown) {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO aeo_audits (id, session_id, audit_type, url, keyword, score, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, sessionId, auditType, url, keyword, score, JSON.stringify(result));
}

export function getAuditHistory(sessionId: string, limit = 20) {
  const db = getDb();
  return db
    .prepare("SELECT id, audit_type, url, keyword, score, created_at FROM aeo_audits WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(sessionId, limit) as { id: string; audit_type: string; url: string; keyword: string; score: number; created_at: string }[];
}

/* ── AEO Brand Config ── */
export interface AeoBrandConfig { brandName: string; aliases: string; website: string; industry: string; keywords: string; description: string; competitors: string; }

export function getAeoBrandConfig(sessionId: string): AeoBrandConfig {
  const db = getDb();
  const row = db.prepare("SELECT * FROM aeo_brand_config WHERE session_id = ?").get(sessionId) as Record<string, string> | undefined;
  return { brandName: row?.brand_name ?? "", aliases: row?.aliases ?? "", website: row?.website ?? "", industry: row?.industry ?? "", keywords: row?.keywords ?? "", description: row?.description ?? "", competitors: row?.competitors ?? "" };
}

export function setAeoBrandConfig(sessionId: string, c: AeoBrandConfig) {
  getDb().prepare("INSERT OR REPLACE INTO aeo_brand_config (session_id, brand_name, aliases, website, industry, keywords, description, competitors, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))")
    .run(sessionId, c.brandName, c.aliases, c.website, c.industry, c.keywords, c.description, c.competitors);
}

/* ── AEO Prompts ── */
export interface AeoPrompt { id: string; promptText: string; volumeData: string; createdAt: string; }

export function getAeoPrompts(sessionId: string): AeoPrompt[] {
  return (getDb().prepare("SELECT id, prompt_text, COALESCE(volume_data,'') as volume_data, created_at FROM aeo_prompts WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as { id: string; prompt_text: string; volume_data: string; created_at: string }[]).map(r => ({ id: r.id, promptText: r.prompt_text, volumeData: r.volume_data, createdAt: r.created_at }));
}

export function updatePromptVolume(sessionId: string, id: string, volumeData: string) {
  getDb().prepare("UPDATE aeo_prompts SET volume_data = ? WHERE session_id = ? AND id = ?").run(volumeData, sessionId, id);
}

export function addAeoPrompt(sessionId: string, id: string, promptText: string) {
  getDb().prepare("INSERT OR IGNORE INTO aeo_prompts (id, session_id, prompt_text) VALUES (?,?,?)").run(id, sessionId, promptText);
}

export function deleteAeoPrompt(sessionId: string, id: string) {
  getDb().prepare("DELETE FROM aeo_prompts WHERE session_id = ? AND id = ?").run(sessionId, id);
}

/* ── AEO Runs ── */
export interface AeoRun { id: string; provider: string; promptText: string; answer: string; sources: string[]; visibilityScore: number; sentiment: string; brandMentioned: boolean; competitors: string[]; snapshotId: string; accuracyFlags: string; createdAt: string; }

export function saveAeoRun(sessionId: string, run: AeoRun) {
  getDb().prepare("INSERT OR REPLACE INTO aeo_runs (id, session_id, provider, prompt_text, answer, sources_json, visibility_score, sentiment, brand_mentioned, competitors_json, snapshot_id, accuracy_flags, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(run.id, sessionId, run.provider, run.promptText, run.answer, JSON.stringify(run.sources), run.visibilityScore, run.sentiment, run.brandMentioned ? 1 : 0, JSON.stringify(run.competitors), run.snapshotId, run.accuracyFlags ?? "", run.createdAt);
}

export function getAeoRuns(sessionId: string, limit = 200): AeoRun[] {
  return (getDb().prepare("SELECT * FROM aeo_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?").all(sessionId, limit) as Record<string, unknown>[]).map(r => ({
    id: r.id as string, provider: r.provider as string, promptText: r.prompt_text as string, answer: r.answer as string,
    sources: JSON.parse(r.sources_json as string) as string[], visibilityScore: r.visibility_score as number,
    sentiment: r.sentiment as string, brandMentioned: (r.brand_mentioned as number) === 1,
    competitors: JSON.parse(r.competitors_json as string) as string[], snapshotId: r.snapshot_id as string,
    accuracyFlags: (r.accuracy_flags as string) ?? "", createdAt: r.created_at as string,
  }));
}

export function updateRunAccuracy(sessionId: string, id: string, accuracyFlags: string) {
  getDb().prepare("UPDATE aeo_runs SET accuracy_flags = ? WHERE session_id = ? AND id = ?").run(accuracyFlags, sessionId, id);
}

export function deleteAeoRun(sessionId: string, id: string) {
  getDb().prepare("DELETE FROM aeo_runs WHERE session_id = ? AND id = ?").run(sessionId, id);
}

export function clearAeoRuns(sessionId: string) {
  getDb().prepare("DELETE FROM aeo_runs WHERE session_id = ?").run(sessionId);
}

/* ── AEO Battlecards ── */
export interface AeoBattlecard { id: string; competitor: string; summary: string; sections: { title: string; content: string }[]; sentiment: string; createdAt: string; }

export function getAeoBattlecards(sessionId: string): AeoBattlecard[] {
  return (getDb().prepare("SELECT * FROM aeo_battlecards WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as Record<string, unknown>[]).map(r => ({
    id: r.id as string, competitor: r.competitor as string, summary: r.summary as string,
    sections: JSON.parse(r.sections_json as string) as { title: string; content: string }[], sentiment: r.sentiment as string, createdAt: r.created_at as string,
  }));
}

export function saveAeoBattlecard(sessionId: string, card: AeoBattlecard) {
  getDb().prepare("INSERT OR REPLACE INTO aeo_battlecards (id, session_id, competitor, summary, sections_json, sentiment, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(card.id, sessionId, card.competitor, card.summary, JSON.stringify(card.sections), card.sentiment, card.createdAt);
}

export function deleteAeoBattlecard(sessionId: string, id: string) {
  getDb().prepare("DELETE FROM aeo_battlecards WHERE session_id = ? AND id = ?").run(sessionId, id);
}

/* ── AEO Schedule ── */
export interface AeoSchedule { enabled: boolean; intervalMs: number; lastRunAt: string; }

export function getAeoSchedule(sessionId: string): AeoSchedule {
  const r = getDb().prepare("SELECT * FROM aeo_schedule WHERE session_id = ?").get(sessionId) as Record<string, unknown> | undefined;
  return { enabled: (r?.enabled as number) === 1, intervalMs: (r?.interval_ms as number) ?? 86400000, lastRunAt: (r?.last_run_at as string) ?? "" };
}

export function setAeoSchedule(sessionId: string, s: AeoSchedule) {
  getDb().prepare("INSERT OR REPLACE INTO aeo_schedule (session_id, enabled, interval_ms, last_run_at, updated_at) VALUES (?,?,?,?,datetime('now'))")
    .run(sessionId, s.enabled ? 1 : 0, s.intervalMs, s.lastRunAt);
}

/* ── AEO Drift Alerts ── */
export interface AeoDriftAlert { id: string; promptText: string; provider: string; oldScore: number; newScore: number; delta: number; dismissed: boolean; createdAt: string; }

export function getAeoDriftAlerts(sessionId: string): AeoDriftAlert[] {
  return (getDb().prepare("SELECT * FROM aeo_drift_alerts WHERE session_id = ? ORDER BY created_at DESC LIMIT 50").all(sessionId) as Record<string, unknown>[]).map(r => ({
    id: r.id as string, promptText: r.prompt_text as string, provider: r.provider as string,
    oldScore: r.old_score as number, newScore: r.new_score as number, delta: r.delta as number,
    dismissed: (r.dismissed as number) === 1, createdAt: r.created_at as string,
  }));
}

export function saveAeoDriftAlert(sessionId: string, a: AeoDriftAlert) {
  getDb().prepare("INSERT OR REPLACE INTO aeo_drift_alerts (id, session_id, prompt_text, provider, old_score, new_score, delta, dismissed, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(a.id, sessionId, a.promptText, a.provider, a.oldScore, a.newScore, a.delta, a.dismissed ? 1 : 0, a.createdAt);
}

export function dismissAeoDriftAlert(sessionId: string, id: string) {
  getDb().prepare("UPDATE aeo_drift_alerts SET dismissed = 1 WHERE session_id = ? AND id = ?").run(sessionId, id);
}

/* ── AEO Competitor Research ── */
export interface CompetitorKeyword {
  text: string;
  type: "organic" | "ai_prompt";
  volume: number | null;
  trend: string;
  tracked: boolean;
}
export interface CompetitorResearchResult {
  id: string;
  domain: string;
  url: string;
  industry: string;
  brand: string;
  keywords: CompetitorKeyword[];
  totalVolume: number;
  analyzedAt: string;
  warning?: string;
}
export interface CompetitorResearchSummary {
  domain: string;
  brand: string;
  totalVolume: number;
  keywordCount: number;
  analyzedAt: string;
}

export function saveCompetitorResearch(sessionId: string, domain: string, data: CompetitorResearchResult) {
  getDb().prepare("INSERT OR REPLACE INTO aeo_competitor_research (session_id, domain, data_json, analyzed_at) VALUES (?,?,?,datetime('now'))")
    .run(sessionId, domain, JSON.stringify(data));
}

export function getCompetitorResearch(sessionId: string, domain: string): CompetitorResearchResult | null {
  const row = getDb().prepare("SELECT data_json FROM aeo_competitor_research WHERE session_id = ? AND domain = ?")
    .get(sessionId, domain) as { data_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.data_json) as CompetitorResearchResult; } catch { return null; }
}

export function listCompetitorResearch(sessionId: string): CompetitorResearchSummary[] {
  const rows = getDb().prepare("SELECT domain, analyzed_at, data_json FROM aeo_competitor_research WHERE session_id = ? ORDER BY analyzed_at DESC")
    .all(sessionId) as { domain: string; analyzed_at: string; data_json: string }[];
  return rows.map(r => {
    try {
      const d = JSON.parse(r.data_json) as CompetitorResearchResult;
      return { domain: r.domain, brand: d.brand || r.domain, totalVolume: d.totalVolume, keywordCount: d.keywords.length, analyzedAt: r.analyzed_at };
    } catch { return { domain: r.domain, brand: r.domain, totalVolume: 0, keywordCount: 0, analyzedAt: r.analyzed_at }; }
  });
}

export function deleteCompetitorResearch(sessionId: string, domain: string) {
  getDb().prepare("DELETE FROM aeo_competitor_research WHERE session_id = ? AND domain = ?").run(sessionId, domain);
}

/* ── Bulk Run helpers ── */
export interface BulkRunRow {
  id: string;
  name: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  total_words: number;
  started_at: string;
  completed_at: string | null;
}

export function createBulkRun(sessionId: string, name: string, total: number): string {
  const { randomUUID } = require("crypto") as typeof import("crypto");
  const id = randomUUID();
  getDb().prepare("INSERT INTO bulk_runs (id, session_id, name, status, total) VALUES (?,?,?,'running',?)").run(id, sessionId, name, total);
  return id;
}

export function updateBulkRun(
  id: string,
  updates: { status?: string; done?: number; failed?: number; totalWords?: number; items?: unknown[]; completedAt?: string }
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.status !== undefined) { sets.push("status = ?"); vals.push(updates.status); }
  if (updates.done !== undefined) { sets.push("done = ?"); vals.push(updates.done); }
  if (updates.failed !== undefined) { sets.push("failed = ?"); vals.push(updates.failed); }
  if (updates.totalWords !== undefined) { sets.push("total_words = ?"); vals.push(updates.totalWords); }
  if (updates.items !== undefined) { sets.push("items_json = ?"); vals.push(JSON.stringify(updates.items)); }
  if (updates.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(updates.completedAt); }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare(`UPDATE bulk_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function listBulkRuns(sessionId: string): BulkRunRow[] {
  return getDb()
    .prepare("SELECT id, name, status, total, done, failed, total_words, started_at, completed_at FROM bulk_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 50")
    .all(sessionId) as BulkRunRow[];
}

export function getBulkRun(sessionId: string, id: string): (BulkRunRow & { items_json: string }) | null {
  return getDb()
    .prepare("SELECT id, name, status, total, done, failed, total_words, started_at, completed_at, items_json FROM bulk_runs WHERE id = ? AND session_id = ?")
    .get(id, sessionId) as (BulkRunRow & { items_json: string }) | null;
}

export function deleteBulkRun(sessionId: string, id: string) {
  getDb().prepare("DELETE FROM bulk_runs WHERE id = ? AND session_id = ?").run(id, sessionId);
}
