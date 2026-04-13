import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import { getDb, upsertApiKey, upsertNewsSource } from "./db";

const SESSION_COOKIE = "cs-session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function getSession(): Promise<string> {
  // If PROJECT_SESSION_ID is set, all authenticated users share one project session.
  // This ensures data (runs, content, config) is visible from any PC/browser.
  const projectSessionId = process.env.PROJECT_SESSION_ID;
  if (projectSessionId) {
    const db = getDb();
    const exists = db.prepare("SELECT id FROM sessions WHERE id = ?").get(projectSessionId);
    if (!exists) {
      db.prepare("INSERT INTO sessions (id) VALUES (?)").run(projectSessionId);
      seedDefaults(projectSessionId);
    } else {
      db.prepare("UPDATE sessions SET last_active = datetime('now') WHERE id = ?").run(projectSessionId);
    }
    return projectSessionId;
  }

  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE);

  if (existing?.value) {
    const db = getDb();
    const row = db
      .prepare("SELECT id FROM sessions WHERE id = ?")
      .get(existing.value) as { id: string } | undefined;

    if (row) {
      db.prepare("UPDATE sessions SET last_active = datetime('now') WHERE id = ?").run(row.id);
      return row.id;
    }
  }

  const sessionId = uuidv4();
  const db = getDb();
  db.prepare("INSERT INTO sessions (id) VALUES (?)").run(sessionId);

  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  seedDefaults(sessionId);
  return sessionId;
}

