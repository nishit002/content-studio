import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";

const SESSION_COOKIE = "cs-session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Get or create a session. Returns the session ID.
 * Call this at the start of every API route.
 */
export async function getSession(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE);

  if (existing?.value) {
    const db = getDb();
    const row = db
      .prepare("SELECT id FROM sessions WHERE id = ?")
      .get(existing.value) as { id: string } | undefined;

    if (row) {
      // Touch last_active
      db.prepare("UPDATE sessions SET last_active = datetime('now') WHERE id = ?").run(row.id);
      return row.id;
    }
  }

  // Create new session
  const sessionId = uuidv4();
  const db = getDb();
  db.prepare("INSERT INTO sessions (id) VALUES (?)").run(sessionId);

  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  // Seed with default config
  seedDefaults(sessionId);

  return sessionId;
}

/**
 * Seed a new session with default configuration values.
 */
function seedDefaults(sessionId: string) {
  const db = getDb();

  const defaultConfig: Record<string, string> = {
    project_name: "",
    website: "",
    brand_name: "",
    industry: "",
    target_audience: "",
    default_region: "",
    default_tone: "Professional",
    default_word_count: "2500",
    faq_count: "8",
    include_schema: "true",
    include_internal_links: "true",
    charts_enabled: "true",
    // WordPress
    wp_site_url: "",
    wp_username: "",
    wp_app_password: "",
    wp_default_status: "draft",
    wp_default_category: "Articles",
    // Publishing
    supabase_url: "",
    supabase_anon_key: "",
    google_indexing_enabled: "false",
    // Image
    image_width: "1200",
    image_height: "630",
  };

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO config (session_id, key, value) VALUES (?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(defaultConfig)) {
      stmt.run(sessionId, key, value);
    }
  });
  tx();

  // Seed default writing rules
  const defaultBannedPhrases = [
    "delve", "delves", "delving", "landscape", "comprehensive guide", "navigate",
    "crucial", "essential", "moreover", "furthermore", "indeed", "consequently",
    "subsequently", "paramount", "plethora", "myriad", "robust", "synergy",
    "leverage", "paradigm", "holistic", "facilitate", "endeavor", "encompasses",
    "intricacies", "nuances", "realm", "sphere", "pivotal", "imperative",
    "underscores", "underscoring", "tapestry", "unveil", "unveils", "embark",
    "in conclusion", "to sum up", "in summary",
    "it is worth noting", "needless to say", "without a doubt",
    "in today's world", "in the current scenario",
    "plays a vital role", "stands as a testament", "serves as a beacon",
    "paves the way", "in the ever-evolving", "in this day and age",
    "plays a crucial role", "it is worth mentioning",
    "additionally", "enhance", "enhances", "enhancing", "fostering", "fosters",
    "highlight", "highlights", "showcase", "showcasing",
    "vibrant", "nestled", "groundbreaking", "renowned", "must-visit", "stunning",
    "boasts", "testament", "game-changing", "revolutionary", "unprecedented",
    "immense potential", "the future looks bright",
    "at the end of the day", "it goes without saying", "has the ability to",
    "due to the fact that", "in order to achieve",
  ];

  const defaultAiReplacements: Record<string, string> = {
    "plays a vital role in": "is key to",
    "plays a crucial role in": "is key to",
    "serves as a testament to": "shows",
    "stands as a testament to": "shows",
    "in order to": "to",
    "due to the fact that": "because",
    "with regard to": "about",
    "a large number of": "many",
    "the vast majority of": "most",
    "at this point in time": "now",
    "prior to": "before",
    "subsequent to": "after",
    "groundbreaking": "notable",
    "game-changing": "significant",
    "cutting-edge": "advanced",
    "state-of-the-art": "modern",
    "world-class": "top-tier",
    "unprecedented": "rare",
    "paradigm shift": "major change",
    "synergy": "collaboration",
    "leverage": "use",
    "robust": "strong",
    "vibrant": "active",
    "nestled in": "located in",
    "delve into": "explore",
    "embark on": "start",
    "foster": "build",
    "facilitate": "help",
    "plethora of": "many",
    "myriad": "many",
    "paramount": "important",
    "comprehensive": "full",
    "equips you with": "teaches",
    "cultivates": "builds",
  };

  const defaultTableBannedValues = [
    "not specified", "not available", "n/a", "na", "nil", "none",
    "varies", "variable", "competitive", "attractive", "handsome",
    "decent", "promising", "good", "excellent", "high",
    "to be announced", "tba", "tbd", "not disclosed",
    "not mentioned", "not applicable", "check website", "visit website",
    "contact college", "as per norms", "depends", "on merit",
  ];

  const defaultQualityThresholds = {
    word_count_weight: 15,
    data_density_weight: 20,
    heading_structure_weight: 15,
    tables_lists_weight: 15,
    readability_weight: 15,
    completeness_weight: 10,
    variety_weight: 10,
    max_sentence_words: 25,
    max_paragraph_sentences: 4,
    target_data_density: 2.0,
    min_table_rows: 8,
    max_table_rows: 30,
    passive_voice_threshold: 30,
    fact_check_threshold: 60,
    pass_score: 55,
  };

  const rulesStmt = db.prepare(
    `INSERT OR IGNORE INTO writing_rules (session_id, rule_type, rules_json) VALUES (?, ?, ?)`
  );
  const rulesTx = db.transaction(() => {
    rulesStmt.run(sessionId, "banned_phrases", JSON.stringify(defaultBannedPhrases));
    rulesStmt.run(sessionId, "ai_replacements", JSON.stringify(defaultAiReplacements));
    rulesStmt.run(sessionId, "table_banned_values", JSON.stringify(defaultTableBannedValues));
    rulesStmt.run(sessionId, "quality_thresholds", JSON.stringify(defaultQualityThresholds));
  });
  rulesTx();
}
