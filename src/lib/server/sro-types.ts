// ─── AEO Audit Types ─────────────────────────────────────────────────────

export interface AuditCheck {
  id: string;
  label: string;
  category: "discovery" | "structure" | "content" | "technical" | "rendering";
  pass: boolean;
  value: string;
  detail: string;
}

export interface AuditReport {
  url: string;
  score: number;
  checks: AuditCheck[];
  llmsTxtPresent: boolean;
  schemaMentions: number;
  blufDensity: number;
  pass: {
    llmsTxt: boolean;
    schema: boolean;
    bluf: boolean;
  };
}

// ─── Gemini Grounding Types ───────────────────────────────────────────────

export interface GroundingChunk {
  uri: string;
  title: string;
}

export interface GroundingSupport {
  startIndex: number;
  endIndex: number;
  text: string;
  chunkIndices: number[];
  confidenceScores: number[];
}

export interface GroundingResult {
  query: string;
  answer: string;
  searchQueries: string[];
  chunks: GroundingChunk[];
  supports: GroundingSupport[];
  targetUrlFound: boolean;
  targetUrlChunkIndices: number[];
  targetSnippets: string[];
  totalGroundingWords: number;
  targetGroundingWords: number;
  selectionRate: number;
}

// ─── Bright Data Platform Types ───────────────────────────────────────────

export type SROPlatform =
  | "ai_mode"
  | "gemini"
  | "chatgpt"
  | "perplexity"
  | "copilot"
  | "grok";

export interface PlatformCitation {
  url: string;
  domain: string;
  title: string;
  description: string;
  hasTextFragment: boolean;
  citedSentence: string;
}

export interface PlatformResult {
  platform: SROPlatform;
  label: string;
  status: "pending" | "processing" | "done" | "error";
  answer: string;
  citations: PlatformCitation[];
  targetUrlCited: boolean;
  targetCitations: PlatformCitation[];
  error?: string;
}

// ─── SERP Types ──────────────────────────────────────────────────────────

export interface SerpOrganicResult {
  position: number;
  url: string;
  domain: string;
  title: string;
  description: string;
  isTarget: boolean;
}

export interface SerpResult {
  keyword: string;
  totalResults: number;
  organicResults: SerpOrganicResult[];
  targetRank: number | null;
  topCompetitors: string[];
}

// ─── Web Unlocker Types ──────────────────────────────────────────────────

export interface ScrapedPage {
  url: string;
  domain: string;
  title: string;
  headings: string[];
  wordCount: number;
  contentSnippet: string;
  fullText: string;
  metaDescription: string;
  error?: string;
}

// ─── Site Context Types ───────────────────────────────────────────────────

export interface SiteContext {
  domain: string;
  homepageUrl: string;
  primaryTopics: string[];
  industry: string;
  targetAudience: string;
  contentThemes: string[];
  siteDescription: string;
  error?: string;
}

// ─── LLM Analysis Types ─────────────────────────────────────────────────

export interface LLMAnalysisInput {
  targetUrl: string;
  keyword: string;
  grounding: GroundingResult | null;
  platforms: PlatformResult[];
  serp: SerpResult | null;
  targetPage: ScrapedPage | null;
  competitorPages: ScrapedPage[];
  siteContext?: SiteContext | null;
}

export interface LLMRecommendation {
  category: "content" | "structure" | "technical" | "strategy";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionItems: string[];
}

export interface LLMAnalysisResult {
  overallScore: number;
  summary: string;
  recommendations: LLMRecommendation[];
  contentGaps: string[];
  competitorInsights: string[];
}

// ─── SRO Analysis State ───────────────────────────────────────────────────

export type SROStage =
  | "idle"
  | "grounding"
  | "serp"
  | "scraping"
  | "context"
  | "analyzing"
  | "done"
  | "error";

export interface SROResult {
  targetUrl: string;
  keyword: string;
  stage: SROStage;
  grounding: GroundingResult | null;
  serp: SerpResult | null;
  targetPage: ScrapedPage | null;
  competitorPages: ScrapedPage[];
  siteContext: SiteContext | null;
  llmAnalysis: LLMAnalysisResult | null;
  error?: string;
  completedAt?: string;
}