function seedDefaults(sessionId: string) {
  const db = getDb();

  /* ═══════════════════════════════════════════════════════════
   * 1. PROJECT CONFIG — FindMyCollege defaults
   * ═══════════════════════════════════════════════════════════ */
  const defaultConfig: Record<string, string> = {
    // Project
    project_name: "FindMyCollege Content Generator",
    website: "https://articles.findmycollege.com",
    brand_name: "FindMyCollege",
    industry: "education_india",
    target_audience: "Students, parents, and career aspirants in India",
    default_country: "IN",
    content_languages: "English,Hindi",
    default_tone: "Professional",
    current_year: "2026",

    // Content defaults
    default_word_count: "8000",
    faq_count: "8",
    min_table_rows: "12",
    max_table_rows: "30",
    max_prose_sentences_before: "4",
    max_prose_sentences_after: "2",
    max_paragraph_sentences: "4",
    include_schema: "true",
    include_internal_links: "true",
    charts_enabled: "true",

    // Search
    search_max_queries: "8",
    search_max_concurrent: "5",
    search_country: "IN",
    search_language: "EN",
    search_results_per_query: "10",
    search_cooldown_seconds: "30",
    search_cache_days: "7",

    // LLM - Gemini
    gemini_model: "gemini-2.5-flash",
    gemini_temperature: "0.2",
    gemini_max_tokens: "32000",
    gemini_timeout: "60",

    // LLM - Writer
    writer_model: "Qwen/Qwen3-235B-A22B",
    writer_temperature: "0.4",
    writer_max_tokens: "32000",
    writer_timeout: "90",
    writer_max_retries: "3",
    writer_retry_delays: "3,6,12",
    writer_api_url: "https://router.huggingface.co/v1/chat/completions",

    // LLM Concurrency
    max_concurrent_llm: "12",
    max_concurrent_search: "10",

    // WordPress (loaded from env)
    wp_site_url: process.env.WP_SITE_URL || "",
    wp_username: process.env.WP_USERNAME || "",
    wp_app_password: process.env.WP_APP_PASSWORD || "",
    wp_default_status: "draft",
    wp_default_category: "Articles",
    wp_default_author_id: "2",
    wp_author_ids: "13,12,5,6,3,11,10,4",
    wp_meta_description_max: "155",
    wp_image_width: "1200",
    wp_image_height: "630",
    wp_sitemap_url: "https://articles.findmycollege.com/sitemap.xml",

    // Image generation
    image_model: "black-forest-labs/FLUX.1-schnell",

    // Supabase (loaded from env)
    supabase_url: process.env.SUPABASE_URL || "",
    supabase_service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY || "",

    // DataForSEO (loaded from env)
    dataforseo_login: process.env.DATAFORSEO_LOGIN || "",
    dataforseo_password: process.env.DATAFORSEO_PASSWORD || "",

    // Google Ads (loaded from env)
    gads_developer_token: process.env.GADS_DEVELOPER_TOKEN || "",
    gads_client_id: process.env.GADS_CLIENT_ID || "",
    gads_client_secret: process.env.GADS_CLIENT_SECRET || "",
    gads_refresh_token: process.env.GADS_REFRESH_TOKEN || "",
    gads_login_customer_id: process.env.GADS_LOGIN_CUSTOMER_ID || "",

    // Google Indexing
    google_indexing_enabled: "false",

    // PDF research
    pdf_research_enabled: "true",
    pdf_max_per_topic: "5",
    pdf_max_size_mb: "50",
    pdf_cache_days: "365",

    // Update settings
    update_max_section_tokens: "65000",
    update_merge_strategy: "quality",
    update_internal_links_per_article: "5",
    update_batch_delay_seconds: "10",

    // News settings
    news_max_words: "1200",
    news_min_words: "800",
    news_watch_interval_minutes: "30",
    news_max_items_per_source: "15",
    news_media_enrichment_enabled: "true",
    news_youtube_enabled: "true",
    news_tweet_enabled: "true",
    news_pdf_enabled: "true",
    news_youtube_max_age_days: "30",

    // Bank settings
    bank_max_words: "2000",
    bank_min_words: "1200",
    bank_wp_category: "Banking",

    // Performance
    max_api_calls_per_article: "30",
    target_time_minutes: "8",
    research_queries: "15",
  };

  const cfgStmt = db.prepare(`INSERT OR IGNORE INTO config (session_id, key, value) VALUES (?, ?, ?)`);
  const cfgTx = db.transaction(() => {
    for (const [key, value] of Object.entries(defaultConfig)) {
      cfgStmt.run(sessionId, key, value);
    }
  });
  cfgTx();

  /* ═══════════════════════════════════════════════════════════
   * 2. API KEYS — loaded from .env.local (never hardcoded in source)
   * ═══════════════════════════════════════════════════════════ */

  // Gemini keys (comma-separated in env)
  const geminiKeys = (process.env.GEMINI_API_KEYS || "").split(",").filter(Boolean);
  geminiKeys.forEach((k, i) => upsertApiKey(sessionId, "gemini", k.trim(), i === 0 ? "Primary" : `Backup ${i}`));

  // HuggingFace writer keys
  const hfKeys = (process.env.HF_API_KEYS || "").split(",").filter(Boolean);
  hfKeys.forEach((k, i) => upsertApiKey(sessionId, "huggingface", k.trim(), i === 0 ? "Primary" : `Backup ${i}`));

  // You.com Search keys (17 keys for rotation — exhausted keys auto-rotate to next)
  const youKeys = (process.env.YOU_API_KEYS || "").split(",").filter(Boolean);
  youKeys.forEach((k, i) => upsertApiKey(sessionId, "you_search", k.trim(), `Key ${i + 1}`));

  // Image generation
  const imageKey = process.env.IMAGE_API_KEY || "";
  if (imageKey) upsertApiKey(sessionId, "image_gen", imageKey, "FLUX.1-schnell");

  // WordPress (combine url|username|password into single key entry)
  const wpUrl = process.env.WP_SITE_URL || "";
  const wpUser = process.env.WP_USERNAME || "";
  const wpPass = process.env.WP_APP_PASSWORD || "";
  if (wpUrl && wpUser && wpPass) {
    upsertApiKey(sessionId, "wordpress", `${wpUrl}|${wpUser}|${wpPass}`, "FindMyCollege WordPress");
  }

  // Supabase (combine url|service_role_key)
  const sbUrl = process.env.SUPABASE_URL || "";
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (sbUrl && sbKey) {
    upsertApiKey(sessionId, "supabase", `${sbUrl}|${sbKey}`, "10courses Database");
  }

  // Google Ads / Keyword Planner (combine all 5 fields)
  const gadsDev = process.env.GADS_DEVELOPER_TOKEN || "";
  const gadsClient = process.env.GADS_CLIENT_ID || "";
  const gadsSecret = process.env.GADS_CLIENT_SECRET || "";
  const gadsRefresh = process.env.GADS_REFRESH_TOKEN || "";
  const gadsCustomer = process.env.GADS_LOGIN_CUSTOMER_ID || "";
  if (gadsDev && gadsClient) {
    upsertApiKey(sessionId, "google_ads", `${gadsDev}|${gadsClient}|${gadsSecret}|${gadsRefresh}|${gadsCustomer}`, "Keyword Planner");
  }

  // DataForSEO (combine login|password)
  const dfsLogin = process.env.DATAFORSEO_LOGIN || "";
  const dfsPass = process.env.DATAFORSEO_PASSWORD || "";
  if (dfsLogin && dfsPass) {
    upsertApiKey(sessionId, "dataforseo", `${dfsLogin}|${dfsPass}`, "SERP & Keywords");
  }

  // SerpAPI
  const serpKey = process.env.SERPAPI_KEY || "";
  if (serpKey) upsertApiKey(sessionId, "serpapi", serpKey, "People Also Ask");

  // YouTube API
  const youtubeKey = process.env.YOUTUBE_API_KEY || "";
  if (youtubeKey) upsertApiKey(sessionId, "youtube", youtubeKey, "YouTube Data API");

  // Google Indexing
  const indexingKey = process.env.GOOGLE_INDEXING_KEY || "";
  if (indexingKey) upsertApiKey(sessionId, "google_indexing", indexingKey, "Indexing API");

  /* ═══════════════════════════════════════════════════════════
   * 3. AEO BRAND CONFIG — FindMyCollege defaults
   * ═══════════════════════════════════════════════════════════ */
  db.prepare(`INSERT OR IGNORE INTO aeo_brand_config
    (session_id, brand_name, aliases, website, industry, keywords, description, competitors, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(
      sessionId,
      "FindMyCollege",
      "FMC, findmycollege.com",
      "https://findmycollege.com",
      "EdTech, College Admissions, Higher Education",
      "top MBA colleges India, best engineering colleges, NIRF ranking, college fees, admission process, college cutoffs, top universities India",
      "FindMyCollege is India's leading college discovery and comparison platform, helping students find the best colleges for MBA, Engineering, Medical, Law, and other programs based on rankings, fees, placements, and admission requirements.",
      "Shiksha, Collegedunia, Careers360, CollegeDekho, GetMyUni"
    );

  /* ═══════════════════════════════════════════════════════════
   * 4. NEWS RSS FEEDS — all feeds from settings.yaml
   * ═══════════════════════════════════════════════════════════ */
  const newsFeeds: [string, string, string, string][] = [
    // [name, url, type, category]
    // Direct publisher RSS
    ["Times of India Education", "https://timesofindia.indiatimes.com/rssfeeds/913168846.cms", "rss", "Direct Publisher"],
    ["Indian Express Education", "https://indianexpress.com/section/education/feed/", "rss", "Direct Publisher"],
    ["NDTV Education", "https://feeds.feedburner.com/ndtv/education", "rss", "Direct Publisher"],
    ["Jagran Josh Education", "https://www.jagranjosh.com/articles-rss.xml", "rss", "Direct Publisher"],
    ["Hindustan Times Education", "https://www.hindustantimes.com/feeds/rss/education/rssfeed.xml", "rss", "Direct Publisher"],
    ["LiveMint Education", "https://www.livemint.com/rss/education", "rss", "Direct Publisher"],
    ["The Hindu Education", "https://www.thehindu.com/education/feeder/default.rss", "rss", "Direct Publisher"],
    ["Economic Times Education", "https://economictimes.indiatimes.com/news/how-to/rssfeeds/22745977.cms", "rss", "Direct Publisher"],
    // Google News aggregated
    ["Google: Education India", "https://news.google.com/rss/search?q=india+education+admission+exam&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: JEE/NEET", "https://news.google.com/rss/search?q=JEE+NEET+college+admission+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: University Cutoff", "https://news.google.com/rss/search?q=university+college+cutoff+result+india+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Scholarship", "https://news.google.com/rss/search?q=scholarship+fellowship+india+students+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: NTA/UGC", "https://news.google.com/rss/search?q=NTA+UGC+AICTE+education+notification+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: State Board", "https://news.google.com/rss/search?q=state+board+result+admit+card+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: CBSE Board", "https://news.google.com/rss/search?q=CBSE+board+exam+result+datesheet+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: ICSE Board", "https://news.google.com/rss/search?q=ICSE+ISC+board+exam+result+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: UP/MP/Bihar Board", "https://news.google.com/rss/search?q=UP+board+MP+board+Bihar+board+result+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: UGC NET", "https://news.google.com/rss/search?q=UGC+NET+result+admit+card+answer+key+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: CSIR NET", "https://news.google.com/rss/search?q=CSIR+NET+SET+PhD+entrance+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: University Results", "https://news.google.com/rss/search?q=university+result+examination+notification+india+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: DU/MU Results", "https://news.google.com/rss/search?q=Delhi+University+Mumbai+University+result+admission+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Govt Jobs", "https://news.google.com/rss/search?q=SSC+IBPS+Railway+recruitment+government+job+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Job Notification", "https://news.google.com/rss/search?q=government+job+notification+vacancy+recruitment+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Defence Jobs", "https://news.google.com/rss/search?q=Indian+Army+Navy+Air+Force+recruitment+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Police Jobs", "https://news.google.com/rss/search?q=police+constable+SI+recruitment+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Teaching Jobs", "https://news.google.com/rss/search?q=teacher+recruitment+TET+CTET+SUPER+TET+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: PSC Jobs", "https://news.google.com/rss/search?q=PSC+state+public+service+commission+recruitment+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: UPSC", "https://news.google.com/rss/search?q=UPSC+civil+services+IAS+IPS+notification+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: GATE/IIT", "https://news.google.com/rss/search?q=GATE+IIT+NIT+engineering+admission+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: MBA/CAT", "https://news.google.com/rss/search?q=CAT+MBA+management+entrance+IIM+admission+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: CLAT/Law", "https://news.google.com/rss/search?q=CLAT+AILET+law+entrance+exam+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Medical/MBBS", "https://news.google.com/rss/search?q=MBBS+AIIMS+NEET+PG+medical+admission+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Study Abroad", "https://news.google.com/rss/search?q=study+abroad+GRE+GMAT+IELTS+foreign+university+india+students&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: College Rankings", "https://news.google.com/rss/search?q=NIRF+ranking+college+university+India+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Skill/ITI", "https://news.google.com/rss/search?q=skill+development+ITI+polytechnic+vocational+training+india+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Design/Architecture", "https://news.google.com/rss/search?q=NID+NIFT+CEED+design+architecture+admission+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: State TET", "https://news.google.com/rss/search?q=PSTET+HTET+REET+UPTET+TET+answer+key+result+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: State SSB", "https://news.google.com/rss/search?q=PSSSB+BSSC+OSSSC+HSSC+clerk+recruitment+result+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: MBA Admission", "https://news.google.com/rss/search?q=NMIMS+SIBM+SNAP+MBA+admission+result+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Board Exam Analysis", "https://news.google.com/rss/search?q=CBSE+ICSE+board+exam+analysis+question+paper+review+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: South Board", "https://news.google.com/rss/search?q=Kerala+SSLC+TN+board+AP+SSC+exam+result+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Google News"],
    ["Google: Education Latest 24h", "https://news.google.com/rss/search?q=education+exam+result+admit+card+answer+key+india+2026&hl=en-IN&gl=IN&ceid=IN:en&when=1d", "rss", "Google News"],
    // Regional language feeds
    ["Google: Hindi Education", "https://news.google.com/rss/search?q=%E0%A4%B6%E0%A4%BF%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%BE+%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%B5%E0%A5%87%E0%A4%B6+%E0%A4%AA%E0%A4%B0%E0%A5%80%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%BE&hl=hi-IN&gl=IN&ceid=IN:hi", "rss", "Regional"],
    ["Google: Tamil Education", "https://news.google.com/rss/search?q=%E0%AE%95%E0%AE%B2%E0%AF%8D%E0%AE%B5%E0%AE%BF+%E0%AE%9A%E0%AF%87%E0%AE%B0%E0%AF%8D%E0%AE%95%E0%AF%8D%E0%AE%95%E0%AF%88+%E0%AE%A4%E0%AF%87%E0%AE%B0%E0%AF%8D%E0%AE%B5%E0%AF%81&hl=ta-IN&gl=IN&ceid=IN:ta", "rss", "Regional"],
    ["Google: Telugu Education", "https://news.google.com/rss/search?q=%E0%B0%B5%E0%B0%BF%E0%B0%A6%E0%B1%8D%E0%B0%AF+%E0%B0%AA%E0%B1%8D%E0%B0%B0%E0%B0%B5%E0%B1%87%E0%B0%B6+%E0%B0%AA%E0%B0%B0%E0%B1%80%E0%B0%95%E0%B1%8D%E0%B0%B7&hl=te-IN&gl=IN&ceid=IN:te", "rss", "Regional"],
    ["Google: Marathi Education", "https://news.google.com/rss/search?q=%E0%A4%B6%E0%A4%BF%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%A3+%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%B5%E0%A5%87%E0%A4%B6+%E0%A4%AA%E0%A4%B0%E0%A5%80%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%BE&hl=mr-IN&gl=IN&ceid=IN:mr", "rss", "Regional"],
    // Bank feeds
    ["Google: IBPS Bank", "https://news.google.com/rss/search?q=IBPS+bank+exam+recruitment+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: SBI", "https://news.google.com/rss/search?q=SBI+clerk+PO+recruitment+exam+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: RBI", "https://news.google.com/rss/search?q=RBI+grade+B+assistant+recruitment+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: Bank Exam", "https://news.google.com/rss/search?q=bank+exam+result+cutoff+admit+card+2026+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: Bank Jobs", "https://news.google.com/rss/search?q=bank+job+vacancy+notification+india+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: Bank Salary", "https://news.google.com/rss/search?q=bank+PO+clerk+salary+promotion+india&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: Education Loan", "https://news.google.com/rss/search?q=education+loan+india+interest+rate+bank+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: NABARD/SEBI", "https://news.google.com/rss/search?q=NABARD+SEBI+SIDBI+IRDAI+recruitment+exam+2026&hl=en-IN&gl=IN&ceid=IN:en", "rss", "Banking"],
    ["Google: Bank Hindi", "https://news.google.com/rss/search?q=%E0%A4%AC%E0%A5%88%E0%A4%82%E0%A4%95+%E0%A4%AD%E0%A4%B0%E0%A5%8D%E0%A4%A4%E0%A5%80+%E0%A4%AA%E0%A4%B0%E0%A5%80%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%BE+2026&hl=hi-IN&gl=IN&ceid=IN:hi", "rss", "Banking"],
  ];

  newsFeeds.forEach(([name, url, type, category]) => {
    const id = uuidv4();
    upsertNewsSource(sessionId, id, name, url, type, category);
  });

  /* ═══════════════════════════════════════════════════════════
   * 4. WRITING RULES — full banned phrases, replacements, thresholds
   * ═══════════════════════════════════════════════════════════ */

  // Complete banned phrases list from post_processor.py
  const bannedPhrases = [
    "delve", "delves", "delving", "landscape", "comprehensive guide", "navigate",
    "crucial", "essential", "moreover", "furthermore", "indeed", "consequently",
    "subsequently", "paramount", "plethora", "myriad", "robust", "synergy",
    "leverage", "paradigm", "holistic", "facilitate", "endeavor", "encompasses",
    "intricacies", "nuances", "realm", "sphere", "pivotal", "imperative",
    "underscores", "underscoring", "underpinning", "overarching", "burgeoning",
    "bustling", "tapestry", "intricately", "unveil", "unveils", "embark",
    "embarking", "embarkation", "in conclusion", "to sum up", "in summary",
    "it is worth noting", "it should be noted", "needless to say",
    "without a doubt", "in today's world", "in the current scenario",
    "plays a vital role", "stands as a testament", "serves as a beacon",
    "paves the way", "goes without saying", "it is important to note",
    "in the ever-evolving", "in this day and age", "complete guide",
    "plays a crucial role", "it is worth mentioning",
    "in today's competitive landscape", "in today's competitive world",
    "additionally", "enhance", "enhances", "enhancing", "fostering", "fosters",
    "highlight", "highlights", "highlighting", "showcase", "showcasing", "showcases",
    "vibrant", "nestled", "groundbreaking", "renowned", "must-visit", "stunning",
    "boasts a", "boasts", "testament", "serves as", "stands as", "acts as a",
    "marks a pivotal", "game-changing", "revolutionary", "unprecedented",
    "immense potential", "the future looks bright", "exciting times lie ahead",
    "at the end of the day", "when all is said and done",
    "it goes without saying", "has the ability to",
    "due to the fact that", "in order to achieve",
    "not only", "but also",
  ];

  // Complete AI phrase replacements from content_cleaner.py
  const aiReplacements: Record<string, string> = {
    // Filler → remove
    "it is worth noting that": "",
    "it is important to note that": "",
    "it is important to mention that": "",
    "it should be noted that": "",
    "it bears mentioning that": "",
    "needless to say": "",
    "without further ado": "",
    "in this article we will": "",
    "let's dive in": "",
    "let us delve into": "",
    "let's explore": "",
    "in this comprehensive guide": "",
    // Wordy → concise
    "plays a vital role in": "is key to",
    "plays a crucial role in": "is key to",
    "plays an important role in": "matters for",
    "serves as a testament to": "shows",
    "stands as a testament to": "shows",
    "it goes without saying that": "",
    "at the end of the day": "ultimately",
    "in order to": "to",
    "due to the fact that": "because",
    "on account of the fact that": "because",
    "in light of the fact that": "since",
    "for the purpose of": "to",
    "with regard to": "about",
    "with respect to": "about",
    "in the event that": "if",
    "a large number of": "many",
    "a significant number of": "many",
    "the vast majority of": "most",
    "in the near future": "soon",
    "at this point in time": "now",
    "prior to": "before",
    "subsequent to": "after",
    // AI superlatives
    "groundbreaking": "notable",
    "game-changing": "significant",
    "game changer": "significant development",
    "transformative journey": "path",
    "exciting opportunity": "opportunity",
    "incredible opportunity": "opportunity",
    "landscape of": "field of",
    "educational landscape": "education sector",
    "holistic development": "overall development",
    "cutting-edge": "advanced",
    "state-of-the-art": "modern",
    "world-class": "top-tier",
    "unparalleled": "strong",
    "unprecedented": "rare",
    "paradigm shift": "major change",
    "synergy": "collaboration",
    "leverage": "use",
    "robust": "strong",
    "vibrant": "active",
    "nestled in": "located in",
    "delve into": "explore",
    "delve deeper": "look closer",
    "embark on": "start",
    "foster": "build",
    "facilitate": "help",
    "endeavor": "effort",
    "plethora of": "many",
    "myriad of": "many",
    "myriad": "many",
    "paramount": "important",
    "imperative": "important",
    "pivotal": "important",
    "instrumental": "helpful",
    "comprehensive": "full",
    "meticulously": "carefully",
    "bolster": "strengthen",
    "catapult": "push",
    "spearhead": "lead",
    // Academic bloat
    "equips you with": "teaches",
    "equips graduates with": "gives graduates",
    "cultivates": "builds",
    "has acquired renewed urgency": "is more relevant now",
    "making thorough research essential": "",
    "transcend narrow vocational training": "apply across careers",
    "decisive advantages": "clear advantages",
    "transferable competencies": "transferable skills",
    "cognitive flexibility": "adaptable thinking",
    "intellectual depth": "deep knowledge",
    "rigorous engagement with": "study of",
    "rigorous discipline of": "practice of",
    "interdisciplinary methodologies": "cross-discipline methods",
    "persuasive written communication": "strong writing",
  };

  // Table banned cell values from post_processor.py
  const tableBannedValues = [
    "not specified", "not available", "n/a", "na", "nil", "none",
    "varies", "variable", "competitive", "attractive", "handsome",
    "decent", "promising", "good", "excellent", "high",
    "to be announced", "tba", "tbd", "not disclosed",
    "not mentioned", "not applicable", "yet to be announced",
    "check website", "visit website", "contact college",
    "as per norms", "as per rules", "depends", "on merit",
  ];

  // Quality thresholds from quality_checker.py
  const qualityThresholds = {
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
    min_table_rows: 12,
    max_table_rows: 30,
    passive_voice_threshold: 30,
    fact_check_threshold: 60,
    pass_score: 55,
    grade_a: 85,
    grade_b: 70,
    grade_c: 55,
    grade_d: 40,
  };

  // Gov sites for news/PDF discovery
  const govSites = {
    news_gov_sites: [
      "nta.ac.in", "ugc.gov.in", "aicte-india.org", "cbse.gov.in",
      "upsc.gov.in", "ssc.gov.in", "indianrailways.gov.in", "mhrd.gov.in",
      "education.gov.in", "ugcnetonline.in", "ntaresults.nic.in",
      "jeemain.nta.ac.in", "neet.nta.nic.in", "pstet2025.org",
      "psssb.punjab.gov.in", "kbpe.org",
    ],
    pdf_gov_sites: [
      "nta.ac.in", "ugc.gov.in", "upsc.gov.in", "cbse.gov.in",
      "aicte-india.org", "ssc.gov.in", "education.gov.in", "ugcnetonline.in",
    ],
    bank_gov_sites: ["ibps.in", "sbi.co.in", "rbi.org.in", "nabard.org"],
    trusted_pdf_domains: [
      "nirfindia.org", "ugc.gov.in", "aicte-india.org", "josaa.nic.in",
      "csab.nic.in", "nta.ac.in", "jeeadv.ac.in", "mcc.nic.in",
      "cetcell.mahacet.org", "kea.kar.nic.in", "tnea.ac.in",
      "wbjeeb.nic.in", "aishe.gov.in",
    ],
    competitor_sites: [
      "shiksha.com", "collegedunia.com", "careers360.com",
      "collegedekho.com", "getmyuni.com",
    ],
  };

  const rulesStmt = db.prepare(
    `INSERT OR IGNORE INTO writing_rules (session_id, rule_type, rules_json) VALUES (?, ?, ?)`
  );
  const rulesTx = db.transaction(() => {
    rulesStmt.run(sessionId, "banned_phrases", JSON.stringify(bannedPhrases));
    rulesStmt.run(sessionId, "ai_replacements", JSON.stringify(aiReplacements));
    rulesStmt.run(sessionId, "table_banned_values", JSON.stringify(tableBannedValues));
    rulesStmt.run(sessionId, "quality_thresholds", JSON.stringify(qualityThresholds));
    rulesStmt.run(sessionId, "gov_sites", JSON.stringify(govSites));
  });
  rulesTx();
}
