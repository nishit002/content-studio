"use client";

import { useState, useRef, useCallback, useEffect } from "react";

/* ── Pipeline stage config ── */
const STAGES = [
  { id: "queued", label: "Queued", icon: "clock" },
  { id: "classifying", label: "Classifying", icon: "tag" },
  { id: "researching", label: "Researching", icon: "search" },
  { id: "outlining", label: "Outlining", icon: "list" },
  { id: "writing", label: "Writing", icon: "pencil" },
  { id: "post_processing", label: "Post-Processing", icon: "check" },
  { id: "done", label: "Done", icon: "sparkle" },
] as const;

type Stage = (typeof STAGES)[number]["id"] | "error";

interface ProgressEvent {
  stage: Stage;
  message: string;
  detail?: Record<string, unknown>;
  jobId?: string;
  contentId?: string;
  timestamp: number;
}

/* ── Article data from /api/article ── */
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
}

type ResultTab = "preview" | "quality" | "sections" | "outline";

type GenerateMode = "single" | "bulk" | "news";

interface BulkRow {
  id: number;
  topic: string;
  subKeywords: string;
  category: string;
  region: string;
}

interface BulkItem extends BulkRow {
  stage: Stage | "waiting";
  startedAt: number | null;
  finishedAt: number | null;
  elapsed: number;
  wordCount: number;
  tableCount: number;
  qualityGrade: string;
  qualityScore: number;
  error: string;
  articlePath: string;
}

interface AeoSuggestions {
  topic: string;
  customOutline: string;
  fromUrl: string;
}

