"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { composeCoverImage } from "@/lib/client/cover-image";

/* ── Types ── */
interface ArticleListItem {
  slug: string;
  topic: string;
  title: string;
  content_type: string;
  word_count: number;
  table_count: number;
  section_count: number;
  quality_grade: string;
  quality_score: number;
  generation_time: number;
  generated_at: string;
  has_html: boolean;
  source?: string; // "atlas" | "news" | undefined (undefined = CG)
  wp_post_id?: number | null;
}

interface ArticleMeta {
  topic: string;
  title: string;
  content_type: string;
  slug: string;
  word_count: number;
  table_count: number;
  section_count: number;
  api_calls: number;
  generation_time: number;
  sections: { heading: string; latency: number; chars: number; model: string; fallback: boolean }[];
  post_processing: { banned_removed: string[]; names_redacted: string[]; hallucination_issues: number };
  quality: {
    overall_score: number;
    overall_grade: string;
    quality_score: number;
    quality_grade: string;
    data_density: number;
    data_points: number;
    readability: string;
    heading_count: number;
    table_count: number;
    list_count: number;
    has_faq: boolean;
    quality_issues: string[];
    fact_check_verified: number;
    fact_check_unverified: number;
    fact_check_rate: number;
    passed: boolean;
  };
}

interface ArticleData {
  slug: string;
  meta: ArticleMeta | null;
  html: string | null;
  outline: Record<string, unknown> | null;
}

type ResultTab = "preview" | "quality" | "sections" | "outline";
type SortMode = "newest" | "oldest" | "quality" | "words";
type ViewMode = "grid" | "list";

/* ── Constants ── */
const TYPE_LABELS: Record<string, string> = {
  informational: "Informational",
  college_profile: "College Profile",
  career_guide: "Career Guide",
  ranking_list: "Ranking List",
  exam_guide: "Exam Guide",
  comparison: "Comparison",
  fee_reference: "Fee Reference",
  cutoff_data: "Cutoff Data",
  blog_post: "Blog Post",
  listicle: "Listicle",
  how_to_guide: "How-To Guide",
  product_review: "Product Review",
  case_study: "Case Study",
  news_article: "News Article",
  opinion_piece: "Opinion Piece",
  technical_guide: "Technical Guide",
  landing_page: "Landing Page",
};

const CHART_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#f59e0b", "#ef4444", "#ec4899", "#10b981", "#f97316", "#6366f1", "#06b6d4"];

const GRADE_BG: Record<string, string> = {
  "A+": "bg-th-success text-white", A: "bg-th-success text-white",
  "B+": "bg-th-accent text-white", B: "bg-th-accent text-white",
  C: "bg-th-warning text-white", D: "bg-th-danger text-white",
};

