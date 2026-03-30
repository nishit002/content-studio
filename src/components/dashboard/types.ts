/* ── Tab System (4 pages) ── */
export const tabs = [
  "Dashboard",
  "Content Generator",
  "Content Library",
  "AEO & SRO",
  "Configuration",
] as const;

export type TabKey = (typeof tabs)[number];

/* ── Content Types (universal, any industry) ── */
export type ContentType =
  | "blog_post"
  | "listicle"
  | "comparison"
  | "how_to_guide"
  | "product_review"
  | "case_study"
  | "news_article"
  | "opinion_piece"
  | "technical_guide"
  | "landing_page"
  | "custom";

export type ContentStatus =
  | "pending"
  | "outline_ready"
  | "writing"
  | "done"
  | "published"
  | "error";

export const contentTypeLabels: Record<ContentType, string> = {
  blog_post: "Blog Post",
  listicle: "Listicle",
  comparison: "Comparison",
  how_to_guide: "How-To Guide",
  product_review: "Product Review",
  case_study: "Case Study",
  news_article: "News Article",
  opinion_piece: "Opinion Piece",
  technical_guide: "Technical Guide",
  landing_page: "Landing Page",
  custom: "Custom",
};

/* ── API Key Providers ── */
export const apiProviders = [
  // Core pipeline (required for content generation)
  { id: "gemini", name: "Google Gemini", description: "Classification, outlines, data extraction (multiple keys supported)", required: true },
  { id: "huggingface", name: "HuggingFace (Writer)", description: "Qwen3-235B for article writing (multiple keys supported)", required: true },
  { id: "you_search", name: "You.com Search", description: "Web research with key rotation (multiple keys supported)", required: true },
  // Publishing
  { id: "wordpress", name: "WordPress", description: "Publishing via REST API (url|username|app_password)", required: false },
  { id: "supabase", name: "Supabase", description: "10courses database (url|service_role_key)", required: false },
  // SEO & Keywords
  { id: "google_ads", name: "Google Ads (Keyword Planner)", description: "Keyword volumes (dev_token|client_id|client_secret|refresh_token|customer_id)", required: false },
  { id: "dataforseo", name: "DataForSEO", description: "SERP data & keyword research (login|password)", required: false },
  { id: "serpapi", name: "SerpAPI", description: "Google People Also Ask questions (optional)", required: false },
  // Media & Indexing
  { id: "youtube", name: "YouTube API", description: "Video enrichment for news articles (optional)", required: false },
  { id: "google_indexing", name: "Google Indexing", description: "Fast URL indexing via service account (optional)", required: false },
  { id: "image_gen", name: "Image Generation", description: "Featured images via FLUX.1-schnell (optional)", required: false },
] as const;

export type ApiProvider = (typeof apiProviders)[number]["id"];

/* ── Industry Presets ── */
export const industryPresets = [
  { id: "education_india", name: "Education (India)", description: "Indian colleges, exams, courses, careers" },
  { id: "technology", name: "Technology", description: "SaaS, software, AI, developer tools" },
  { id: "healthcare", name: "Healthcare", description: "Medical, pharma, wellness" },
  { id: "finance", name: "Finance", description: "Banking, insurance, investments" },
  { id: "real_estate", name: "Real Estate", description: "Property, construction, interiors" },
  { id: "ecommerce", name: "E-Commerce", description: "Products, retail, marketplace" },
  { id: "travel", name: "Travel", description: "Tourism, hospitality, destinations" },
  { id: "legal", name: "Legal", description: "Law, compliance, regulations" },
  { id: "custom", name: "Custom", description: "Define your own rules from scratch" },
] as const;

/* ── Writing Rule Types ── */
export type WritingRuleType = "banned_phrases" | "ai_replacements" | "table_banned_values" | "quality_thresholds";
