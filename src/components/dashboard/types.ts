/* ── Tab System ── */
export const tabs = [
  "Content Generator",
  "Content Library",
  "SEO Optimizer",
  "AEO Optimizer",
  "GEO Optimizer",
  "Settings",
] as const;

export type TabKey = (typeof tabs)[number];

/* ── Content Types ── */
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

export type ContentStatus = "draft" | "optimizing" | "ready" | "published" | "error";

export interface ContentItem {
  id: string;
  title: string;
  topic: string;
  type: ContentType;
  status: ContentStatus;
  wordCount: number;
  seoScore: number;
  aeoScore: number;
  geoScore: number;
  createdAt: string;
  updatedAt: string;
  keywords: string[];
  html?: string;
  outline?: OutlineSection[];
}

export interface OutlineSection {
  heading: string;
  format: "prose" | "table" | "list";
  wordTarget: number;
  priority: "critical" | "recommended" | "optional";
  content?: string;
}

export interface GenerationRequest {
  topics: string[];
  targetType?: ContentType;
  keywords?: string[];
  targetWordCount?: number;
  tone?: string;
  audience?: string;
  region?: string;
  includeInternalLinks?: boolean;
  includeFaqs?: boolean;
  includeSchema?: boolean;
}

export interface BulkJob {
  id: string;
  totalTopics: number;
  completedTopics: number;
  failedTopics: number;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  startedAt: string;
  items: ContentItem[];
}

/* ── SEO ── */
export interface SeoAnalysis {
  score: number;
  title: { score: number; suggestion: string };
  meta: { score: number; suggestion: string };
  headings: { score: number; issues: string[] };
  keywords: { density: number; missing: string[]; stuffed: string[] };
  readability: { score: number; grade: string };
  internalLinks: number;
  externalLinks: number;
  images: { total: number; missingAlt: number };
  schema: { present: boolean; types: string[] };
}

/* ── AEO ── */
export interface AeoAnalysis {
  score: number;
  directAnswers: { count: number; quality: string };
  featuredSnippetReady: boolean;
  faqSchema: boolean;
  questionCoverage: number;
  citationReadiness: number;
  llmFriendliness: number;
  suggestions: string[];
}

/* ── GEO ── */
export interface GeoAnalysis {
  score: number;
  localKeywords: string[];
  geoTargeting: string;
  localSchema: boolean;
  napConsistency: boolean;
  localCitations: number;
  regionRelevance: number;
  suggestions: string[];
}

/* ── Settings ── */
export interface ProjectSettings {
  projectName: string;
  website: string;
  brandName: string;
  industry: string;
  targetAudience: string;
  defaultRegion: string;
  defaultTone: string;
  defaultWordCount: number;
  apiKeys: {
    gemini?: string;
    openrouter?: string;
    youApi?: string;
  };
  publishing: {
    wordpress?: { url: string; username: string; appPassword: string };
    supabase?: { url: string; anonKey: string };
  };
}

/* ── App State ── */
export interface AppState {
  activeTab: TabKey;
  theme: "light" | "dark" | "system";
  settings: ProjectSettings;
  contentLibrary: ContentItem[];
  bulkJobs: BulkJob[];
  sidebarCollapsed: boolean;
}

export const defaultSettings: ProjectSettings = {
  projectName: "",
  website: "",
  brandName: "",
  industry: "",
  targetAudience: "",
  defaultRegion: "",
  defaultTone: "Professional",
  defaultWordCount: 2500,
  apiKeys: {},
  publishing: {},
};

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

export const contentTypeDescriptions: Record<ContentType, string> = {
  blog_post: "In-depth articles covering a topic with research and insights",
  listicle: "Ranked or curated lists (Top 10, Best of, etc.)",
  comparison: "Side-by-side analysis of two or more options",
  how_to_guide: "Step-by-step instructions and tutorials",
  product_review: "Detailed product or service evaluations",
  case_study: "Real-world examples with data and outcomes",
  news_article: "Timely coverage of events and developments",
  opinion_piece: "Expert perspectives and thought leadership",
  technical_guide: "In-depth technical documentation and walkthroughs",
  landing_page: "Conversion-focused page copy",
  custom: "Define your own structure and format",
};