/* ── Main Component ── */
export default function ContentLibraryTab({ refreshKey = 0 }: { refreshKey?: number }) {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [pageSize, setPageSize] = useState(20);

  // Article detail state
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [articleData, setArticleData] = useState<ArticleData | null>(null);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>("preview");

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [publishingCard, setPublishingCard] = useState<string | null>(null);
  const [cardPublishResult, setCardPublishResult] = useState<Record<string, { ok?: boolean; post_url?: string; error?: string }>>({});

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/article?list=true");
      const data: ArticleListItem[] = await res.json();
      setArticles(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchArticles(); }, [fetchArticles, refreshKey]);

  // View article detail
  const viewArticle = async (slug: string) => {
    setActiveSlug(slug);
    setResultTab("preview");
    setLoadingArticle(true);
    try {
      const res = await fetch(`/api/article?slug=${encodeURIComponent(slug)}&part=all`);
      const data = await res.json();
      setArticleData({
        slug,
        meta: data.meta || null,
        html: data.html || null,
        outline: data.outline || null,
      });
    } catch {
      setArticleData(null);
    } finally { setLoadingArticle(false); }
  };

  const handleDelete = async (slug: string) => {
    setDeleting(slug);
    try {
      const res = await fetch(`/api/article?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setArticles((prev) => prev.filter((a) => a.slug !== slug));
        if (activeSlug === slug) { setActiveSlug(null); setArticleData(null); }
      }
    } catch { /* ignore */ }
    finally { setDeleting(null); setConfirmDelete(null); }
  };

  const quickPublish = async (slug: string, status: "draft" | "publish") => {
    setPublishingCard(slug);
    setCardPublishResult((prev) => ({ ...prev, [slug]: {} }));
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, status }),
      });
      const data = await res.json();
      if (res.ok && data.post_id) {
        setCardPublishResult((prev) => ({ ...prev, [slug]: { ok: true, post_url: data.post_url } }));
      } else {
        setCardPublishResult((prev) => ({ ...prev, [slug]: { error: data.error || "Publish failed" } }));
      }
    } catch (e) {
      setCardPublishResult((prev) => ({ ...prev, [slug]: { error: (e as Error).message } }));
    } finally {
      setPublishingCard(null);
    }
  };

  // Compute type counts
  const typeCounts = articles.reduce<Record<string, number>>((acc, a) => {
    const t = a.content_type || "other";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  // Compute grade counts
  const gradeCounts = articles.reduce<Record<string, number>>((acc, a) => {
    if (a.quality_grade) acc[a.quality_grade] = (acc[a.quality_grade] || 0) + 1;
    return acc;
  }, {});

  // Filter
  const q = query.toLowerCase();
  const filtered = articles.filter((a) => {
    if (activeType && (a.content_type || "other") !== activeType) return false;
    if (gradeFilter && a.quality_grade !== gradeFilter) return false;
    if (q) {
      const haystack = `${a.title} ${a.topic} ${a.slug} ${a.content_type}`.toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    switch (sortMode) {
      case "oldest": return String(a.generated_at).localeCompare(String(b.generated_at));
      case "quality": return (b.quality_score || 0) - (a.quality_score || 0);
      case "words": return b.word_count - a.word_count;
      default: return String(b.generated_at).localeCompare(String(a.generated_at));
    }
  });

  const visible = sorted.slice(0, pageSize);
  const hasMore = sorted.length > pageSize;

  // Stats
  const totalWords = articles.reduce((sum, a) => sum + a.word_count, 0);
  const avgScore = articles.length > 0
    ? articles.reduce((sum, a) => sum + (a.quality_score || 0), 0) / articles.filter((a) => a.quality_score > 0).length
    : 0;

  // If viewing article detail
  if (activeSlug) {
    return (
      <div className="space-y-4">
        {/* Back bar */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setActiveSlug(null); setArticleData(null); }}
            className="flex items-center gap-1.5 text-sm text-th-accent hover:text-th-accent-hover transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to library
          </button>
          {articleData?.meta && (
            <span className="text-sm text-th-text-muted truncate">{articleData.meta.title}</span>
          )}
        </div>

        {loadingArticle ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
          </div>
        ) : articleData ? (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-th-bg-secondary rounded-lg w-fit">
              {(["preview", "quality", "sections", "outline"] as ResultTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setResultTab(tab)}
                  className={`px-4 py-2 rounded-md text-xs font-medium transition-all capitalize ${
                    resultTab === tab
                      ? "bg-th-card text-th-text shadow-sm"
                      : "text-th-text-muted hover:text-th-text"
                  }`}
                >
                  {tab === "preview" ? "Article Preview" : tab === "quality" ? "Quality Report" : tab}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="cs-card p-6">
              {resultTab === "preview" && (
                <ArticlePreview html={articleData.html} meta={articleData.meta} slug={articleData.slug} />
              )}
              {resultTab === "quality" && <QualityReport meta={articleData.meta} />}
              {resultTab === "sections" && <SectionsView meta={articleData.meta} />}
              {resultTab === "outline" && <OutlineView outline={articleData.outline} />}
            </div>
          </div>
        ) : (
          <p className="text-sm text-th-text-muted text-center py-8">Failed to load article.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      {!loading && articles.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Articles", value: articles.length.toLocaleString(), icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
            { label: "Total Words", value: totalWords >= 1000000 ? `${(totalWords / 1000000).toFixed(1)}M` : totalWords >= 1000 ? `${(totalWords / 1000).toFixed(0)}K` : String(totalWords), icon: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" },
            { label: "Avg Quality", value: avgScore > 0 ? `${avgScore.toFixed(0)}/100` : "N/A", icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" },
            { label: "Content Types", value: String(sortedTypes.length), icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" },
          ].map((s) => (
            <div key={s.label} className="cs-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-th-accent-soft flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-th-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                </svg>
              </div>
              <div>
                <p className="text-xl font-bold text-th-text">{s.value}</p>
                <p className="text-xs text-th-text-muted">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search + controls */}
      <div className="cs-card p-4 space-y-4">
        {/* Search — full width */}
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-th-text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPageSize(20); }}
            placeholder="Search articles by title, topic, or slug..."
            className="w-full py-3 pl-12 pr-10 bg-th-bg-secondary border border-th-border rounded-xl text-sm text-th-text placeholder:text-th-text-muted outline-none focus:border-th-accent focus:ring-2 focus:ring-th-accent/20 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-th-text-muted hover:text-th-text p-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Controls row — sort, view toggle, refresh */}
        <div className="flex items-center gap-3">
          {/* Sort */}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="cs-input w-auto text-xs py-2"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="quality">Highest Quality</option>
            <option value="words">Most Words</option>
          </select>

          {/* View toggle */}
          <div className="flex items-center rounded-lg bg-th-bg-secondary border border-th-border">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded-l-lg transition-colors ${viewMode === "grid" ? "bg-th-accent text-white" : "text-th-text-muted hover:text-th-text"}`}
              title="Grid view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-r-lg transition-colors ${viewMode === "list" ? "bg-th-accent text-white" : "text-th-text-muted hover:text-th-text"}`}
              title="List view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </button>
          </div>

          {/* Refresh */}
          <button
            onClick={fetchArticles}
            className="p-2 rounded-lg bg-th-bg-secondary border border-th-border text-th-text-muted hover:text-th-text hover:bg-th-card-hover transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          </button>
        </div>

        {/* Type pill filters */}
        {sortedTypes.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => { setActiveType(""); setPageSize(20); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                !activeType ? "bg-th-accent text-white shadow-sm" : "bg-th-bg-secondary text-th-text-secondary hover:bg-th-border"
              }`}
            >
              All ({articles.length})
            </button>
            {sortedTypes.map(([type, count]) => (
              <button
                key={type}
                onClick={() => { setActiveType(activeType === type ? "" : type); setPageSize(20); }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  activeType === type ? "bg-th-accent text-white shadow-sm" : "bg-th-bg-secondary text-th-text-secondary hover:bg-th-border"
                }`}
              >
                {TYPE_LABELS[type] || type.replace("_", " ")} ({count})
              </button>
            ))}
          </div>
        )}

        {/* Grade filter */}
        {Object.keys(gradeCounts).length > 1 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-th-text-muted self-center mr-1">Grade:</span>
            <button
              onClick={() => { setGradeFilter(""); setPageSize(20); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                !gradeFilter ? "bg-th-accent text-white shadow-sm" : "bg-th-bg-secondary text-th-text-secondary hover:bg-th-border"
              }`}
            >
              All
            </button>
            {["A+", "A", "B+", "B", "C", "D"].filter((g) => gradeCounts[g]).map((grade) => (
              <button
                key={grade}
                onClick={() => { setGradeFilter(gradeFilter === grade ? "" : grade); setPageSize(20); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  gradeFilter === grade ? "bg-th-accent text-white shadow-sm" : "bg-th-bg-secondary text-th-text-secondary hover:bg-th-border"
                }`}
              >
                {grade} ({gradeCounts[grade]})
              </button>
            ))}
          </div>
        )}

        {/* Result count */}
        {(query || activeType || gradeFilter) && (
          <p className="text-xs text-th-text-muted mt-3">
            Showing {sorted.length} of {articles.length} articles
            {query && <> matching &quot;{query}&quot;</>}
          </p>
        )}
      </div>

      {/* Article list/grid */}
      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
          <span className="text-sm text-th-text-muted">Loading articles...</span>
        </div>
      ) : articles.length === 0 ? (
        <div className="cs-card p-12 text-center">
          <svg className="w-12 h-12 mx-auto text-th-text-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm text-th-text-muted">No articles generated yet.</p>
          <p className="text-xs text-th-text-muted mt-1">Go to Content Generator to create your first article.</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="cs-card p-8 text-center">
          <p className="text-sm text-th-text-muted">No articles match your filters.</p>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Grid View ── */
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((a) => (
              <div
                key={a.slug}
                className="cs-card p-4 hover:border-th-accent transition-all cursor-pointer group relative"
                onClick={() => viewArticle(a.slug)}
              >
                {/* Delete button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(a.slug); }}
                  className="absolute top-3 right-3 p-1.5 rounded-md text-th-text-muted hover:text-th-danger hover:bg-th-danger-soft opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete article"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>

                {/* Type badge + ATLAS badge + grade */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="cs-badge bg-th-bg-secondary text-th-text-secondary text-[10px]">
                      {TYPE_LABELS[a.content_type] || a.content_type.replace("_", " ")}
                    </span>
                    {a.source === "atlas" && (
                      <span className="cs-badge bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-[10px] font-semibold">✦ ATLAS</span>
                    )}
                  </div>
                  {a.quality_grade && (
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${GRADE_BG[a.quality_grade] || "bg-th-bg-secondary text-th-text-muted"}`}>
                      {a.quality_grade}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h4 className="text-sm font-medium text-th-text line-clamp-2 mb-3 min-h-[2.5rem]">
                  {a.title || a.topic}
                </h4>

                {/* Meta row */}
                <div className="flex items-center gap-3 text-[11px] text-th-text-muted">
                  <span>{a.word_count.toLocaleString()} words</span>
                  <span>{a.table_count} tables</span>
                  <span>{a.section_count} sec</span>
                </div>

                {/* Bottom row */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-th-border-subtle">
                  {a.generated_at ? (
                    <span className="text-[10px] text-th-text-muted">
                      {formatDate(a.generated_at)}
                    </span>
                  ) : <span />}
                  <div className="flex items-center gap-1.5">
                    {!a.has_html && (
                      <span className="cs-badge bg-th-warning-soft text-th-warning text-[10px]">outline only</span>
                    )}
                    {a.has_html && !cardPublishResult[a.slug]?.ok && (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => quickPublish(a.slug, "draft")}
                          disabled={publishingCard === a.slug}
                          className="cs-badge bg-th-bg-secondary text-th-text-secondary hover:bg-th-accent hover:text-white text-[10px] cursor-pointer transition-colors py-0.5 px-1.5"
                          title="Push to WordPress as draft"
                        >
                          {publishingCard === a.slug ? "Pushing..." : "→ WP Draft"}
                        </button>
                      </div>
                    )}
                    {cardPublishResult[a.slug]?.ok && (
                      <a href={cardPublishResult[a.slug].post_url} target="_blank" rel="noopener noreferrer"
                        className="cs-badge bg-th-success-soft text-th-success text-[10px]"
                        onClick={(e) => e.stopPropagation()}>
                        ✓ Published
                      </a>
                    )}
                    {cardPublishResult[a.slug]?.error && (
                      <span className="cs-badge bg-th-danger-soft text-th-danger text-[10px]" title={cardPublishResult[a.slug].error}>
                        ✗ Failed
                      </span>
                    )}
                  </div>
                </div>

                {/* Confirm delete overlay */}
                {confirmDelete === a.slug && (
                  <div
                    className="absolute inset-0 bg-th-card/95 rounded-xl flex flex-col items-center justify-center gap-3 z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-sm text-th-text font-medium">Delete this article?</p>
                    <p className="text-xs text-th-text-muted">This removes all files from disk.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="cs-btn cs-btn-ghost text-xs py-1.5"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDelete(a.slug)}
                        disabled={deleting === a.slug}
                        className="cs-btn text-xs py-1.5 bg-th-danger text-white hover:bg-th-danger/90"
                      >
                        {deleting === a.slug ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              onClick={() => setPageSize((prev) => prev + 20)}
              className="w-full py-3 text-sm font-medium text-th-accent hover:text-th-accent-hover bg-th-accent-soft hover:bg-th-accent-muted rounded-lg transition-colors"
            >
              Load more ({sorted.length - pageSize} remaining)
            </button>
          )}
        </>
      ) : (
        /* ── List View ── */
        <>
          <div className="cs-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-th-border bg-th-bg-secondary">
                  <th className="text-left py-3 px-4 text-xs font-medium text-th-text-muted">Title</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-th-text-muted">Type</th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-th-text-muted">Words</th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-th-text-muted">Tables</th>
                  <th className="text-center py-3 px-3 text-xs font-medium text-th-text-muted">Grade</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-th-text-muted">Date</th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-th-text-muted w-16"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr
                    key={a.slug}
                    className="border-b border-th-border-subtle hover:bg-th-bg-secondary transition-colors cursor-pointer group"
                    onClick={() => viewArticle(a.slug)}
                  >
                    <td className="py-3 px-4 text-th-text font-medium max-w-sm">
                      <p className="truncate" title={a.title || a.topic}>{a.title || a.topic}</p>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="cs-badge bg-th-bg-secondary text-th-text-secondary text-[10px]">
                          {TYPE_LABELS[a.content_type] || a.content_type.replace("_", " ")}
                        </span>
                        {a.source === "atlas" && (
                          <span className="cs-badge bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-[10px] font-semibold">✦ ATLAS</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right text-th-text-secondary">{a.word_count.toLocaleString()}</td>
                    <td className="py-3 px-3 text-right text-th-text-secondary">{a.table_count}</td>
                    <td className="py-3 px-3 text-center">
                      {a.quality_grade ? (
                        <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-[10px] font-bold ${GRADE_BG[a.quality_grade] || "bg-th-bg-secondary text-th-text-muted"}`}>
                          {a.quality_grade}
                        </span>
                      ) : (
                        <span className="text-th-text-muted">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-th-text-muted whitespace-nowrap">
                      {a.generated_at ? formatDate(a.generated_at) : "-"}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {confirmDelete === a.slug ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleDelete(a.slug)}
                            disabled={deleting === a.slug}
                            className="text-[10px] px-2 py-1 rounded bg-th-danger text-white hover:bg-th-danger/90"
                          >
                            {deleting === a.slug ? "..." : "Yes"}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-[10px] px-2 py-1 rounded bg-th-bg-secondary text-th-text-muted"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(a.slug); }}
                          className="p-1 rounded text-th-text-muted hover:text-th-danger opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={() => setPageSize((prev) => prev + 20)}
              className="w-full py-3 text-sm font-medium text-th-accent hover:text-th-accent-hover bg-th-accent-soft hover:bg-th-accent-muted rounded-lg transition-colors"
            >
              Load more ({sorted.length - pageSize} remaining)
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ── Date formatter ── */
function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    if (diffH < 168) return `${Math.round(diffH / 24)}d ago`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return dateStr; }
}

/* ── Parse HTML into sections by h2/h3 ── */
function parseSections(html: string): { heading: string; tag: string; sectionHtml: string }[] {
  const sections: { heading: string; tag: string; sectionHtml: string }[] = [];
  const regex = /<(h[23])([^>]*)>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[23][\s>]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const tag = match[1];
    const attrs = match[2];
    const headingInner = match[3];
    const body = match[4].trim();
    const headingText = headingInner.replace(/<[^>]+>/g, "").trim();
    if (!headingText) continue;
    const fullHtml = `<${tag}${attrs}>${headingInner}</${tag}>\n${body}`;
    sections.push({ heading: headingText, tag, sectionHtml: fullHtml });
  }
  return sections;
}

/* ── Build smart rewrite instructions from quality report ── */
function buildSmartRewriteInstructions(quality: ArticleMeta["quality"]): string {
  if (!quality) return "";
  const fixes: string[] = [];
  if (quality.data_density < 2.5)
    fixes.push(`boost data density (currently ${quality.data_density.toFixed(1)}/100w — add specific stats, fees, ranks, percentages)`);
  if (!quality.has_faq)
    fixes.push("add a FAQ section answering the 5 most common reader questions about this topic");
  if (quality.table_count < 3)
    fixes.push(`add more comparison or data tables (currently ${quality.table_count} — target at least 4)`);
  if (quality.fact_check_rate < 80)
    fixes.push(`improve factual accuracy (currently ${Math.round(quality.fact_check_rate)}% verified — back every number with a named source)`);
  if (quality.readability === "Poor" || quality.readability === "Very Poor")
    fixes.push("improve readability — shorter sentences, clearer section openings, avoid jargon");
  if (quality.quality_issues?.length)
    quality.quality_issues.slice(0, 3).forEach(i => fixes.push(i.toLowerCase()));
  if (fixes.length === 0) return "";
  return `Target Grade A (score 90+). Fix these specific issues:\n- ${fixes.join("\n- ")}`;
}

/* ── Article Preview + Rich Editor + Publish ── */
function ArticlePreview({ html, meta, slug }: { html: string | null; meta: ArticleMeta | null; slug?: string }) {
  const [editing, setEditing] = useState(false);
  const [editedHtml, setEditedHtml] = useState(html || "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [generatingCover, setGeneratingCover] = useState(false);
  const [showImageInsert, setShowImageInsert] = useState(false);
  const [insertImageUrl, setInsertImageUrl] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ ok?: boolean; post_url?: string; edit_url?: string; error?: string } | null>(null);
  const [publishStatus, setPublishStatus] = useState<"draft" | "publish">("draft");
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);

  // ── Rewrite panel state ──
  const [showRewrite, setShowRewrite] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<{ titleIssue: { issue: string; suggested: string } | null; sections: { heading: string; issue: string }[] } | null>(null);
  const [sectionInstructions, setSectionInstructions] = useState<Record<number, string>>({});
  const [titleInstruction, setTitleInstruction] = useState("");
  const [globalInstruction, setGlobalInstruction] = useState("Improve accuracy and depth. Replace vague prose with specific facts, numbers, and named sources.");
  const [analyzing, setAnalyzing] = useState(false);
  const [rewriteProgress, setRewriteProgress] = useState<{ current: number; total: number; sectionName: string } | null>(null);
  const [rewriteDone, setRewriteDone] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const [liveTitle, setLiveTitle] = useState(meta?.title || "");

  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setEditedHtml(html || ""); }, [html]);

  if (!html) return <p className="text-sm text-th-text-muted">No article HTML available.</p>;

  const sections = parseSections(editedHtml || html || "");

  // ── Client-side generic title detection (fallback when LLM misses it) ──
  const GENERIC_TITLE_PATTERNS = [
    /overview,?\s*key highlights/i, /key highlights.*why it matters/i,
    /why it matters/i, /complete guide/i, /everything you need to know/i,
    /key facts.*why/i, /overview.*key facts/i, /what it is.*key facts/i,
    /types.*categories.*explained/i, /: overview$/i,
  ];
  const detectGenericTitle = (title: string): string => {
    if (!title) return "";
    const tl = title.toLowerCase();
    if (GENERIC_TITLE_PATTERNS.some(p => p.test(tl))) {
      return `Replace with a specific title containing concrete data (rank, fees, or key stat from the article). Current title is too generic.`;
    }
    return "";
  };

  // ── Run analysis — populates per-section issue cards ──
  const runAnalyze = async () => {
    if (!meta || analyzing) return;
    setAnalyzing(true);
    setAnalyzeResult(null);
    setRewriteError("");
    try {
      const ar = await fetch("/api/article/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: editedHtml || html || "",
          topic: meta.topic,
          contentType: meta.content_type,
          qualityScore: meta.quality?.overall_score ?? 0,
          currentTitle: liveTitle || meta.title,
        }),
      });
      if (ar.ok) {
        const ad = await ar.json() as { titleIssue?: { issue: string; suggested: string } | null; sections?: { heading: string; issue: string }[]; error?: string };
        if (!ad.error) {
          setAnalyzeResult({ titleIssue: ad.titleIssue ?? null, sections: ad.sections ?? [] });
          // Pre-fill title instruction: use LLM suggestion, or fall back to client-side detection
          const suggested = ad.titleIssue?.suggested || detectGenericTitle(liveTitle || meta.title);
          if (suggested) setTitleInstruction(suggested);
          // Pre-fill section instructions by matching headings
          const prefilled: Record<number, string> = {};
          sections.forEach((sec, idx) => {
            const secLow = sec.heading.toLowerCase();
            const match = (ad.sections ?? []).find(s => {
              const sLow = s.heading.toLowerCase();
              return secLow.includes(sLow.slice(0, 15)) || sLow.includes(secLow.slice(0, 15));
            });
            if (match) prefilled[idx] = match.issue;
          });
          setSectionInstructions(prefilled);
        }
      }
    } catch { setRewriteError("Analysis failed — check connection and try again."); }
    finally { setAnalyzing(false); }
  };

  // ── Run section-by-section rewrite using /api/rewrite ──
  const runSectionRewrites = async () => {
    if (!meta) return;
    // Use per-section instruction if set, else fall back to global instruction
    const fallback = globalInstruction.trim();
    const toFix = sections
      .map((section, idx) => ({ section, idx, instruction: sectionInstructions[idx]?.trim() || fallback }))
      .filter(({ instruction }) => instruction.length > 0);

    if (toFix.length === 0 && !titleInstruction.trim()) {
      setRewriteError("Add at least one instruction before starting the rewrite.");
      return;
    }

    setRewriteError("");
    setRewriteDone(false);
    const totalSteps = toFix.length + (titleInstruction.trim() ? 1 : 0);
    setRewriteProgress({ current: 0, total: totalSteps, sectionName: "Starting…" });

    let currentHtml = editedHtml || html || "";

    // Update title first if instruction provided — also patch H1 in HTML
    if (titleInstruction.trim()) {
      const newTitle = titleInstruction.trim();
      setLiveTitle(newTitle);
      if (slug) await saveTitle(newTitle);
      // Replace <h1>...</h1> in the article HTML so the preview updates too
      currentHtml = currentHtml.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, `<h1>${newTitle}</h1>`);
      setRewriteProgress({ current: 1, total: totalSteps, sectionName: "Title updated" });
    }

    const titleOffset = titleInstruction.trim() ? 1 : 0;
    for (let i = 0; i < toFix.length; i++) {
      const { section, instruction } = toFix[i];
      setRewriteProgress({ current: titleOffset + i + 1, total: totalSteps, sectionName: section.heading });
      try {
        const res = await fetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionHeading: section.heading,
            sectionHtml: section.sectionHtml,
            instruction,
            topicContext: meta.topic,
            qualityIssues: meta.quality?.quality_issues,
            slug,
          }),
        });
        const data = await res.json() as { html?: string; error?: string };
        if (res.ok && data.html) {
          currentHtml = currentHtml.replace(section.sectionHtml, data.html);
        }
      } catch { /* continue with remaining sections */ }
    }

    // Save final article
    setEditedHtml(currentHtml);
    if (slug) {
      await fetch("/api/article", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, html: currentHtml }),
      });
    }
    setRewriteProgress(null);
    setRewriteDone(true);
  };

  const downloadArticle = (format: "html" | "word" | "pdf") => {
    const title = meta?.title || slug || "article";
    const safeTitle = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60);
    const content = editedHtml || html || "";
    const baseStyle = "body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1a1a1a}h1,h2,h3{color:#111;margin-top:1.5em}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #ccc;padding:8px 10px;text-align:left}th{background:#f5f5f5;font-weight:600}img{max-width:100%}";
    if (format === "html") {
      const out = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>${title}</title><style>${baseStyle}</style></head>\n<body>${content}</body>\n</html>`;
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([out], { type: "text/html" })), download: `${safeTitle}.html` });
      a.click(); URL.revokeObjectURL(a.href);
    } else if (format === "word") {
      const out = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.6}h1{font-size:18pt}h2{font-size:14pt}h3{font-size:12pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px 8px}th{background:#f0f0f0}</style></head><body>${content}</body></html>`;
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["\ufeff" + out], { type: "application/msword" })), download: `${safeTitle}.doc` });
      a.click(); URL.revokeObjectURL(a.href);
    } else if (format === "pdf") {
      const win = window.open("", "_blank");
      if (!win) return;
      win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${baseStyle}@media print{body{max-width:none;margin:0;padding:24px}}</style></head><body>${content}<script>window.onload=function(){window.print();}<\/script></body></html>`);
      win.document.close();
    }
    setShowDownloadMenu(false);
  };

  const syncFromEditor = () => {
    if (editorRef.current) setEditedHtml(editorRef.current.innerHTML);
  };

  const saveEdits = async () => {
    if (!slug) return;
    syncFromEditor();
    const content = editorRef.current?.innerHTML || editedHtml;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/article", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, html: content }),
      });
      const data = await res.json();
      if (data.ok) {
        setEditedHtml(content);
        setSaveMsg("Saved");
        setEditing(false);
      } else setSaveMsg(data.error || "Save failed");
    } catch { setSaveMsg("Save failed"); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(""), 3000); }
  };

  const publishToWP = async () => {
    if (!meta) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meta.title,
          content: editedHtml || html,
          slug: meta.slug,
          coverImageUrl: coverImageUrl || undefined,
          status: publishStatus,
        }),
      });
      setPublishResult(await res.json());
    } catch (e) {
      setPublishResult({ error: (e as Error).message });
    } finally { setPublishing(false); }
  };

  const generateCoverImage = async () => {
    if (!meta) return;
    setGeneratingCover(true);
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: meta.title, type: "cover" }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!data.url) { alert(data.error || "Failed to generate image"); return; }
      // Compose: background image + title text overlay → JPEG data URL
      const composed = await composeCoverImage(data.url, meta.title);
      setCoverImageUrl(composed);
    } catch (e) { alert((e as Error).message); }
    finally { setGeneratingCover(false); }
  };

  const insertImage = () => {
    if (!editorRef.current || !insertImageUrl.trim()) return;
    const sel = window.getSelection();
    const imgHtml = `<figure class="cs-illustration"><img src="${insertImageUrl.trim()}" alt="Illustration" /><figcaption>Illustration</figcaption></figure>`;
    if (sel && sel.rangeCount > 0 && editorRef.current.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createRange().createContextualFragment(imgHtml));
    } else {
      editorRef.current.innerHTML += imgHtml;
    }
    syncFromEditor();
    setInsertImageUrl("");
    setShowImageInsert(false);
  };

  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    syncFromEditor();
  };

  const saveTitle = async (newTitle: string) => {
    if (!slug || !newTitle.trim() || newTitle === (meta?.title || "")) return;
    try {
      await fetch("/api/article", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, title: newTitle.trim() }) });
    } catch { /* non-blocking */ }
  };

  const q = meta?.quality;

  return (
    <div className="space-y-5">
      {/* Header */}
      {meta && (
        <div className="pb-4 border-b border-th-border flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={liveTitle || meta.title}
              onChange={(e) => setLiveTitle(e.target.value)}
              onBlur={(e) => saveTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
              className="w-full text-lg font-semibold text-th-text bg-transparent border-b border-transparent hover:border-th-border focus:border-th-accent focus:outline-none pb-0.5 transition-colors"
              title="Click to edit article title"
            />
            <div className="flex items-center gap-3 mt-2 text-xs text-th-text-muted flex-wrap">
              <span className="cs-badge bg-th-accent-soft text-th-accent">{meta.content_type.replace("_", " ")}</span>
              <span>{meta.word_count.toLocaleString()} words</span>
              <span>{meta.table_count} tables</span>
              <span>{meta.section_count} sections</span>
              {meta.generation_time > 0 && <span>{Math.round(meta.generation_time)}s</span>}
            </div>
          </div>
          {/* Rewrite + Download buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
          {/* Rewrite button */}
          <button
            onClick={() => {
              setShowRewrite((v) => !v);
              setRewriteError("");
              setRewriteDone(false);
            }}
            className={`cs-btn text-xs flex items-center gap-1.5 ${meta?.quality?.overall_grade === "D" ? "cs-btn-primary" : "cs-btn-secondary"}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {meta?.quality?.overall_grade === "D" ? "Rewrite (Grade D)" : "Rewrite"}
          </button>
          {/* Download dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDownloadMenu((v) => !v)}
              className="cs-btn cs-btn-secondary text-xs flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {showDownloadMenu && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-th-card border border-th-border rounded-lg shadow-lg py-1 w-40">
                {([["html", "HTML File"], ["word", "Word (.doc)"], ["pdf", "PDF (Print)"]] as [Parameters<typeof downloadArticle>[0], string][]).map(([fmt, label]) => (
                  <button key={fmt} onClick={() => downloadArticle(fmt)} className="w-full text-left px-3 py-2 text-xs hover:bg-th-card-hover text-th-text transition-colors">
                    {label}
                  </button>
                ))}
                <div className="border-t border-th-border my-1" />
                <button
                  onClick={() => { setShowDownloadMenu(false); const a = document.createElement("a"); a.href = `/api/article?slug=${slug}&part=sources`; a.download = `${slug}-sources.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-th-card-hover text-th-text transition-colors"
                >
                  Sources (.txt)
                </button>
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      {/* ── Rewrite Panel ── */}
      {showRewrite && (
        <div className="p-4 rounded-lg border border-th-border bg-th-bg-secondary space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-th-text">Rewrite Article</h4>
            <button onClick={() => { setShowRewrite(false); setAnalyzeResult(null); setRewriteDone(false); setRewriteError(""); }} className="text-xs text-th-text-muted hover:text-th-text">✕ Close</button>
          </div>

          {/* Step 1: Analyse button */}
          {!analyzeResult && !analyzing && !rewriteProgress && !rewriteDone && (
            <button onClick={runAnalyze} className="cs-btn cs-btn-secondary text-xs w-full flex items-center justify-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
              Analyse Article
            </button>
          )}

          {/* Analysing spinner */}
          {analyzing && (
            <div className="flex items-center gap-2 text-sm text-th-accent">
              <span className="w-4 h-4 rounded-full border-2 border-th-accent border-t-transparent animate-spin shrink-0" />
              Analysing article sections…
            </div>
          )}

          {/* Step 2: Section cards after analysis */}
          {analyzeResult && !rewriteProgress && !rewriteDone && (
            <div className="space-y-3">
              {/* Title card */}
              <div className="rounded-lg border border-th-border bg-th-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-th-border text-th-text-muted">H1</span>
                  <span className="text-sm font-medium text-th-text">Article Title</span>
                </div>
                {analyzeResult.titleIssue && (
                  <p className="text-[11px] text-th-warning bg-th-warning/10 rounded px-2 py-1.5">⚠ {analyzeResult.titleIssue.issue}</p>
                )}
                <input
                  type="text"
                  value={titleInstruction}
                  onChange={(e) => setTitleInstruction(e.target.value)}
                  placeholder="Type the new title here, or leave blank to keep current…"
                  className="cs-input w-full text-sm"
                />
              </div>

              {/* Global instruction — applies to all sections without a specific instruction */}
              <div className="rounded-lg border border-th-accent/30 bg-th-accent-soft p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-th-accent/40 text-th-accent">ALL</span>
                  <span className="text-sm font-medium text-th-text">Apply to all sections</span>
                  <span className="text-[11px] text-th-text-muted ml-auto">sections without their own instruction use this</span>
                </div>
                <textarea
                  value={globalInstruction}
                  onChange={(e) => setGlobalInstruction(e.target.value)}
                  rows={2}
                  className="cs-input w-full text-sm resize-none"
                />
              </div>

              {/* Section cards */}
              {sections.map((section, idx) => {
                const detected = analyzeResult.sections.find(s => {
                  const sLow = s.heading.toLowerCase();
                  const secLow = section.heading.toLowerCase();
                  return secLow.includes(sLow.slice(0, 15)) || sLow.includes(secLow.slice(0, 15));
                });
                return (
                  <div key={idx} className="rounded-lg border border-th-border bg-th-card p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-th-border text-th-text-muted">{section.tag.toUpperCase()}</span>
                      <span className="text-sm font-medium text-th-text truncate">{section.heading}</span>
                    </div>
                    {detected && (
                      <p className="text-[11px] text-th-warning bg-th-warning/10 rounded px-2 py-1.5">⚠ {detected.issue}</p>
                    )}
                    <textarea
                      value={sectionInstructions[idx] || ""}
                      onChange={(e) => setSectionInstructions(prev => ({ ...prev, [idx]: e.target.value }))}
                      placeholder={`Override for this section only, or leave blank to use the global instruction…`}
                      rows={2}
                      className="cs-input w-full text-sm resize-none"
                    />
                  </div>
                );
              })}

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <button onClick={runSectionRewrites} className="cs-btn cs-btn-primary text-xs flex-1">
                  Start Rewrite
                </button>
                <button onClick={runAnalyze} className="cs-btn cs-btn-secondary text-xs">
                  Re-analyse
                </button>
              </div>
            </div>
          )}

          {/* Progress bar */}
          {rewriteProgress && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-th-accent">
                <span className="w-4 h-4 rounded-full border-2 border-th-accent border-t-transparent animate-spin shrink-0" />
                <span className="truncate">Rewriting: {rewriteProgress.sectionName}</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-th-border overflow-hidden">
                <div className="h-full bg-th-accent transition-all duration-300" style={{ width: `${(rewriteProgress.current / rewriteProgress.total) * 100}%` }} />
              </div>
              <p className="text-xs text-th-text-muted">{rewriteProgress.current} of {rewriteProgress.total} steps</p>
            </div>
          )}

          {rewriteError && <p className="text-sm text-th-danger">{rewriteError}</p>}

          {rewriteDone && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-th-success-soft">
                <svg className="w-4 h-4 text-th-success shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm text-th-success font-medium">Rewrite complete! Article saved.</span>
              </div>
              <button onClick={() => { setRewriteDone(false); setAnalyzeResult(null); setSectionInstructions({}); setTitleInstruction(""); setGlobalInstruction("Improve accuracy and depth. Replace vague prose with specific facts, numbers, and named sources."); setRewriteError(""); }} className="cs-btn cs-btn-secondary text-xs w-full">
                Analyse Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Analysis strip */}
      {q && (
        <div className="grid grid-cols-6 gap-2">
          {[
            { label: "Grade", value: q.overall_grade, sub: `${q.overall_score}/100`, color: q.overall_score >= 80 ? "text-th-success" : q.overall_score >= 60 ? "text-th-accent" : "text-th-warning" },
            { label: "Readability", value: q.readability, sub: `${q.heading_count} headings`, color: "text-th-text" },
            { label: "Data Points", value: String(q.data_points), sub: `${q.data_density.toFixed(1)}/100w`, color: "text-th-purple" },
            { label: "Fact Check", value: `${(q.fact_check_rate * 100).toFixed(0)}%`, sub: `${q.fact_check_verified} verified`, color: q.fact_check_rate >= 0.95 ? "text-th-success" : "text-th-warning" },
            { label: "Tables", value: String(q.table_count), sub: `${q.list_count} lists`, color: "text-th-teal" },
            { label: "FAQ", value: q.has_faq ? "Yes" : "No", sub: q.passed ? "Passed" : "Failed", color: q.has_faq ? "text-th-success" : "text-th-text-muted" },
          ].map((m) => (
            <div key={m.label} className="p-2.5 rounded-lg bg-th-bg-secondary text-center">
              <p className="text-[10px] text-th-text-muted uppercase tracking-wide">{m.label}</p>
              <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
              <p className="text-[10px] text-th-text-muted">{m.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Cover Image */}
      <div className="p-4 rounded-lg border border-th-border">
        <p className="text-xs font-medium text-th-text-secondary mb-2">Cover Image</p>
        {coverImageUrl && (
          <div className="mb-3 relative group">
            <img src={coverImageUrl} alt="Cover" className="w-full max-h-48 object-cover rounded-lg border border-th-border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <button onClick={() => setCoverImageUrl("")} className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="text" value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="Paste image URL..." className="cs-input flex-1 text-xs" />
          <button onClick={generateCoverImage} disabled={generatingCover} className="cs-btn cs-btn-secondary text-xs whitespace-nowrap">
            {generatingCover ? (
              <><div className="w-3 h-3 rounded-full border-2 border-th-accent border-t-transparent animate-spin" /> Generating...</>
            ) : (
              <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg> Auto-Generate</>
            )}
          </button>
        </div>
      </div>

      {/* Editor toolbar + content */}
      <div className="rounded-lg border border-th-border overflow-hidden">
        <div className="flex items-center gap-1 px-3 py-2 bg-th-bg-secondary border-b border-th-border flex-wrap">
          <div className="flex items-center rounded-lg bg-th-card border border-th-border mr-2">
            <button
              onClick={() => { if (editing && showSource) { setShowSource(false); } if (!editing) { setEditing(true); setShowSource(false); } }}
              className={`px-3 py-1.5 text-xs font-medium rounded-l-lg transition-colors ${editing && !showSource ? "bg-th-accent text-white" : "text-th-text-secondary hover:text-th-text"}`}
            >
              Edit
            </button>
            <button
              onClick={() => { if (!editing) setEditing(true); setShowSource(true); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${editing && showSource ? "bg-th-accent text-white" : "text-th-text-secondary hover:text-th-text"}`}
            >
              Source
            </button>
            <button
              onClick={() => { syncFromEditor(); setEditing(false); setShowSource(false); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-r-lg transition-colors ${!editing ? "bg-th-accent text-white" : "text-th-text-secondary hover:text-th-text"}`}
            >
              Preview
            </button>
          </div>

          {editing && !showSource && (
            <>
              <div className="w-px h-5 bg-th-border mx-1" />
              <ToolBtn title="Bold" onClick={() => execCmd("bold")}>B</ToolBtn>
              <ToolBtn title="Italic" onClick={() => execCmd("italic")}><em>I</em></ToolBtn>
              <ToolBtn title="Heading 2" onClick={() => execCmd("formatBlock", "h2")}>H2</ToolBtn>
              <ToolBtn title="Heading 3" onClick={() => execCmd("formatBlock", "h3")}>H3</ToolBtn>
              <ToolBtn title="Bullet List" onClick={() => execCmd("insertUnorderedList")}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
              </ToolBtn>
              <div className="w-px h-5 bg-th-border mx-1" />
              <div className="relative">
                <button
                  onClick={() => setShowImageInsert(!showImageInsert)}
                  title="Insert image at cursor"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-th-purple-soft text-th-purple hover:bg-th-purple hover:text-white transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" /></svg>
                  Add Image
                </button>
                {showImageInsert && (
                  <div className="absolute top-full left-0 mt-1 p-3 bg-th-card border border-th-border rounded-lg shadow-lg z-10 w-72">
                    <p className="text-xs text-th-text-muted mb-2">Paste image URL to insert at cursor</p>
                    <div className="flex gap-2">
                      <input type="text" value={insertImageUrl} onChange={(e) => setInsertImageUrl(e.target.value)} placeholder="https://..." className="cs-input text-xs flex-1" onKeyDown={(e) => e.key === "Enter" && insertImage()} />
                      <button onClick={insertImage} disabled={!insertImageUrl.trim()} className="cs-btn cs-btn-primary text-xs py-1 px-2">Insert</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {saveMsg && <span className={`text-xs font-medium ${saveMsg === "Saved" ? "text-th-success" : "text-th-danger"}`}>{saveMsg}</span>}
            {editing && (
              <>
                <button onClick={() => { setEditing(false); setShowSource(false); setEditedHtml(html); if (editorRef.current) editorRef.current.innerHTML = html; }} className="cs-btn cs-btn-ghost text-xs py-1">Discard</button>
                <button onClick={saveEdits} disabled={saving} className="cs-btn cs-btn-primary text-xs py-1">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>

        {editing && showSource ? (
          <textarea
            value={editedHtml}
            onChange={(e) => setEditedHtml(e.target.value)}
            className="w-full h-[550px] font-mono text-xs p-4 bg-white dark:bg-th-bg-secondary text-th-text resize-y focus:outline-none border-none"
            spellCheck={false}
          />
        ) : editing ? (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={syncFromEditor}
            className="cs-article overflow-y-auto max-h-[550px] bg-white dark:bg-th-bg-secondary p-6 focus:outline-none"
            dangerouslySetInnerHTML={{ __html: cleanArticleHtml(editedHtml) }}
          />
        ) : (
          <div
            className="cs-article overflow-y-auto max-h-[550px] bg-white dark:bg-th-bg-secondary p-6"
            dangerouslySetInnerHTML={{ __html: cleanArticleHtml(editedHtml || html) }}
          />
        )}
      </div>


      {/* Publish bar */}
      <div className="flex items-center gap-3 p-4 rounded-lg border border-th-border bg-th-bg-secondary">
        <svg className="w-5 h-5 text-th-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-th-text">Publish to WordPress</p>
        </div>
        <select value={publishStatus} onChange={(e) => setPublishStatus(e.target.value as "draft" | "publish")} className="cs-input w-auto text-xs py-1.5">
          <option value="draft">Draft</option>
          <option value="publish">Publish</option>
        </select>
        <button onClick={publishToWP} disabled={publishing} className="cs-btn cs-btn-primary text-xs py-1.5">
          {publishing ? (
            <><div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" /> Publishing...</>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg> Publish</>
          )}
        </button>
      </div>
      {publishResult && (
        <div className={`p-3 rounded-lg text-sm ${publishResult.ok ? "bg-th-success-soft" : "bg-th-danger-soft"}`}>
          {publishResult.ok ? (
            <div className="flex items-center gap-4">
              <span className="text-th-success font-medium">Published!</span>
              {publishResult.post_url && <a href={publishResult.post_url} target="_blank" rel="noopener noreferrer" className="text-xs text-th-accent hover:underline">View post</a>}
              {publishResult.edit_url && <a href={publishResult.edit_url} target="_blank" rel="noopener noreferrer" className="text-xs text-th-text-muted hover:underline">Edit in WP</a>}
            </div>
          ) : (
            <p className="text-th-danger">{publishResult.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Toolbar button ── */
function ToolBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} className="w-7 h-7 flex items-center justify-center rounded text-xs font-bold text-th-text-secondary hover:bg-th-card hover:text-th-text transition-colors">
      {children}
    </button>
  );
}

/* ── Quality Report ── */
function QualityReport({ meta }: { meta: ArticleMeta | null }) {
  if (!meta?.quality) return <p className="text-sm text-th-text-muted">No quality data available.</p>;
  const q = meta.quality;

  const gradeColor: Record<string, string> = {
    "A+": "text-th-success", A: "text-th-success",
    B: "text-th-accent", "B+": "text-th-accent",
    C: "text-th-warning", "C+": "text-th-warning",
    D: "text-th-danger", F: "text-th-danger",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className={`text-4xl font-bold ${gradeColor[q.overall_grade] || "text-th-text"}`}>{q.overall_grade}</p>
          <p className="text-xs text-th-text-muted mt-1">{q.overall_score}/100</p>
        </div>
        <div className="flex-1">
          <div className="w-full bg-th-bg-secondary rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${q.overall_score >= 80 ? "bg-th-success" : q.overall_score >= 60 ? "bg-th-accent" : "bg-th-warning"}`}
              style={{ width: `${q.overall_score}%` }}
            />
          </div>
          <p className={`text-xs mt-1 ${q.passed ? "text-th-success" : "text-th-danger"}`}>
            {q.passed ? "Quality check passed" : "Quality check failed"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Data Density", value: `${q.data_density.toFixed(2)} pts/100w`, desc: `${q.data_points} data points` },
          { label: "Readability", value: q.readability, desc: `${q.heading_count} headings` },
          { label: "Fact-Check Rate", value: `${(q.fact_check_rate * 100).toFixed(0)}%`, desc: `${q.fact_check_verified} verified, ${q.fact_check_unverified} unverified` },
          { label: "Content Structure", value: `${q.table_count}T / ${q.list_count}L`, desc: `${q.table_count} tables, ${q.list_count} lists${q.has_faq ? ", FAQ" : ""}` },
        ].map((m) => (
          <div key={m.label} className="p-4 rounded-lg bg-th-bg-secondary">
            <p className="text-xs text-th-text-muted">{m.label}</p>
            <p className="text-lg font-bold text-th-text mt-1">{m.value}</p>
            <p className="text-xs text-th-text-muted mt-0.5">{m.desc}</p>
          </div>
        ))}
      </div>

      {q.quality_issues.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-th-text mb-2">Issues</h4>
          <div className="space-y-1.5">
            {q.quality_issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <svg className="w-4 h-4 text-th-warning shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                </svg>
                <span className="text-th-text-secondary">{issue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {meta.post_processing && (
        <div>
          <h4 className="text-sm font-semibold text-th-text mb-2">Post-Processing</h4>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-th-bg-secondary text-center">
              <p className="text-lg font-bold text-th-text">{meta.post_processing.banned_removed.length}</p>
              <p className="text-xs text-th-text-muted">Banned phrases removed</p>
              {meta.post_processing.banned_removed.length > 0 && (
                <p className="text-[10px] text-th-text-muted mt-1 truncate" title={meta.post_processing.banned_removed.join(", ")}>
                  {meta.post_processing.banned_removed.join(", ")}
                </p>
              )}
            </div>
            <div className="p-3 rounded-lg bg-th-bg-secondary text-center">
              <p className="text-lg font-bold text-th-text">{meta.post_processing.names_redacted.length}</p>
              <p className="text-xs text-th-text-muted">Names redacted</p>
            </div>
            <div className="p-3 rounded-lg bg-th-bg-secondary text-center">
              <p className="text-lg font-bold text-th-text">{meta.post_processing.hallucination_issues}</p>
              <p className="text-xs text-th-text-muted">Hallucination flags</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sections View ── */
function SectionsView({ meta }: { meta: ArticleMeta | null }) {
  if (!meta?.sections?.length) return <p className="text-sm text-th-text-muted">No section data available.</p>;

  const totalChars = meta.sections.reduce((sum, s) => sum + s.chars, 0);
  const avgLatency = meta.sections.reduce((sum, s) => sum + s.latency, 0) / meta.sections.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6 text-sm">
        <span className="text-th-text-muted">{meta.sections.length} sections</span>
        <span className="text-th-text-muted">{(totalChars / 1000).toFixed(1)}k chars total</span>
        <span className="text-th-text-muted">{avgLatency.toFixed(1)}s avg latency</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-th-border">
              <th className="text-left py-2 px-3 text-xs font-medium text-th-text-muted">#</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-th-text-muted">Heading</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-th-text-muted">Chars</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-th-text-muted">Time</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-th-text-muted">Model</th>
            </tr>
          </thead>
          <tbody>
            {meta.sections.map((s, i) => (
              <tr key={i} className="border-b border-th-border-subtle hover:bg-th-bg-secondary transition-colors">
                <td className="py-2.5 px-3 text-th-text-muted">{i + 1}</td>
                <td className="py-2.5 px-3 text-th-text font-medium max-w-md truncate" title={s.heading}>
                  {s.heading}
                </td>
                <td className="py-2.5 px-3 text-right text-th-text-secondary">{s.chars.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-right text-th-text-secondary">{s.latency.toFixed(1)}s</td>
                <td className="py-2.5 px-3">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-th-bg-secondary text-th-text-muted">
                    {s.model.split("/").pop()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-xs text-th-text-muted mb-2">Character distribution</p>
        <div className="flex h-4 rounded-full overflow-hidden bg-th-bg-secondary">
          {meta.sections.map((s, i) => {
            const pct = (s.chars / totalChars) * 100;
            const colors = ["bg-th-accent", "bg-th-purple", "bg-th-teal", "bg-th-warning", "bg-th-orange", "bg-th-pink", "bg-th-success", "bg-th-danger"];
            return (
              <div
                key={i}
                className={`${colors[i % colors.length]} transition-all`}
                style={{ width: `${pct}%` }}
                title={`${s.heading}: ${s.chars} chars (${pct.toFixed(0)}%)`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-2">
          {meta.sections.map((s, i) => {
            const colors = ["bg-th-accent", "bg-th-purple", "bg-th-teal", "bg-th-warning", "bg-th-orange", "bg-th-pink", "bg-th-success", "bg-th-danger"];
            return (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-th-text-muted">
                <div className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
                <span className="truncate max-w-28" title={s.heading}>S{i + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Outline View ── */
function OutlineView({ outline }: { outline: Record<string, unknown> | null }) {
  if (!outline) return <p className="text-sm text-th-text-muted">No outline data available.</p>;

  const sections = (outline.sections || []) as {
    heading: string;
    format: string;
    priority: string;
    tier: number;
    columns?: string[];
    items_target?: number;
    rows_target?: number;
  }[];
  const persona = outline.user_persona as { who?: string; core_questions?: string[]; pain_points?: string[] } | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="cs-badge bg-th-accent-soft text-th-accent">
          {String(outline.content_type || "").replace("_", " ")}
        </span>
        <span className="cs-badge bg-th-purple-soft text-th-purple">
          {String(outline.primary_intent || "")}
        </span>
        <span className="cs-badge bg-th-teal-soft text-th-teal">
          {String(outline.confidence || "")} confidence
        </span>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-th-text mb-3">Sections ({sections.length})</h4>
        <div className="space-y-2">
          {sections.map((s, i) => {
            const tierColors = ["", "bg-th-danger", "bg-th-warning", "bg-th-accent", "bg-th-text-muted"];
            return (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-th-bg-secondary">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${tierColors[s.tier] || "bg-th-text-muted"}`}>
                  {s.tier}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-th-text truncate" title={s.heading}>{s.heading}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-th-text-muted">
                    <span className="capitalize">{s.format}</span>
                    <span className="capitalize">{s.priority}</span>
                    {s.columns && <span>{s.columns.length} columns</span>}
                    {s.rows_target && <span>{s.rows_target} rows target</span>}
                    {s.items_target && <span>{s.items_target} items target</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {persona && (
        <div>
          <h4 className="text-sm font-semibold text-th-text mb-3">Target User</h4>
          <div className="p-4 rounded-lg bg-th-bg-secondary">
            <p className="text-sm text-th-text">{persona.who}</p>
            {persona.core_questions && persona.core_questions.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-th-text-muted mb-1">Core questions:</p>
                <ul className="space-y-1">
                  {persona.core_questions.map((q, i) => (
                    <li key={i} className="text-xs text-th-text-secondary flex items-start gap-1.5">
                      <span className="text-th-accent shrink-0">?</span>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── HTML cleaner + chart injection ── */
function parseHtmlTable(tableHtml: string): { headers: string[]; rows: string[][] } {
  const headerMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const bodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);

  const headers: string[] = [];
  if (headerMatch) {
    const thMatches = headerMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi);
    for (const m of thMatches) headers.push(m[1].trim());
  }

  const rows: string[][] = [];
  if (bodyMatch) {
    const trMatches = bodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const tr of trMatches) {
      const cells: string[] = [];
      const tdMatches = tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      for (const td of tdMatches) cells.push(td[1].trim());
      if (cells.length > 0) rows.push(cells);
    }
  }

  return { headers, rows };
}

function generateBarChart(headers: string[], rows: string[][], tableIndex: number, usedColTypes: Set<string>): string {
  const COL_KEYWORDS: [string, string][] = [
    ["salary", "salary"], ["package", "package"], ["lpa", "lpa"], ["ctc", "ctc"],
    ["fee", "fee"], ["cost", "cost"],
    ["rank", "rank"], ["nirf", "rank"], ["score", "score"], ["percentile", "score"],
    ["seats", "seats"], ["intake", "seats"], ["count", "count"],
  ];
  let numCol = -1;
  let colType = "";
  const labelCol = 0;
  for (const [kw, type] of COL_KEYWORDS) {
    for (let c = 1; c < headers.length; c++) {
      if (headers[c].toLowerCase().includes(kw)) {
        numCol = c; colType = type; break;
      }
    }
    if (numCol !== -1) break;
  }
  if (numCol === -1 || usedColTypes.has(colType)) return "";
  usedColTypes.add(colType);

  const data: { label: string; value: number; raw: string }[] = [];
  for (const row of rows.slice(0, 10)) {
    const label = row[labelCol]?.replace(/<[^>]*>/g, "").trim().slice(0, 25) || "";
    const rawVal = row[numCol]?.replace(/<[^>]*>/g, "").trim() || "";
    const nums = rawVal.match(/[\d.]+/g);
    if (!nums || !label) continue;
    const values = nums.map(Number).filter((n) => n > 0 && n < 10000);
    if (values.length === 0) continue;
    const value = values.length >= 2 ? (values[0] + values[1]) / 2 : values[0];
    data.push({ label, value, raw: rawVal });
  }

  if (data.length < 2) return "";

  const maxVal = Math.max(...data.map((d) => d.value));
  const chartW = 700;
  const barH = 28;
  const gap = 6;
  const labelW = 160;
  const valueW = 80;
  const chartH = data.length * (barH + gap) + 50;

  const title = headers[numCol].replace(/<[^>]*>/g, "").trim();

  let svg = `<div class="cs-chart" style="margin:1.5rem 0;padding:1rem;background:var(--bg-secondary);border-radius:0.75rem;border:1px solid var(--border)">`;
  svg += `<p style="font-size:0.8rem;font-weight:600;color:var(--text);margin:0 0 0.75rem">${title} Comparison</p>`;
  svg += `<svg viewBox="0 0 ${chartW} ${chartH}" style="width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">`;

  data.forEach((d, i) => {
    const y = i * (barH + gap) + 10;
    const barW = Math.max(8, (d.value / maxVal) * (chartW - labelW - valueW - 20));
    const color = CHART_COLORS[i % CHART_COLORS.length];
    svg += `<text x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="11" fill="var(--text-secondary)" font-family="system-ui">${d.label}</text>`;
    svg += `<rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.85"/>`;
    svg += `<text x="${labelW + barW + 8}" y="${y + barH / 2 + 4}" font-size="11" fill="var(--text)" font-weight="600" font-family="system-ui">${d.raw}</text>`;
  });

  svg += `</svg></div>`;
  return svg;
}

function renderInsightCharts(html: string): string {
  return html.replace(/<cs-chart>([\s\S]*?)<\/cs-chart>/gi, (_, jsonStr) => {
    try {
      const chart = JSON.parse(jsonStr.trim());
      const items: { label: string; value: number; display: string }[] = (chart.items || []).slice(0, 12);
      if (items.length < 2) return "";
      const maxVal = Math.max(...items.map((d) => d.value));
      if (maxVal === 0) return "";
      const chartW = 700, barH = 28, gap = 6, labelW = 170, valueW = 160;
      const chartH = items.length * (barH + gap) + 50;
      let svg = `<div class="cs-chart" style="margin:2rem 0;padding:1.25rem;background:var(--bg-secondary);border-radius:0.75rem;border:1px solid var(--border)">`;
      svg += `<p style="font-size:0.85rem;font-weight:700;color:var(--text);margin:0 0 0.25rem">${chart.title}</p>`;
      if (chart.y_label) svg += `<p style="font-size:0.72rem;color:var(--text-secondary);margin:0 0 0.75rem">${chart.y_label}</p>`;
      svg += `<svg viewBox="0 0 ${chartW} ${chartH}" style="width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">`;
      items.forEach((d, i) => {
        const y = i * (barH + gap) + 10;
        const barW = Math.max(8, (d.value / maxVal) * (chartW - labelW - valueW - 20));
        const color = CHART_COLORS[i % CHART_COLORS.length];
        svg += `<text x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="11" fill="var(--text-secondary)" font-family="system-ui">${d.label}</text>`;
        svg += `<rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.85"/>`;
        svg += `<text x="${labelW + barW + 8}" y="${y + barH / 2 + 4}" font-size="11" fill="var(--text)" font-weight="600" font-family="system-ui">${d.display ?? d.value}</text>`;
      });
      svg += `</svg></div>`;
      return svg;
    } catch {
      return "";
    }
  });
}

function cleanArticleHtml(html: string): string {
  let cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/cellspacing="[^"]*"/gi, "")
    .replace(/cellpadding="[^"]*"/gi, "")
    .replace(/border="[^"]*"/gi, "")
    .replace(/<table[^>]*style="[^"]*"[^>]*>/gi, "<table>")
    .replace(/<table[^>]*>/gi, "<table>")
    .replace(/<p>\s*,\s*/gi, "<p>");

  cleaned = renderInsightCharts(cleaned);
  return cleaned;
}