export function ContentGeneratorTab({
  aeoSuggestions,
  onAeoSuggestionsConsumed,
}: {
  aeoSuggestions?: AeoSuggestions | null;
  onAeoSuggestionsConsumed?: () => void;
}) {
  const [mode, setMode] = useState<GenerateMode>("single");
  const [topic, setTopic] = useState("");
  const [subKeywords, setSubKeywords] = useState("");
  const [region, setRegion] = useState("India");
  const [articleType, setArticleType] = useState("");
  const [customOutline, setCustomOutline] = useState("");
  const [showCustomOutline, setShowCustomOutline] = useState(false);
  const [aeoBanner, setAeoBanner] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [currentStage, setCurrentStage] = useState<Stage | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>("preview");
  const [recentArticles, setRecentArticles] = useState<ArticleListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const abortRef = useRef<AbortController | null>(null);

  // ── Bulk mode state ──
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkCurrentIndex, setBulkCurrentIndex] = useState(-1);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkGeneratingKw, setBulkGeneratingKw] = useState<number | "all" | null>(null);
  const bulkAbortRef = useRef<AbortController | null>(null);
  const bulkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load recent articles on mount and after generation completes
  const loadArticles = useCallback(() => {
    fetch("/api/article?list=true")
      .then((r) => r.json())
      .then((data: ArticleListItem[]) => setRecentArticles(data))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  // Pre-fill from AEO/SRO suggestions
  useEffect(() => {
    if (!aeoSuggestions) return;
    setMode("single");
    setTopic(aeoSuggestions.topic);
    setCustomOutline(aeoSuggestions.customOutline);
    setShowCustomOutline(true);
    setAeoBanner(`Pre-filled from AEO audit of ${aeoSuggestions.fromUrl}`);
    onAeoSuggestionsConsumed?.();
  }, [aeoSuggestions, onAeoSuggestionsConsumed]);

  // View a specific article from the list
  const viewArticle = useCallback((slug: string) => {
    setArticleLoading(true);
    setArticle(null);
    setCurrentStage("done");
    setResult(null);
    setError("");
    setEvents([]);
    fetch(`/api/article?slug=${encodeURIComponent(slug)}&part=all`)
      .then((r) => r.json())
      .then((data: ArticleData) => {
        setArticle(data);
        setResultTab("preview");
      })
      .catch(() => {})
      .finally(() => setArticleLoading(false));
  }, []);

  const startGeneration = useCallback(async () => {
    if (!topic.trim() || generating) return;

    setGenerating(true);
    setCurrentStage("queued");
    setEvents([]);
    setError("");
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), subKeywords, region, articleType: articleType || undefined, customOutline: customOutline.trim() || undefined }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6));
            setEvents((prev) => [...prev, event]);
            setCurrentStage(event.stage);

            if (event.stage === "done" && event.detail) {
              setResult(event.detail);
            }
            if (event.stage === "error") {
              setError(event.message);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setError("Generation cancelled");
      } else {
        setError((err as Error).message);
      }
      setCurrentStage("error");
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [topic, subKeywords, region, articleType, customOutline, generating]);

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── File upload handler ──
  const handleFileUpload = useCallback(async (file: File) => {
    setBulkUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/bulk", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setBulkRows(
        data.rows.map((r: BulkRow, i: number) => ({ ...r, id: i }))
      );
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBulkUploading(false);
    }
  }, []);

  // ── Add a manual row ──
  const addManualRow = useCallback(() => {
    setBulkRows((prev) => [
      ...prev,
      { id: prev.length, topic: "", subKeywords: "", category: "", region: "India" },
    ]);
  }, []);

  // ── Auto-generate sub-keywords via DataForSEO ──
  const generateKeywords = useCallback(async (targetIdx: number | "all") => {
    const targets =
      targetIdx === "all"
        ? bulkRows.filter((r) => r.topic)
        : [bulkRows[targetIdx as number]].filter((r) => r?.topic);
    if (targets.length === 0) return;

    setBulkGeneratingKw(targetIdx);
    try {
      const res = await fetch("/api/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: targets.map((t) => t.topic) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate keywords");

      setBulkRows((prev) =>
        prev.map((row) => {
          const kws = data.keywords?.[row.topic];
          if (kws?.length) {
            return { ...row, subKeywords: kws.join(", ") };
          }
          return row;
        })
      );
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBulkGeneratingKw(null);
    }
  }, [bulkRows]);

  // ── Bulk generation ──
  const startBulkGeneration = useCallback(async () => {
    const validRows = bulkRows.filter((r) => r.topic.trim());
    if (validRows.length === 0 || bulkRunning) return;

    const items: BulkItem[] = validRows.map((r, i) => ({
      ...r,
      id: i,
      stage: "waiting" as const,
      startedAt: null,
      finishedAt: null,
      elapsed: 0,
      wordCount: 0,
      tableCount: 0,
      qualityGrade: "",
      qualityScore: 0,
      error: "",
      articlePath: "",
    }));

    setBulkItems(items);
    setBulkRunning(true);
    setBulkCurrentIndex(0);

    // Live timer — ticks every second to update elapsed time for active item
    const timerInterval = setInterval(() => {
      setBulkItems((prev) =>
        prev.map((item) =>
          item.startedAt && !item.finishedAt
            ? { ...item, elapsed: Math.floor((Date.now() - item.startedAt) / 1000) }
            : item
        )
      );
    }, 1000);
    bulkTimerRef.current = timerInterval;

    const controller = new AbortController();
    bulkAbortRef.current = controller;

    for (let idx = 0; idx < items.length; idx++) {
      if (controller.signal.aborted) break;

      setBulkCurrentIndex(idx);

      // Mark item as starting
      setBulkItems((prev) =>
        prev.map((item, i) =>
          i === idx ? { ...item, stage: "queued", startedAt: Date.now(), elapsed: 0 } : item
        )
      );

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: items[idx].topic, subKeywords: items[idx].subKeywords, region: items[idx].region || region }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event: ProgressEvent = JSON.parse(line.slice(6));

              setBulkItems((prev) =>
                prev.map((item, i) => {
                  if (i !== idx) return item;
                  const updates: Partial<BulkItem> = { stage: event.stage };

                  if (event.stage === "done" && event.detail) {
                    const d = event.detail;
                    updates.finishedAt = Date.now();
                    updates.elapsed = item.startedAt
                      ? Math.floor((Date.now() - item.startedAt) / 1000)
                      : 0;
                    updates.wordCount = (d.wordCount as number) || 0;
                    updates.tableCount = (d.tableCount as number) || 0;
                    updates.qualityGrade = (d.qualityGrade as string) || "";
                    updates.qualityScore = (d.qualityScore as number) || 0;
                    updates.articlePath = (d.articlePath as string) || "";
                  }
                  if (event.stage === "error") {
                    updates.finishedAt = Date.now();
                    updates.elapsed = item.startedAt
                      ? Math.floor((Date.now() - item.startedAt) / 1000)
                      : 0;
                    updates.error = event.message;
                  }

                  return { ...item, ...updates };
                })
              );
            } catch {
              // skip malformed lines
            }
          }
        }

        // If pipeline ended without explicit done/error, mark done
        setBulkItems((prev) =>
          prev.map((item, i) => {
            if (i !== idx) return item;
            if (!item.finishedAt) {
              return {
                ...item,
                stage: "done",
                finishedAt: Date.now(),
                elapsed: item.startedAt ? Math.floor((Date.now() - item.startedAt) / 1000) : 0,
              };
            }
            return item;
          })
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setBulkItems((prev) =>
            prev.map((item, i) => {
              if (i === idx && !item.finishedAt) {
                return {
                  ...item,
                  stage: "error",
                  error: "Cancelled",
                  finishedAt: Date.now(),
                  elapsed: item.startedAt ? Math.floor((Date.now() - item.startedAt) / 1000) : 0,
                };
              }
              return item;
            })
          );
          break;
        }
        setBulkItems((prev) =>
          prev.map((item, i) =>
            i === idx
              ? {
                  ...item,
                  stage: "error",
                  error: (err as Error).message,
                  finishedAt: Date.now(),
                  elapsed: item.startedAt ? Math.floor((Date.now() - item.startedAt) / 1000) : 0,
                }
              : item
          )
        );
      }
    }

    clearInterval(timerInterval);
    bulkTimerRef.current = null;
    setBulkRunning(false);
    setBulkCurrentIndex(-1);
    bulkAbortRef.current = null;
    loadArticles(); // refresh article list
  }, [bulkRows, bulkRunning, region, loadArticles]);

  const cancelBulkGeneration = useCallback(() => {
    bulkAbortRef.current?.abort();
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (bulkTimerRef.current) clearInterval(bulkTimerRef.current);
    };
  }, []);

  // Bulk computed stats
  const bulkDone = bulkItems.filter((i) => i.stage === "done").length;
  const bulkErrors = bulkItems.filter((i) => i.stage === "error").length;
  const bulkTotal = bulkItems.length;
  const bulkAvgTime =
    bulkDone > 0
      ? Math.round(
          bulkItems
            .filter((i) => i.stage === "done" && i.elapsed > 0)
            .reduce((s, i) => s + i.elapsed, 0) / bulkDone
        )
      : 0;
  const bulkEta =
    bulkAvgTime > 0 && bulkTotal > bulkDone + bulkErrors
      ? bulkAvgTime * (bulkTotal - bulkDone - bulkErrors)
      : 0;

  // Fetch full article data when generation completes
  useEffect(() => {
    if (currentStage !== "done" || !result || generating) return;

    // Extract slug from articlePath or from topic
    const articlePath = result.articlePath as string | undefined;
    let slug = "";
    if (articlePath) {
      // "output/scope-of-bca-in-india/article.html" → "scope-of-bca-in-india"
      const parts = articlePath.split("/");
      slug = parts.length >= 2 ? parts[parts.length - 2] : "";
    }
    if (!slug) {
      // Derive from topic
      slug = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
    }
    if (!slug) return;

    setArticleLoading(true);
    fetch(`/api/article?slug=${encodeURIComponent(slug)}&part=all`)
      .then((r) => r.json())
      .then((data: ArticleData) => {
        setArticle(data);
        setResultTab("preview");
      })
      .catch(() => {})
      .finally(() => {
        setArticleLoading(false);
        loadArticles(); // refresh the list
      });
  }, [currentStage, result, generating, topic, loadArticles]);

  const stageIndex = currentStage
    ? STAGES.findIndex((s) => s.id === currentStage)
    : -1;

  return (
    <div className="max-w-4xl space-y-6">
      {/* ── Mode Toggle ── */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-th-bg-secondary w-fit">
        {([
          { id: "single" as const, label: "Single Article" },
          { id: "bulk" as const, label: "Bulk Generate" },
          { id: "news" as const, label: "News Pipeline" },
        ]).map((m) => (
          <button
            key={m.id}
            onClick={() => { if (!generating && !bulkRunning) setMode(m.id); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              mode === m.id
                ? "bg-th-card text-th-accent shadow-sm"
                : "text-th-text-muted hover:text-th-text"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* ── BULK MODE ── */}
      {mode === "bulk" && (
        <>
          {/* Upload / Add topics */}
          <div className="cs-card p-6">
            <h3 className="text-sm font-semibold text-th-text mb-1">Bulk Generate</h3>
            <p className="text-xs text-th-text-muted mb-4">
              Upload your articles.xlsx or add topics manually. Sub-keywords can be auto-generated via DataForSEO.
            </p>

            {/* Upload + Add row buttons */}
            <div className="flex items-center gap-3 mb-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={bulkRunning || bulkUploading}
                className="cs-btn cs-btn-secondary"
              >
                {bulkUploading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                )}
                Upload .xlsx
              </button>
              <button
                onClick={addManualRow}
                disabled={bulkRunning}
                className="cs-btn cs-btn-ghost"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Row
              </button>

              <button
                onClick={() => {
                  const csv = [
                    "topic,sub_keywords,category,region",
                    "Top MBA Colleges in India,best mba colleges india mba fees placement,ranking_list,India",
                    "JEE Main Syllabus 2026,jee main physics syllabus jee maths topics,exam_guide,India",
                    "BCA Scope in India,bca jobs salary bca career options,career_guide,India",
                    "IIT Delhi Fee Structure,iit delhi btech fees hostel charges,fee_reference,India",
                  ].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "bulk_topics_sample.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="cs-btn cs-btn-ghost"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
                </svg>
                Sample CSV
              </button>

              {bulkRows.length > 0 && (
                <button
                  onClick={() => { setBulkRows([]); setBulkItems([]); }}
                  disabled={bulkRunning}
                  className="cs-btn cs-btn-ghost text-th-danger"
                >
                  Clear All
                </button>
              )}
            </div>

            {/* Editable topic table */}
            {bulkRows.length > 0 && !bulkRunning && bulkItems.length === 0 && (
              <div className="border border-th-border rounded-lg overflow-hidden mb-4">
                {/* Header */}
                <div className="grid grid-cols-[2fr_3fr_auto_auto_auto] gap-px bg-th-border text-[11px] font-semibold text-th-text-secondary uppercase tracking-wider">
                  <div className="bg-th-bg-secondary px-3 py-2">Topic</div>
                  <div className="bg-th-bg-secondary px-3 py-2">Sub Keywords</div>
                  <div className="bg-th-bg-secondary px-3 py-2">Category</div>
                  <div className="bg-th-bg-secondary px-3 py-2">Region</div>
                  <div className="bg-th-bg-secondary px-3 py-2 text-center">Actions</div>
                </div>
                {/* Rows */}
                <div className="divide-y divide-th-border max-h-80 overflow-y-auto">
                  {bulkRows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[2fr_3fr_auto_auto_auto] gap-px bg-th-border">
                      <div className="bg-th-card p-1.5">
                        <input
                          value={row.topic}
                          onChange={(e) =>
                            setBulkRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, topic: e.target.value } : r))
                            )
                          }
                          placeholder="Article topic..."
                          className="w-full text-sm bg-transparent border-0 outline-none text-th-text placeholder:text-th-text-muted px-1.5 py-1"
                        />
                      </div>
                      <div className="bg-th-card p-1.5 flex items-center gap-1">
                        <input
                          value={row.subKeywords}
                          onChange={(e) =>
                            setBulkRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, subKeywords: e.target.value } : r))
                            )
                          }
                          placeholder="comma-separated keywords..."
                          className="flex-1 text-sm bg-transparent border-0 outline-none text-th-text placeholder:text-th-text-muted px-1.5 py-1"
                        />
                        {row.topic && (
                          <button
                            onClick={() => generateKeywords(idx)}
                            disabled={bulkGeneratingKw !== null}
                            title="Auto-generate sub-keywords via DataForSEO"
                            className="shrink-0 p-1.5 rounded text-th-accent hover:bg-th-accent-soft transition-colors"
                          >
                            {bulkGeneratingKw === idx ? (
                              <span className="w-4 h-4 block rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="bg-th-card p-1.5">
                        <input
                          value={row.category}
                          onChange={(e) =>
                            setBulkRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, category: e.target.value } : r))
                            )
                          }
                          placeholder="course"
                          className="w-20 text-sm bg-transparent border-0 outline-none text-th-text placeholder:text-th-text-muted px-1.5 py-1"
                        />
                      </div>
                      <div className="bg-th-card p-1.5">
                        <input
                          value={row.region}
                          onChange={(e) =>
                            setBulkRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, region: e.target.value } : r))
                            )
                          }
                          className="w-16 text-sm bg-transparent border-0 outline-none text-th-text placeholder:text-th-text-muted px-1.5 py-1"
                        />
                      </div>
                      <div className="bg-th-card p-1.5 flex items-center justify-center">
                        <button
                          onClick={() => setBulkRows((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1 rounded text-th-text-muted hover:text-th-danger hover:bg-th-danger-soft transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-generate all keywords + Start buttons */}
            {bulkRows.length > 0 && !bulkRunning && bulkItems.length === 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 text-xs text-th-text-muted">
                  {bulkRows.filter((r) => r.topic).length} topic(s)
                  {bulkRows.filter((r) => r.topic && !r.subKeywords).length > 0 && (
                    <span className="text-th-warning ml-1">
                      ({bulkRows.filter((r) => r.topic && !r.subKeywords).length} missing keywords)
                    </span>
                  )}
                </div>

                {bulkRows.some((r) => r.topic && !r.subKeywords) && (
                  <button
                    onClick={() => generateKeywords("all")}
                    disabled={bulkGeneratingKw !== null}
                    className="cs-btn cs-btn-ghost text-th-accent"
                  >
                    {bulkGeneratingKw === "all" ? (
                      <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                    )}
                    Auto-Generate All Keywords
                  </button>
                )}

                <button
                  onClick={startBulkGeneration}
                  disabled={!bulkRows.some((r) => r.topic.trim())}
                  className="cs-btn cs-btn-primary"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m0 0l-6.75-6.75M20.25 12l-6.75 6.75" />
                  </svg>
                  Generate All
                </button>
              </div>
            )}

            {/* Running controls */}
            {bulkRunning && (
              <div className="flex items-center gap-3">
                <button onClick={cancelBulkGeneration} className="cs-btn cs-btn-secondary text-th-danger">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                  </svg>
                  Stop
                </button>
              </div>
            )}
          </div>

          {/* Bulk tracker */}
          {bulkItems.length > 0 && (
            <div className="cs-card p-6">
              {/* Overall progress bar */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-th-text">
                    Progress: {bulkDone + bulkErrors} of {bulkTotal}
                    {bulkErrors > 0 && <span className="text-th-danger ml-1">({bulkErrors} failed)</span>}
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-th-text-muted">
                    {bulkAvgTime > 0 && <span>~{bulkAvgTime}s/article</span>}
                    {bulkEta > 0 && bulkRunning && (
                      <span>
                        ETA: {bulkEta >= 60 ? `${Math.floor(bulkEta / 60)}m ${bulkEta % 60}s` : `${bulkEta}s`}
                      </span>
                    )}
                    {!bulkRunning && bulkDone + bulkErrors === bulkTotal && (
                      <span className="text-th-success font-medium">Complete</span>
                    )}
                  </div>
                </div>
                <div className="w-full h-2.5 bg-th-bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-th-accent rounded-full transition-all duration-500"
                    style={{ width: `${bulkTotal > 0 ? ((bulkDone + bulkErrors) / bulkTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Item tracker rows */}
              <div className="space-y-2">
                {bulkItems.map((item, idx) => {
                  const isActive = item.startedAt !== null && !item.finishedAt;
                  const isDone = item.stage === "done";
                  const isError = item.stage === "error";
                  const isWaiting = item.stage === "waiting";

                  const stageLabel = isWaiting
                    ? "Waiting"
                    : STAGES.find((s) => s.id === item.stage)?.label || (isError ? "Error" : item.stage);

                  const stageIdx = STAGES.findIndex((s) => s.id === item.stage);
                  const stagePercent = isDone
                    ? 100
                    : isError || isWaiting
                    ? 0
                    : Math.max(5, ((stageIdx + 0.5) / STAGES.length) * 100);

                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-lg border transition-all ${
                        isActive
                          ? "border-th-accent bg-th-accent-soft"
                          : isDone
                          ? "border-th-success/30 bg-th-success-soft"
                          : isError
                          ? "border-th-danger/30 bg-th-danger-soft"
                          : "border-th-border bg-th-bg-secondary"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Number */}
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isDone
                              ? "bg-th-success text-white"
                              : isError
                              ? "bg-th-danger text-white"
                              : isActive
                              ? "bg-th-accent text-white"
                              : "bg-th-bg-secondary text-th-text-muted border border-th-border"
                          }`}
                        >
                          {isDone ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          ) : isError ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          ) : (
                            idx + 1
                          )}
                        </div>

                        {/* Topic + sub-keywords + stage */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-th-text truncate">{item.topic}</p>
                          {item.subKeywords && (
                            <p className="text-[11px] text-th-text-muted truncate mt-0.5" title={item.subKeywords}>
                              {item.subKeywords}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                isDone
                                  ? "bg-th-success/20 text-th-success"
                                  : isError
                                  ? "bg-th-danger/20 text-th-danger"
                                  : isActive
                                  ? "bg-th-accent/20 text-th-accent"
                                  : "bg-th-bg-secondary text-th-text-muted"
                              }`}
                            >
                              {isActive && (
                                <span className="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin mr-1 align-middle" />
                              )}
                              {stageLabel}
                            </span>

                            {isActive && (
                              <div className="w-20 h-1.5 bg-th-bg-secondary rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-th-accent rounded-full transition-all duration-700"
                                  style={{ width: `${stagePercent}%` }}
                                />
                              </div>
                            )}

                            {isError && item.error && (
                              <span className="text-[11px] text-th-danger truncate max-w-[200px]">{item.error}</span>
                            )}
                          </div>
                        </div>

                        {/* Timer */}
                        <div className="text-right shrink-0 min-w-[60px]">
                          {(isActive || isDone || isError) && (
                            <p className={`text-sm font-mono font-semibold tabular-nums ${
                              isActive ? "text-th-accent" : isDone ? "text-th-success" : "text-th-danger"
                            }`}>
                              {item.elapsed >= 60
                                ? `${Math.floor(item.elapsed / 60)}:${String(item.elapsed % 60).padStart(2, "0")}`
                                : `${item.elapsed}s`}
                            </p>
                          )}
                          {isWaiting && (
                            <p className="text-xs text-th-text-muted">—</p>
                          )}
                        </div>

                        {/* Results (when done) */}
                        {isDone && item.wordCount > 0 && (
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-th-text-muted">{item.wordCount.toLocaleString()} words</span>
                            {item.qualityGrade && (
                              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                item.qualityGrade.startsWith("A") ? "bg-th-success text-white"
                                  : item.qualityGrade.startsWith("B") ? "bg-th-accent text-white"
                                  : "bg-th-warning text-white"
                              }`}>
                                {item.qualityGrade}
                              </span>
                            )}
                            <button
                              onClick={() => {
                                if (!item.articlePath) return;
                                const parts = item.articlePath.split("/");
                                const slug = parts.length >= 2 ? parts[parts.length - 2] : "";
                                if (slug) {
                                  setMode("single");
                                  viewArticle(slug);
                                }
                              }}
                              className="text-xs text-th-accent hover:underline"
                            >
                              View
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Summary when complete */}
              {!bulkRunning && bulkDone + bulkErrors === bulkTotal && bulkTotal > 0 && (
                <div className="mt-4 p-4 rounded-lg bg-th-success-soft">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-5 h-5 text-th-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-semibold text-th-success">Bulk Generation Complete</span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-center text-sm">
                    <div>
                      <p className="text-th-text-muted text-xs">Completed</p>
                      <p className="text-lg font-bold text-th-text">{bulkDone}</p>
                    </div>
                    <div>
                      <p className="text-th-text-muted text-xs">Failed</p>
                      <p className="text-lg font-bold text-th-text">{bulkErrors}</p>
                    </div>
                    <div>
                      <p className="text-th-text-muted text-xs">Total Words</p>
                      <p className="text-lg font-bold text-th-text">
                        {bulkItems.reduce((s, i) => s + i.wordCount, 0).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-th-text-muted text-xs">Total Time</p>
                      <p className="text-lg font-bold text-th-text">
                        {(() => {
                          const totalSec = bulkItems.reduce((s, i) => s + i.elapsed, 0);
                          return totalSec >= 60 ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s` : `${totalSec}s`;
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* New batch button */}
              {!bulkRunning && bulkItems.length > 0 && (
                <button
                  onClick={() => { setBulkItems([]); setBulkRows([]); }}
                  className="mt-3 cs-btn cs-btn-ghost w-full"
                >
                  New Batch
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── NEWS MODE ── */}
      {mode === "news" && <NewsPipeline
        onView={(slug) => { setMode("single"); viewArticle(slug); }}
        onRefreshArticles={loadArticles}
      />}

      {/* ── SINGLE MODE ── */}
      {mode === "single" && (
      <>
      {/* ── AEO Pre-fill Banner ── */}
      {aeoBanner && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
          <span>⚡ {aeoBanner}</span>
          <button onClick={() => setAeoBanner(null)} className="text-yellow-400/60 hover:text-yellow-400">✕</button>
        </div>
      )}
      {/* ── Topic Input Card ── */}
      <div className="cs-card p-6">
        <h3 className="text-sm font-semibold text-th-text mb-4">Generate Article</h3>

        <div className="space-y-4">
          {/* Topic */}
          <div>
            <label className="block text-xs font-medium text-th-text-secondary mb-1.5">
              Topic <span className="text-th-danger">*</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Top MBA Colleges in India 2026"
              className="cs-input"
              disabled={generating}
              onKeyDown={(e) => e.key === "Enter" && startGeneration()}
            />
          </div>

          {/* Sub-keywords + Region row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-th-text-secondary mb-1.5">
                Sub-Keywords <span className="text-th-text-muted">(optional)</span>
              </label>
              <input
                type="text"
                value={subKeywords}
                onChange={(e) => setSubKeywords(e.target.value)}
                placeholder="fees, placements, admission"
                className="cs-input"
                disabled={generating}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-th-text-secondary mb-1.5">
                Region
              </label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="cs-input"
                disabled={generating}
              />
            </div>
          </div>

          {/* Article Type */}
          <div>
            <label className="block text-xs font-medium text-th-text-secondary mb-1.5">
              Article Type <span className="text-th-text-muted">(optional — auto-detected if blank)</span>
            </label>
            <select
              value={articleType}
              onChange={(e) => setArticleType(e.target.value)}
              className="cs-input"
              disabled={generating}
            >
              <option value="">Auto-detect</option>
              <option value="college_profile">College Profile</option>
              <option value="ranking_list">Ranking List</option>
              <option value="fee_reference">Fee Reference</option>
              <option value="exam_guide">Exam Guide</option>
              <option value="career_guide">Career Guide</option>
              <option value="comparison">Comparison</option>
              <option value="cutoff_data">Cutoff Data</option>
              <option value="informational">Informational</option>
            </select>
          </div>

          {/* Custom Outline toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowCustomOutline((v) => !v)}
              disabled={generating}
              className="flex items-center gap-1.5 text-xs font-medium text-th-text-secondary hover:text-th-text transition-colors"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${showCustomOutline ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Custom Outline <span className="text-th-text-muted font-normal">(paste your section headings to override AI outline)</span>
            </button>
            {showCustomOutline && (
              <textarea
                value={customOutline}
                onChange={(e) => setCustomOutline(e.target.value)}
                placeholder={"Introduction\nEligibility Criteria\nTop Colleges with Fees Table\nPlacement Statistics\nFAQ"}
                className="cs-input mt-2 font-mono text-xs resize-y"
                rows={6}
                disabled={generating}
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            {!generating ? (
              <button
                onClick={startGeneration}
                disabled={!topic.trim()}
                className="cs-btn cs-btn-primary"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                Generate Article
              </button>
            ) : (
              <button onClick={cancelGeneration} className="cs-btn cs-btn-secondary text-th-danger">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
            )}
            {!generating && result && (
              <button
                onClick={() => {
                  setTopic("");
                  setSubKeywords("");
                  setArticleType("");
                  setCustomOutline("");
                  setShowCustomOutline(false);
                  setCurrentStage(null);
                  setEvents([]);
                  setResult(null);
                  setError("");
                  setArticle(null);
                }}
                className="cs-btn cs-btn-ghost"
              >
                New Article
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Pipeline Progress ── */}
      {currentStage && (
        <div className="cs-card p-6">
          <h3 className="text-sm font-semibold text-th-text mb-5">Pipeline Progress</h3>

          {/* Stage indicators */}
          <div className="flex items-center gap-1 mb-6">
            {STAGES.map((stage, i) => {
              const isActive = stage.id === currentStage;
              const isComplete = stageIndex > i;
              const isError = currentStage === "error";

              let dotColor = "bg-th-border";
              if (isError && isActive) dotColor = "bg-th-danger";
              else if (isComplete) dotColor = "bg-th-success";
              else if (isActive) dotColor = "bg-th-accent";

              let barColor = "bg-th-border";
              if (isComplete) barColor = "bg-th-success";
              else if (isActive) barColor = "bg-th-accent";

              return (
                <div key={stage.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                        isComplete
                          ? "bg-th-success text-white"
                          : isActive
                          ? isError
                            ? "bg-th-danger text-white"
                            : "bg-th-accent text-white"
                          : "bg-th-bg-secondary text-th-text-muted"
                      } ${isActive && !isError ? "ring-2 ring-th-accent ring-offset-2 ring-offset-th-card" : ""}`}
                    >
                      {isComplete ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : isError && isActive ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      ) : (
                        <span>{i + 1}</span>
                      )}
                    </div>
                    <span
                      className={`text-[10px] mt-1.5 font-medium ${
                        isActive ? (isError ? "text-th-danger" : "text-th-accent") : isComplete ? "text-th-success" : "text-th-text-muted"
                      }`}
                    >
                      {stage.label}
                    </span>
                  </div>
                  {/* Connector bar */}
                  {i < STAGES.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 rounded transition-all ${barColor}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Active stage spinner */}
          {generating && currentStage !== "done" && currentStage !== "error" && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-th-accent-soft mb-4">
              <div className="w-5 h-5 rounded-full border-2 border-th-accent border-t-transparent animate-spin shrink-0" />
              <span className="text-sm text-th-accent font-medium">
                {STAGES.find((s) => s.id === currentStage)?.label || "Processing"}...
              </span>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-th-danger-soft mb-4">
              <svg className="w-5 h-5 text-th-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span className="text-sm text-th-danger">{error}</span>
            </div>
          )}

          {/* Result summary */}
          {result && (
            <div className="p-4 rounded-lg bg-th-success-soft mb-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-th-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-semibold text-th-success">Article Generated</span>
              </div>
              <div className="grid grid-cols-4 gap-4 text-center">
                {[
                  { label: "Words", value: result.wordCount || "—" },
                  { label: "Tables", value: result.tableCount || "—" },
                  { label: "API Calls", value: result.apiCalls || "—" },
                  { label: "Quality", value: result.qualityScore ? `${result.qualityScore}/100` : result.qualityGrade || "—" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-xs text-th-text-muted">{s.label}</p>
                    <p className="text-lg font-bold text-th-text">{String(s.value)}</p>
                  </div>
                ))}
              </div>
              {result.time != null && (
                <p className="text-xs text-th-text-muted mt-3 text-center">
                  Completed in {Number(result.time).toFixed(0)}s
                </p>
              )}
            </div>
          )}

          {/* Event log */}
          <div>
            <button
              onClick={() => {
                const el = document.getElementById("event-log");
                if (el) el.classList.toggle("hidden");
              }}
              className="text-xs text-th-text-muted hover:text-th-text transition-colors flex items-center gap-1.5 mb-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              Event Log ({events.length})
            </button>
            <div id="event-log" className="hidden max-h-48 overflow-y-auto rounded-lg bg-th-bg-secondary p-3 space-y-1">
              {events.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <StageBadge stage={e.stage} />
                  <span className="text-th-text-secondary flex-1">{e.message}</span>
                  <span className="text-th-text-muted shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
              {events.length === 0 && (
                <p className="text-xs text-th-text-muted">Waiting for events...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Article Result View ── */}
      {article && !generating && (
        <div className="cs-card overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-th-border">
            {([
              { id: "preview", label: "Article Preview" },
              { id: "quality", label: "Quality Report" },
              { id: "sections", label: "Sections" },
              { id: "outline", label: "Outline" },
            ] as { id: ResultTab; label: string }[]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setResultTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  resultTab === tab.id
                    ? "border-th-accent text-th-accent"
                    : "border-transparent text-th-text-muted hover:text-th-text"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {articleLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
                <span className="ml-3 text-sm text-th-text-muted">Loading article...</span>
              </div>
            ) : (
              <>
                {resultTab === "preview" && <ArticlePreview html={article.html} meta={article.meta} slug={article.slug} />}
                {resultTab === "quality" && <QualityReport meta={article.meta} />}
                {resultTab === "sections" && <SectionsView meta={article.meta} />}
                {resultTab === "outline" && <OutlineView outline={article.outline} />}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Quick tips (shown when no article is being viewed) ── */}
      {!currentStage && !article && (
        <div className="cs-card p-6">
          <h3 className="text-sm font-semibold text-th-text mb-3">How it works</h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { step: "1", title: "Enter Topic", desc: "Type any article topic. The AI auto-detects the content type and intent." },
              { step: "2", title: "Pipeline Runs", desc: "Classify, research, outline, write sections, post-process — all automated." },
              { step: "3", title: "Get Article", desc: "Full HTML article with quality score, tables, and research data." },
            ].map((t) => (
              <div key={t.step} className="text-center p-4">
                <div className="w-8 h-8 rounded-full bg-th-accent-soft text-th-accent text-sm font-bold flex items-center justify-center mx-auto mb-2">
                  {t.step}
                </div>
                <p className="text-sm font-medium text-th-text mb-1">{t.title}</p>
                <p className="text-xs text-th-text-muted">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Article Library ── */}
      {!generating && <ArticleLibrary
        articles={recentArticles}
        loading={loadingList}
        activeSlug={article?.slug}
        onView={(slug) => viewArticle(slug)}
        onBack={() => { setArticle(null); setCurrentStage(null); setResult(null); }}
        showBack={!!article}
      />}
      </>
      )}
    </div>
  );
}

/* ── Chart colors ── */
const CHART_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#f59e0b", "#ef4444", "#ec4899", "#10b981", "#f97316", "#6366f1", "#06b6d4"];

/* ── Generate SVG bar chart from table data ── */
function generateBarChart(headers: string[], rows: string[][], tableIndex: number, usedColTypes: Set<string>): string {
  // Find a numeric column — ranked by preference so the most meaningful column wins
  const COL_KEYWORDS: [string, string][] = [
    ["salary", "salary"], ["package", "package"], ["lpa", "lpa"], ["ctc", "ctc"],
    ["fee", "fee"], ["cost", "cost"],
    ["rank", "rank"], ["nirf", "rank"], ["score", "score"], ["percentile", "score"],
    ["seats", "seats"], ["intake", "seats"], ["count", "count"],
  ];
  let numCol = -1;
  let colType = "";
  let labelCol = 0;
  for (const [kw, type] of COL_KEYWORDS) {
    for (let c = 1; c < headers.length; c++) {
      if (headers[c].toLowerCase().includes(kw)) {
        numCol = c; colType = type; break;
      }
    }
    if (numCol !== -1) break;
  }
  // Skip if no numeric column found, or this column type already has a chart
  if (numCol === -1 || usedColTypes.has(colType)) return "";
  usedColTypes.add(colType);

  // Extract numeric values — parse ranges like "₹3.5-5 LPA" → take midpoint
  const data: { label: string; value: number; raw: string }[] = [];
  for (const row of rows.slice(0, 10)) {
    const label = row[labelCol]?.replace(/<[^>]*>/g, "").trim().slice(0, 25) || "";
    const rawVal = row[numCol]?.replace(/<[^>]*>/g, "").trim() || "";
    // Extract numbers
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

    // Label
    svg += `<text x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="11" fill="var(--text-secondary)" font-family="system-ui">${d.label}</text>`;
    // Bar
    svg += `<rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.85"/>`;
    // Value
    svg += `<text x="${labelW + barW + 8}" y="${y + barH / 2 + 4}" font-size="11" fill="var(--text)" font-weight="600" font-family="system-ui">${d.raw}</text>`;
  });

  svg += `</svg></div>`;
  return svg;
}

/* ── Parse HTML table into headers + rows ── */
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

/* ── Render <cs-chart>JSON</cs-chart> blocks as SVG bar charts ── */
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

/* ── Clean article HTML ── */
function cleanArticleHtml(html: string): string {
  let cleaned = html
    .replace(/cellspacing="[^"]*"/gi, "")
    .replace(/cellpadding="[^"]*"/gi, "")
    .replace(/border="[^"]*"/gi, "")
    .replace(/<table[^>]*style="[^"]*"[^>]*>/gi, "<table>")
    .replace(/<table[^>]*>/gi, "<table>")
    .replace(/<p>\s*,\s*/gi, "<p>");

  cleaned = renderInsightCharts(cleaned);
  return cleaned;
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
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setEditedHtml(html || ""); }, [html]);

  if (!html) return <p className="text-sm text-th-text-muted">No article HTML available.</p>;

  // Sync contentEditable → state
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
      const data = await res.json();
      if (data.url) setCoverImageUrl(data.url);
      else alert(data.error || "Failed to generate image");
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

  // Toolbar command
  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    syncFromEditor();
  };

  const q = meta?.quality;

  return (
    <div className="space-y-5">
      {/* Header */}
      {meta && (
        <div className="pb-4 border-b border-th-border">
          <h3 className="text-lg font-semibold text-th-text">{meta.title}</h3>
          <div className="flex items-center gap-3 mt-2 text-xs text-th-text-muted flex-wrap">
            <span className="cs-badge bg-th-accent-soft text-th-accent">{meta.content_type.replace("_", " ")}</span>
            <span>{meta.word_count.toLocaleString()} words</span>
            <span>{meta.table_count} tables</span>
            <span>{meta.section_count} sections</span>
            {meta.generation_time > 0 && <span>{Math.round(meta.generation_time)}s</span>}
          </div>
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
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 bg-th-bg-secondary border-b border-th-border flex-wrap">
          {/* Mode toggles */}
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

          {/* Formatting (only in visual edit mode) */}
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

          {/* Save/Cancel (right side) */}
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

        {/* Content area */}
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
      {/* Overall score */}
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

      {/* Metrics grid */}
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

      {/* Quality issues */}
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

      {/* Post-processing */}
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
      {/* Summary bar */}
      <div className="flex items-center gap-6 text-sm">
        <span className="text-th-text-muted">{meta.sections.length} sections</span>
        <span className="text-th-text-muted">{(totalChars / 1000).toFixed(1)}k chars total</span>
        <span className="text-th-text-muted">{avgLatency.toFixed(1)}s avg latency</span>
      </div>

      {/* Section table */}
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

      {/* Char distribution bar */}
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
      {/* Topic + type */}
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

      {/* Sections */}
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

      {/* User persona */}
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

/* ── News Pipeline Component ── */
interface NewsSource {
  id: string; name: string; url: string; source_type: string; category: string; enabled: number;
}
interface NewsItem {
  id: string; title: string; url: string; source: string; tags: string; published: string; status: string;
}
interface NewsRun {
  id: string; status: string; items_found: number; started_at: string; completed_at: string | null;
}
interface FeedSuggestion {
  name: string; url: string;
}
interface SuggestionCategory {
  category: string; icon: string; feeds: FeedSuggestion[];
}

function NewsPipeline({ onView, onRefreshArticles }: { onView: (slug: string) => void; onRefreshArticles: () => void }) {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [runs, setRuns] = useState<NewsRun[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [newsSearch, setNewsSearch] = useState("");

  // News generation state
  const [newsGenerating, setNewsGenerating] = useState(false);
  const [newsGenTopic, setNewsGenTopic] = useState("");
  const [newsGenStage, setNewsGenStage] = useState<Stage | null>(null);
  const [newsGenEvents, setNewsGenEvents] = useState<ProgressEvent[]>([]);
  const [newsGenResult, setNewsGenResult] = useState<Record<string, unknown> | null>(null);
  const [newsGenError, setNewsGenError] = useState("");
  const [newsGenStartTime, setNewsGenStartTime] = useState(0);
  const [newsGenElapsed, setNewsGenElapsed] = useState(0);
  const newsAbortRef = useRef<AbortController | null>(null);
  const newsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // News generation timer
  useEffect(() => {
    if (newsGenerating && newsGenStartTime > 0) {
      newsTimerRef.current = setInterval(() => {
        setNewsGenElapsed(Math.floor((Date.now() - newsGenStartTime) / 1000));
      }, 1000);
      return () => { if (newsTimerRef.current) clearInterval(newsTimerRef.current); };
    }
    if (newsTimerRef.current) clearInterval(newsTimerRef.current);
  }, [newsGenerating, newsGenStartTime]);

  // Generate news article
  const generateNews = useCallback(async (title: string, competitorUrl?: string) => {
    if (newsGenerating) return;
    setNewsGenerating(true);
    setNewsGenTopic(title);
    setNewsGenStage("queued");
    setNewsGenEvents([]);
    setNewsGenResult(null);
    setNewsGenError("");
    setNewsGenStartTime(Date.now());
    setNewsGenElapsed(0);

    const controller = new AbortController();
    newsAbortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: title, type: "news", competitorUrl }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6));
            setNewsGenEvents((prev) => [...prev, event]);
            setNewsGenStage(event.stage);
            if (event.stage === "done" && event.detail) setNewsGenResult(event.detail);
            if (event.stage === "error") setNewsGenError(event.message);
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setNewsGenError("Cancelled");
      } else {
        setNewsGenError((err as Error).message);
      }
      setNewsGenStage("error");
    } finally {
      setNewsGenerating(false);
      newsAbortRef.current = null;
      onRefreshArticles();
    }
  }, [newsGenerating, onRefreshArticles]);

  // Load data on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/news?view=sources").then((r) => r.json()),
      fetch("/api/news?view=discovered").then((r) => r.json()),
      fetch("/api/news?view=runs").then((r) => r.json()),
    ]).then(([s, d, r]) => {
      setSources(s.sources || []);
      setItems(d.items || []);
      setRuns(r.runs || []);
    }).finally(() => setLoading(false));
  }, []);

  // Load suggestions on demand
  const loadSuggestions = useCallback(() => {
    if (suggestions.length > 0) { setShowSuggestions((v) => !v); return; }
    fetch("/api/news?view=suggestions").then((r) => r.json()).then((d) => {
      setSuggestions(d.suggestions || []);
      setShowSuggestions(true);
    });
  }, [suggestions.length]);

  // Discover news
  const runDiscovery = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discover" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discovery failed");

      // Refresh items and runs
      const [d, r] = await Promise.all([
        fetch("/api/news?view=discovered").then((r) => r.json()),
        fetch("/api/news?view=runs").then((r) => r.json()),
      ]);
      setItems(d.items || []);
      setRuns(r.runs || []);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDiscovering(false);
    }
  }, []);

  // Add custom topic feed
  const addCustomTopic = useCallback(async () => {
    if (!customTopic.trim()) return;
    setAddingTopic(true);
    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-custom-feed", topic: customTopic.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Refresh sources
      const s = await fetch("/api/news?view=sources").then((r) => r.json());
      setSources(s.sources || []);
      setCustomTopic("");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAddingTopic(false);
    }
  }, [customTopic]);

  // Add suggested feed
  const addSuggested = useCallback(async (name: string, url: string) => {
    const res = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add-source", name, url, category: "Suggested" }),
    });
    if (res.ok) {
      const s = await fetch("/api/news?view=sources").then((r) => r.json());
      setSources(s.sources || []);
    }
  }, []);

  // Toggle source
  const toggleSource = useCallback(async (id: string, enabled: boolean) => {
    await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle-source", id, enabled }),
    });
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, enabled: enabled ? 1 : 0 } : s));
  }, []);

  // Delete source
  const deleteSource = useCallback(async (id: string) => {
    await fetch(`/api/news?id=${id}`, { method: "DELETE" });
    setSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Toggle select item
  const toggleItem = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Filter items
  const q = newsSearch.toLowerCase();
  const filteredItems = items.filter((item) => {
    if (q) {
      const hay = `${item.title} ${item.source} ${item.tags}`.toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    }
    return true;
  });

  const enabledCount = sources.filter((s) => s.enabled).length;
  const lastRun = runs[0];
  const sourcesByCategory = sources.reduce<Record<string, NewsSource[]>>((acc, s) => {
    const cat = s.category || "Other";
    (acc[cat] = acc[cat] || []).push(s);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="cs-card p-8 flex items-center justify-center gap-2">
        <div className="w-5 h-5 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
        <span className="text-sm text-th-text-muted">Loading news pipeline...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header + Watch Topic ── */}
      <div className="cs-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-th-text">News Pipeline</h3>
            <p className="text-xs text-th-text-muted mt-0.5">
              {enabledCount} source{enabledCount !== 1 ? "s" : ""} active
              {lastRun && lastRun.status === "done" && (
                <span> · Last run found {lastRun.items_found} items</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSources((v) => !v)}
              className={`cs-btn cs-btn-ghost text-xs ${showSources ? "bg-th-bg-secondary" : ""}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93s.844.117 1.185-.135l.714-.536a1.143 1.143 0 011.484.098l.773.773a1.143 1.143 0 01.098 1.484l-.536.714c-.252.34-.303.789-.135 1.185s.506.71.93.78l.894.15c.542.09.94.56.94 1.109v1.094c0 .55-.398 1.02-.94 1.11l-.894.149c-.424.07-.764.384-.93.78s-.117.844.135 1.185l.536.714a1.143 1.143 0 01-.098 1.484l-.773.773a1.143 1.143 0 01-1.484.098l-.714-.536c-.34-.252-.789-.303-1.185-.135s-.71.506-.78.93l-.15.894c-.09.542-.56.94-1.109.94h-1.094c-.55 0-1.02-.398-1.11-.94l-.149-.894c-.07-.424-.384-.764-.78-.93s-.844-.117-1.185.135l-.714.536a1.143 1.143 0 01-1.484-.098l-.773-.773a1.143 1.143 0 01-.098-1.484l.536-.714c.252-.34.303-.789.135-1.185s-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.764-.384.93-.78s.117-.844-.135-1.185l-.536-.714a1.143 1.143 0 01.098-1.484l.773-.773a1.143 1.143 0 011.484-.098l.714.536c.34.252.789.303 1.185.135s.71-.506.78-.93l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Sources ({enabledCount})
            </button>
            <button onClick={loadSuggestions} className="cs-btn cs-btn-ghost text-xs">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Sources
            </button>
          </div>
        </div>

        {/* Watch any topic — creates a Google News RSS */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomTopic()}
              placeholder="Watch any topic... (e.g. NEET 2026 cutoff, IIT placement, SSC CGL)"
              className="w-full py-2.5 pl-4 pr-4 bg-th-bg-secondary border border-th-border rounded-lg text-sm text-th-text placeholder:text-th-text-muted outline-none focus:border-th-accent focus:ring-2 focus:ring-th-accent/20 transition-all"
            />
          </div>
          <button
            onClick={addCustomTopic}
            disabled={!customTopic.trim() || addingTopic}
            className="cs-btn cs-btn-secondary shrink-0"
          >
            {addingTopic ? (
              <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
            ) : (
              "Watch"
            )}
          </button>
          <button
            onClick={runDiscovery}
            disabled={discovering}
            className="cs-btn cs-btn-primary shrink-0"
          >
            {discovering ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Discovering...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                Discover News
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── News Generation Progress ── */}
      {(newsGenerating || newsGenStage) && (
        <div className="cs-card p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-semibold text-th-text">
                {newsGenerating ? "Generating News Article" : newsGenStage === "done" ? "News Article Ready" : "Generation Failed"}
              </h4>
              <p className="text-xs text-th-text-muted mt-0.5 truncate max-w-md">{newsGenTopic}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Timer */}
              <span className={`text-sm font-mono font-semibold tabular-nums ${
                newsGenerating ? "text-th-accent" : newsGenStage === "done" ? "text-th-success" : "text-th-danger"
              }`}>
                {newsGenElapsed >= 60
                  ? `${Math.floor(newsGenElapsed / 60)}:${String(newsGenElapsed % 60).padStart(2, "0")}`
                  : `${newsGenElapsed}s`}
              </span>
              {newsGenerating && (
                <button onClick={() => newsAbortRef.current?.abort()} className="cs-btn cs-btn-ghost text-th-danger text-xs">
                  Cancel
                </button>
              )}
              {!newsGenerating && newsGenStage && (
                <button onClick={() => { setNewsGenStage(null); setNewsGenEvents([]); setNewsGenResult(null); setNewsGenError(""); }}
                  className="cs-btn cs-btn-ghost text-xs">
                  Dismiss
                </button>
              )}
            </div>
          </div>

          {/* Stage progress */}
          <div className="flex items-center gap-1 mb-3">
            {STAGES.map((stage, i) => {
              const stageIdx = newsGenStage ? STAGES.findIndex((s) => s.id === newsGenStage) : -1;
              const isActive = stage.id === newsGenStage;
              const isComplete = stageIdx > i;
              const isError = newsGenStage === "error";
              return (
                <div key={stage.id} className="flex items-center flex-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                    isComplete ? "bg-th-success text-white"
                      : isActive ? (isError ? "bg-th-danger text-white" : "bg-th-accent text-white")
                      : "bg-th-bg-secondary text-th-text-muted"
                  } ${isActive && !isError ? "ring-2 ring-th-accent ring-offset-1 ring-offset-th-card" : ""}`}>
                    {isComplete ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (i + 1)}
                  </div>
                  {i < STAGES.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-0.5 rounded ${isComplete ? "bg-th-success" : isActive ? "bg-th-accent" : "bg-th-border"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Active status */}
          {newsGenerating && newsGenStage && newsGenStage !== "done" && newsGenStage !== "error" && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-th-accent-soft text-sm text-th-accent font-medium mb-2">
              <span className="w-4 h-4 rounded-full border-2 border-th-accent border-t-transparent animate-spin shrink-0" />
              {STAGES.find((s) => s.id === newsGenStage)?.label || "Processing"}...
              {newsGenEvents.length > 0 && (
                <span className="text-xs font-normal ml-auto text-th-accent/70">
                  {newsGenEvents[newsGenEvents.length - 1].message.slice(0, 60)}
                </span>
              )}
            </div>
          )}

          {/* Error */}
          {newsGenError && (
            <div className="p-2.5 rounded-lg bg-th-danger-soft text-sm text-th-danger mb-2">{newsGenError}</div>
          )}

          {/* Result */}
          {newsGenResult && !newsGenerating && (
            <div className="p-3 rounded-lg bg-th-success-soft">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-th-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-semibold text-th-success">News Article Generated</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-th-text-muted">
                {newsGenResult.wordCount != null && <span>{String(newsGenResult.wordCount)} words</span>}
                {newsGenResult.time != null && <span>{Number(newsGenResult.time).toFixed(0)}s</span>}
                <span className="px-1.5 py-0.5 rounded bg-th-accent/10 text-th-accent font-medium">News</span>
              </div>
              {/* View article button */}
              {typeof newsGenResult.articlePath === "string" && (
                <button
                  onClick={() => {
                    const p = String(newsGenResult!.articlePath);
                    const parts = p.split("/");
                    const slug = parts.length >= 2 ? parts[parts.length - 2] : "";
                    if (slug) onView(slug);
                  }}
                  className="mt-2 cs-btn cs-btn-primary text-xs"
                >
                  View Article
                </button>
              )}
            </div>
          )}

          {/* Event log (collapsed) */}
          {newsGenEvents.length > 0 && (
            <details className="mt-2">
              <summary className="text-[11px] text-th-text-muted cursor-pointer hover:text-th-text">
                Event Log ({newsGenEvents.length})
              </summary>
              <div className="mt-1 max-h-32 overflow-y-auto rounded bg-th-bg-secondary p-2 space-y-0.5">
                {newsGenEvents.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <StageBadge stage={e.stage} />
                    <span className="text-th-text-secondary flex-1">{e.message}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Sources Panel (collapsible) ── */}
      {showSources && (
        <div className="cs-card p-6">
          <h4 className="text-sm font-semibold text-th-text mb-3">
            Watched Sources ({sources.length})
          </h4>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {Object.entries(sourcesByCategory).map(([cat, catSources]) => (
              <div key={cat}>
                <p className="text-[11px] font-semibold text-th-text-muted uppercase tracking-wider mb-1.5">{cat}</p>
                <div className="space-y-1">
                  {catSources.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 py-1 group">
                      <button
                        onClick={() => toggleSource(s.id, !s.enabled)}
                        className={`w-8 h-5 rounded-full transition-colors relative shrink-0 ${
                          s.enabled ? "bg-th-accent" : "bg-th-border"
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          s.enabled ? "left-3.5" : "left-0.5"
                        }`} />
                      </button>
                      <span className={`text-sm flex-1 truncate ${s.enabled ? "text-th-text" : "text-th-text-muted"}`}>
                        {s.name}
                      </span>
                      <button
                        onClick={() => deleteSource(s.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-th-text-muted hover:text-th-danger transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Suggested Sources (collapsible) ── */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="cs-card p-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-th-text">Suggested Sources</h4>
            <button onClick={() => setShowSuggestions(false)} className="text-xs text-th-text-muted hover:text-th-text">
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {suggestions.map((cat) => {
              const existingUrls = new Set(sources.map((s) => s.url));
              return (
                <div key={cat.category}>
                  <p className="text-[11px] font-semibold text-th-text-muted uppercase tracking-wider mb-2">{cat.category}</p>
                  <div className="space-y-1.5">
                    {cat.feeds.map((f) => {
                      const alreadyAdded = existingUrls.has(f.url);
                      return (
                        <div key={f.url} className="flex items-center gap-2">
                          <span className="text-sm text-th-text flex-1 truncate">{f.name}</span>
                          {alreadyAdded ? (
                            <span className="text-[10px] text-th-success font-medium px-2 py-0.5 rounded-full bg-th-success/10">Added</span>
                          ) : (
                            <button
                              onClick={() => addSuggested(f.name, f.url)}
                              className="text-[10px] text-th-accent font-medium px-2 py-0.5 rounded-full bg-th-accent/10 hover:bg-th-accent/20 transition-colors"
                            >
                              + Add
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Recent Runs ── */}
      {runs.length > 0 && (
        <div className="flex items-center gap-3 px-1">
          <span className="text-[11px] font-semibold text-th-text-muted uppercase tracking-wider">Recent runs:</span>
          <div className="flex items-center gap-2 overflow-x-auto">
            {runs.slice(0, 5).map((run) => (
              <span
                key={run.id}
                className={`text-[11px] px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${
                  run.status === "done"
                    ? "bg-th-success/10 text-th-success"
                    : run.status === "running"
                    ? "bg-th-accent/10 text-th-accent"
                    : "bg-th-danger/10 text-th-danger"
                }`}
              >
                {run.status === "running" && (
                  <span className="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin mr-1 align-middle" />
                )}
                {run.items_found} items · {new Date(run.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Discovered News Topics ── */}
      {items.length > 0 && (
        <div className="cs-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-th-text">
              Discovered Topics
              <span className="text-th-text-muted font-normal ml-1">({filteredItems.length})</span>
            </h4>
            {selectedItems.size > 0 && !newsGenerating && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-th-text-muted">{selectedItems.size} selected</span>
                <button
                  onClick={() => {
                    const firstId = Array.from(selectedItems)[0];
                    const item = items.find((i) => i.id === firstId);
                    if (item) generateNews(item.title, item.url);
                  }}
                  className="cs-btn cs-btn-primary text-xs"
                >
                  Generate News Article
                </button>
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="search"
              value={newsSearch}
              onChange={(e) => setNewsSearch(e.target.value)}
              placeholder="Filter topics..."
              className="w-full py-2 pl-10 pr-4 bg-th-bg-secondary border border-th-border rounded-lg text-sm text-th-text placeholder:text-th-text-muted outline-none focus:border-th-accent transition-all"
            />
          </div>

          {/* Items list */}
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {filteredItems.slice(0, 50).map((item) => {
              const isSelected = selectedItems.has(item.id);
              const timeAgo = item.published ? getTimeAgo(item.published) : "";
              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? "border-th-accent bg-th-accent-soft"
                      : "border-th-border hover:border-th-accent/50 hover:bg-th-card-hover"
                  }`}
                  onClick={() => toggleItem(item.id)}
                >
                  {/* Checkbox */}
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    isSelected ? "border-th-accent bg-th-accent" : "border-th-border"
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-th-text leading-snug">{item.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-th-text-muted">
                      <span className="px-1.5 py-0.5 rounded bg-th-bg-secondary">{item.source}</span>
                      {timeAgo && <span>{timeAgo}</span>}
                    </div>
                  </div>

                  {/* Quick generate button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); generateNews(item.title, item.url); }}
                    disabled={newsGenerating}
                    className="shrink-0 p-1.5 rounded text-th-accent hover:bg-th-accent-soft transition-colors disabled:opacity-40"
                    title="Generate news article"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {filteredItems.length > 50 && (
            <p className="text-xs text-th-text-muted text-center mt-3">
              Showing 50 of {filteredItems.length} — use search to narrow down
            </p>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {items.length === 0 && !discovering && (
        <div className="cs-card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-th-accent-soft flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-th-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-th-text mb-1">No news discovered yet</p>
          <p className="text-xs text-th-text-muted mb-4">
            Click "Discover News" to scan {enabledCount} source{enabledCount !== 1 ? "s" : ""} for the latest topics.
            Add topics to watch or browse suggested sources.
          </p>
          <button onClick={runDiscovery} className="cs-btn cs-btn-primary mx-auto">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            Discover News Now
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Time ago helper ── */
function getTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

/* ── Article Library with search + type pill tabs ── */
const TYPE_LABELS: Record<string, string> = {
  informational: "Informational",
  college_profile: "College Profile",
  career_guide: "Career Guide",
  ranking_list: "Ranking List",
  exam_guide: "Exam Guide",
  comparison: "Comparison",
  fee_reference: "Fee Reference",
  cutoff_data: "Cutoff Data",
};

function ArticleLibrary({
  articles,
  loading,
  activeSlug,
  onView,
  onBack,
  showBack,
}: {
  articles: ArticleListItem[];
  loading: boolean;
  activeSlug?: string;
  onView: (slug: string) => void;
  onBack: () => void;
  showBack: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState("");
  const [pageSize, setPageSize] = useState(20);

  // Compute type counts
  const typeCounts = articles.reduce<Record<string, number>>((acc, a) => {
    const t = a.content_type || "other";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  // Filter
  const q = query.toLowerCase();
  const filtered = articles.filter((a) => {
    if (activeType && a.content_type !== activeType) return false;
    if (q) {
      const haystack = `${a.title} ${a.topic} ${a.slug} ${a.content_type}`.toLowerCase();
      // Support multiple search terms (space-separated)
      const terms = q.split(/\s+/).filter(Boolean);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
  const visible = filtered.slice(0, pageSize);
  const hasMore = filtered.length > pageSize;

  const gradeColor: Record<string, string> = {
    "A+": "bg-th-success text-white", A: "bg-th-success text-white",
    "B+": "bg-th-accent text-white", B: "bg-th-accent text-white",
    C: "bg-th-warning text-white", D: "bg-th-danger text-white",
  };

  return (
    <div className="cs-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-th-text">
          Content Library
          <span className="text-th-text-muted font-normal ml-1">
            ({filtered.length}{filtered.length !== articles.length ? ` of ${articles.length}` : ""})
          </span>
        </h3>
        {showBack && (
          <button onClick={onBack} className="text-xs text-th-accent hover:text-th-accent-hover transition-colors">
            Back to list
          </button>
        )}
      </div>

      {/* Search bar */}
      {articles.length > 0 && (
        <div className="relative mb-4">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPageSize(20); }}
            placeholder="Search by title, topic, or slug..."
            className="w-full py-2.5 pl-10 pr-10 bg-th-bg-secondary border border-th-border rounded-lg text-sm text-th-text placeholder:text-th-text-muted outline-none focus:border-th-accent focus:ring-2 focus:ring-th-accent/20 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-th-text-muted hover:text-th-text p-0.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Type pill tabs */}
      {sortedTypes.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => { setActiveType(""); setPageSize(20); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              !activeType
                ? "bg-th-accent text-white shadow-sm"
                : "bg-th-bg-secondary text-th-text-secondary hover:bg-th-border"
            }`}
          >
            All ({articles.length})
          </button>
          {sortedTypes.map(([type, count]) => (
            <button
              key={type}
              onClick={() => { setActiveType(activeType === type ? "" : type); setPageSize(20); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeType === type
                  ? "bg-th-accent text-white shadow-sm"
                  : "bg-th-bg-secondary text-th-text-secondary hover:bg-th-border"
              }`}
            >
              {TYPE_LABELS[type] || type.replace("_", " ")} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Article list */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
          <span className="text-sm text-th-text-muted">Loading articles...</span>
        </div>
      ) : articles.length === 0 ? (
        <p className="text-sm text-th-text-muted py-8 text-center">
          No articles generated yet. Enter a topic above and click Generate.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-th-text-muted py-8 text-center">
          No articles match {query ? `"${query}"` : "this filter"}.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {visible.map((a) => {
              const isActive = activeSlug === a.slug;
              return (
                <button
                  key={a.slug}
                  onClick={() => onView(a.slug)}
                  className={`w-full text-left p-4 rounded-lg border transition-all ${
                    isActive
                      ? "border-th-accent bg-th-accent-soft"
                      : "border-th-border hover:border-th-accent hover:bg-th-card-hover"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-th-text truncate">
                        {a.title || a.topic}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-th-text-muted">
                        <span className="cs-badge bg-th-bg-secondary text-th-text-secondary">
                          {TYPE_LABELS[a.content_type] || a.content_type.replace("_", " ")}
                        </span>
                        <span>{a.word_count.toLocaleString()} words</span>
                        <span>{a.table_count} tables</span>
                        <span>{a.section_count} sections</span>
                        {a.generation_time > 0 && <span>{Math.round(a.generation_time)}s</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.quality_grade && (
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${gradeColor[a.quality_grade] || "bg-th-bg-secondary text-th-text-muted"}`}>
                          {a.quality_grade}
                        </span>
                      )}
                      {!a.has_html && (
                        <span className="cs-badge bg-th-warning-soft text-th-warning">outline only</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {hasMore && (
            <button
              onClick={() => setPageSize((prev) => prev + 20)}
              className="w-full mt-4 py-2.5 text-sm font-medium text-th-accent hover:text-th-accent-hover bg-th-accent-soft hover:bg-th-accent-muted rounded-lg transition-colors"
            >
              Load more ({filtered.length - pageSize} remaining)
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ── Small stage badge ── */
function StageBadge({ stage }: { stage: Stage }) {
  const colors: Record<string, string> = {
    queued: "bg-th-text-muted text-white",
    classifying: "bg-th-purple text-white",
    researching: "bg-th-teal text-white",
    outlining: "bg-th-warning text-white",
    writing: "bg-th-accent text-white",
    post_processing: "bg-th-orange text-white",
    done: "bg-th-success text-white",
    error: "bg-th-danger text-white",
  };
  return (
    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[stage] || "bg-th-border text-th-text-muted"}`}>
      {stage.replace("_", " ")}
    </span>
  );
}
