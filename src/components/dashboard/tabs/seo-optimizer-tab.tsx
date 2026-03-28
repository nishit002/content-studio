"use client";

import { useState, useMemo, useCallback } from "react";
import type { ContentItem, SeoAnalysis } from "../types";

/* ── Props ── */
type Props = {
  items: ContentItem[];
  onUpdate: (id: string, updates: Partial<ContentItem>) => void;
};

/* ── Helpers ── */
function scoreColor(score: number) {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number) {
  if (score >= 70) return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
  if (score >= 40) return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
  return "bg-red-500/15 text-red-400 ring-red-500/30";
}

function scoreGrade(score: number) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

function gaugeStroke(score: number) {
  if (score >= 70) return "stroke-emerald-500";
  if (score >= 40) return "stroke-amber-500";
  return "stroke-red-500";
}

function gaugeGlow(score: number) {
  if (score >= 70) return "drop-shadow(0 0 6px rgb(16 185 129 / .5))";
  if (score >= 40) return "drop-shadow(0 0 6px rgb(245 158 11 / .5))";
  return "drop-shadow(0 0 6px rgb(239 68 68 / .5))";
}

/* ── Mock data generator ── */
function generateMockAnalysis(item: ContentItem): SeoAnalysis {
  const rand = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  const titleLen = item.title.length;
  const titleScore = titleLen >= 30 && titleLen <= 60 ? rand(70, 95) : rand(30, 60);

  const possibleMissing = ["long-tail variant", "location modifier", "year 2026", "comparison term"];
  const missing = possibleMissing.filter(() => Math.random() > 0.55);
  const stuffed = Math.random() > 0.7 ? [item.keywords?.[0] || "primary keyword"].filter(Boolean) : [];

  const metaScore = rand(40, 95);
  const headingScore = rand(50, 100);
  const readScore = rand(45, 90);

  const headingIssues: string[] = [];
  if (headingScore < 70) headingIssues.push("Multiple H1 tags detected");
  if (headingScore < 85) headingIssues.push("Skipped heading level (H2 -> H4)");
  if (Math.random() > 0.5) headingIssues.push("H2 sections lack descriptive keywords");

  const overall = Math.round(
    titleScore * 0.15 +
    metaScore * 0.15 +
    headingScore * 0.15 +
    readScore * 0.15 +
    rand(50, 95) * 0.2 +
    rand(40, 90) * 0.2
  );

  return {
    score: Math.min(100, Math.max(0, overall)),
    title: {
      score: titleScore,
      suggestion:
        titleLen > 60
          ? `Shorten title to under 60 characters (currently ${titleLen})`
          : titleLen < 30
          ? `Expand title with target keyword (currently ${titleLen} chars)`
          : "Title length is optimal. Consider adding a power word.",
    },
    meta: {
      score: metaScore,
      suggestion:
        metaScore < 60
          ? "Add a compelling meta description between 150-160 characters with primary keyword."
          : "Meta description is adequate. Consider adding a call-to-action.",
    },
    headings: { score: headingScore, issues: headingIssues },
    keywords: {
      density: parseFloat((Math.random() * 3.5 + 0.5).toFixed(1)),
      missing,
      stuffed,
    },
    readability: {
      score: readScore,
      grade: readScore >= 80 ? "6th-7th Grade" : readScore >= 60 ? "8th-9th Grade" : "10th+ Grade",
    },
    internalLinks: rand(1, 12),
    externalLinks: rand(0, 6),
    images: { total: rand(2, 10), missingAlt: rand(0, 4) },
    schema: {
      present: Math.random() > 0.3,
      types: Math.random() > 0.3
        ? ["Article", ...(Math.random() > 0.5 ? ["FAQPage"] : []), ...(Math.random() > 0.6 ? ["BreadcrumbList"] : [])]
        : [],
    },
  };
}

/* ── Circular Gauge SVG ── */
function CircularGauge({ score, size = 160 }: { score: number; size?: number }) {
  const strokeW = 10;
  const r = (size - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const grade = scoreGrade(score);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" style={{ filter: gaugeGlow(score) }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeW}
          className="stroke-[var(--color-border)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className={`${gaugeStroke(score)} transition-all duration-1000 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className={`text-lg font-semibold ${scoreColor(score)} opacity-70`}>{grade}</span>
      </div>
    </div>
  );
}

/* ── Severity icon ── */
function SeverityIcon({ level }: { level: "critical" | "warning" | "info" }) {
  if (level === "critical")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-400 text-xs font-bold shrink-0">
        !
      </span>
    );
  if (level === "warning")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold shrink-0">
        !
      </span>
    );
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 text-xs shrink-0">
      i
    </span>
  );
}

/* ── Build suggestions from analysis ── */
interface Suggestion {
  text: string;
  severity: "critical" | "warning" | "info";
  fixLabel: string;
}

function buildSuggestions(a: SeoAnalysis): Suggestion[] {
  const list: Suggestion[] = [];

  if (a.title.score < 60)
    list.push({ text: a.title.suggestion, severity: "critical", fixLabel: "Rewrite title" });
  else if (a.title.score < 80)
    list.push({ text: a.title.suggestion, severity: "warning", fixLabel: "Improve title" });

  if (a.meta.score < 60)
    list.push({ text: a.meta.suggestion, severity: "critical", fixLabel: "Generate meta" });
  else if (a.meta.score < 80)
    list.push({ text: a.meta.suggestion, severity: "warning", fixLabel: "Refine meta" });

  a.headings.issues.forEach((issue) =>
    list.push({ text: issue, severity: a.headings.score < 60 ? "critical" : "warning", fixLabel: "Fix heading" })
  );

  if (a.keywords.missing.length > 0)
    list.push({
      text: `Missing keywords: ${a.keywords.missing.join(", ")}`,
      severity: "warning",
      fixLabel: "Inject keywords",
    });

  if (a.keywords.stuffed.length > 0)
    list.push({
      text: `Keyword stuffing detected: ${a.keywords.stuffed.join(", ")}`,
      severity: "critical",
      fixLabel: "Reduce density",
    });

  if (a.readability.score < 60)
    list.push({ text: `Readability is poor (${a.readability.grade}). Simplify sentence structure.`, severity: "warning", fixLabel: "Simplify text" });

  if (a.images.missingAlt > 0)
    list.push({
      text: `${a.images.missingAlt} image(s) missing alt text`,
      severity: a.images.missingAlt > 2 ? "critical" : "warning",
      fixLabel: "Add alt text",
    });

  if (!a.schema.present)
    list.push({ text: "No structured data (schema) detected.", severity: "warning", fixLabel: "Add schema" });

  if (a.internalLinks < 3)
    list.push({ text: `Only ${a.internalLinks} internal link(s). Aim for at least 3.`, severity: "info", fixLabel: "Add links" });

  if (a.externalLinks === 0)
    list.push({ text: "No external links found. Add authoritative references.", severity: "info", fixLabel: "Add citations" });

  list.sort((a, b) => {
    const ord = { critical: 0, warning: 1, info: 2 };
    return ord[a.severity] - ord[b.severity];
  });

  return list;
}

/* ── Main Component ── */
export function SeoOptimizerTab({ items, onUpdate }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [analyses, setAnalyses] = useState<Record<string, SeoAnalysis>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyzeAllProgress, setAnalyzeAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [fixingIndex, setFixingIndex] = useState<number | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          i.title.toLowerCase().includes(search.toLowerCase()) ||
          i.topic.toLowerCase().includes(search.toLowerCase())
      ),
    [items, search]
  );

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const analysis = selectedId ? analyses[selectedId] ?? null : null;

  /* Aggregate stats for empty state */
  const aggregate = useMemo(() => {
    if (items.length === 0) return null;
    const avg = Math.round(items.reduce((s, i) => s + i.seoScore, 0) / items.length);
    const lowCount = items.filter((i) => i.seoScore < 40).length;
    const midCount = items.filter((i) => i.seoScore >= 40 && i.seoScore < 70).length;
    const highCount = items.filter((i) => i.seoScore >= 70).length;
    return { avg, lowCount, midCount, highCount };
  }, [items]);

  /* Analyze single article */
  const analyzeArticle = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      setAnalyzing(id);
      setTimeout(() => {
        const result = generateMockAnalysis(item);
        setAnalyses((prev) => ({ ...prev, [id]: result }));
        onUpdate(id, { seoScore: result.score });
        setAnalyzing(null);
      }, 1200 + Math.random() * 800);
    },
    [items, onUpdate]
  );

  /* Analyze all articles */
  const analyzeAll = useCallback(() => {
    setAnalyzeAllProgress({ current: 0, total: items.length });
    items.forEach((item, idx) => {
      setTimeout(() => {
        const result = generateMockAnalysis(item);
        setAnalyses((prev) => ({ ...prev, [item.id]: result }));
        onUpdate(item.id, { seoScore: result.score });
        setAnalyzeAllProgress((prev) =>
          prev ? { ...prev, current: prev.current + 1 } : null
        );
        if (idx === items.length - 1) {
          setTimeout(() => setAnalyzeAllProgress(null), 400);
        }
      }, (idx + 1) * 600);
    });
  }, [items, onUpdate]);

  /* Auto-fix simulation */
  const simulateFix = useCallback(
    (index: number) => {
      setFixingIndex(index);
      setTimeout(() => {
        if (selectedId && analysis) {
          const boosted = Math.min(100, analysis.score + Math.floor(Math.random() * 8 + 2));
          setAnalyses((prev) => ({
            ...prev,
            [selectedId]: { ...prev[selectedId], score: boosted },
          }));
          onUpdate(selectedId, { seoScore: boosted });
        }
        setFixingIndex(null);
      }, 800);
    },
    [selectedId, analysis, onUpdate]
  );

  const applyAllFixes = useCallback(() => {
    if (!selectedId || !analysis) return;
    setApplyingAll(true);
    setTimeout(() => {
      const boosted = Math.min(100, analysis.score + Math.floor(Math.random() * 15 + 10));
      setAnalyses((prev) => ({
        ...prev,
        [selectedId]: { ...prev[selectedId], score: boosted },
      }));
      onUpdate(selectedId, { seoScore: boosted });
      setApplyingAll(false);
    }, 1500);
  }, [selectedId, analysis, onUpdate]);

  const suggestions = analysis ? buildSuggestions(analysis) : [];

  return (
    <div className="flex h-full gap-4 min-h-0">
      {/* ── Left Panel: Article Selector (40%) ── */}
      <div className="w-[40%] shrink-0 flex flex-col gap-3 min-h-0">
        {/* Search + Analyze All */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search articles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] pl-9 pr-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
          </div>
          <button
            onClick={analyzeAll}
            disabled={items.length === 0 || analyzeAllProgress !== null}
            className="shrink-0 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {analyzeAllProgress
              ? `${analyzeAllProgress.current}/${analyzeAllProgress.total}`
              : "Analyze All"}
          </button>
        </div>

        {/* Analyze All progress bar */}
        {analyzeAllProgress && (
          <div className="h-1 rounded-full bg-[var(--color-border)] overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] transition-all duration-300 ease-out"
              style={{
                width: `${(analyzeAllProgress.current / analyzeAllProgress.total) * 100}%`,
              }}
            />
          </div>
        )}

        {/* Article list */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
          {filtered.length === 0 && (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-8">
              No articles found.
            </p>
          )}
          {filtered.map((item) => {
            const isSelected = item.id === selectedId;
            const isAnalyzing = analyzing === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  if (!analyses[item.id]) analyzeArticle(item.id);
                }}
                className={`w-full text-left rounded-lg border p-3 transition-all ${
                  isSelected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                    : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-border-hover,var(--color-accent))]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {item.title}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate">
                      {item.topic}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {isAnalyzing && (
                      <div className="h-4 w-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${scoreBg(item.seoScore)}`}
                    >
                      {item.seoScore}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right Panel: SEO Analysis (60%) ── */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {!selected ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="rounded-full bg-[var(--color-bg-secondary)] p-6">
              <svg className="w-12 h-12 text-[var(--color-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-[var(--color-text-primary)]">
                Select an article to analyze its SEO
              </p>
              <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
                Choose from the list on the left, or click Analyze All to audit every article.
              </p>
            </div>

            {aggregate && (
              <div className="grid grid-cols-4 gap-3 mt-2 w-full max-w-lg">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">{aggregate.avg}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">Avg Score</p>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{aggregate.highCount}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">Good</p>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-center">
                  <p className="text-2xl font-bold text-amber-400">{aggregate.midCount}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">Needs Work</p>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{aggregate.lowCount}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">Poor</p>
                </div>
              </div>
            )}
          </div>
        ) : analyzing === selectedId ? (
          /* ── Analyzing state ── */
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative w-24 h-24">
              <svg className="w-24 h-24 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="var(--color-border)" strokeWidth="3" />
                <path
                  d="M12 2a10 10 0 019.95 9"
                  stroke="var(--color-accent)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              Analyzing SEO for &quot;{selected.title}&quot;...
            </p>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        ) : analysis ? (
          /* ── Full analysis dashboard ── */
          <div className="space-y-5">
            {/* Overall Score */}
            <div className="flex items-center gap-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
              <CircularGauge score={analysis.score} />
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Overall SEO Score
                </h3>
                <p className="text-sm text-[var(--color-text-tertiary)] mt-1 truncate">
                  {selected.title}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => analyzeArticle(selectedId!)}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    Re-analyze
                  </button>
                </div>
              </div>
            </div>

            {/* Score Breakdown Grid (2x3) */}
            <div className="grid grid-cols-2 gap-3">
              {/* 1. Title Tag */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Title Tag</h4>
                  <span className={`text-xs font-bold ${scoreColor(analysis.title.score)}`}>
                    {analysis.title.score}/100
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mb-1.5">
                  {selected.title}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] italic mb-2">
                  {analysis.title.suggestion}
                </p>
                <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)]">
                  <span>{selected.title.length} characters</span>
                  <span className={selected.title.length > 60 ? "text-red-400" : selected.title.length < 30 ? "text-amber-400" : "text-emerald-400"}>
                    {selected.title.length > 60 ? "Too long" : selected.title.length < 30 ? "Too short" : "Optimal"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--color-border)]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${analysis.title.score >= 70 ? "bg-emerald-500" : analysis.title.score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${analysis.title.score}%` }}
                  />
                </div>
              </div>

              {/* 2. Meta Description */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Meta Description</h4>
                  <span className={`text-xs font-bold ${scoreColor(analysis.meta.score)}`}>
                    {analysis.meta.score}/100
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mb-1.5">
                  {analysis.meta.score >= 60
                    ? "Meta description detected and within acceptable length."
                    : "No meta description found or it is too short."}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] italic mb-2">
                  {analysis.meta.suggestion}
                </p>
                <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)]">
                  <span>{analysis.meta.score >= 60 ? "~155 characters" : "0 characters"}</span>
                  <span className={analysis.meta.score >= 60 ? "text-emerald-400" : "text-red-400"}>
                    {analysis.meta.score >= 60 ? "Present" : "Missing"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--color-border)]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${analysis.meta.score >= 70 ? "bg-emerald-500" : analysis.meta.score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${analysis.meta.score}%` }}
                  />
                </div>
              </div>

              {/* 3. Heading Structure */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Heading Structure</h4>
                  <span className={`text-xs font-bold ${scoreColor(analysis.headings.score)}`}>
                    {analysis.headings.score}/100
                  </span>
                </div>
                {/* Hierarchy visualization */}
                <div className="space-y-1 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-emerald-400 w-6">H1</span>
                    <div className="h-2 rounded bg-emerald-500/40 flex-1" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-blue-400 w-6">H2</span>
                    <div className="h-2 rounded bg-blue-500/40" style={{ width: "75%" }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-purple-400 w-6">H3</span>
                    <div className="h-2 rounded bg-purple-500/40" style={{ width: "50%" }} />
                  </div>
                </div>
                {analysis.headings.issues.length > 0 ? (
                  <ul className="space-y-0.5">
                    {analysis.headings.issues.map((issue, i) => (
                      <li key={i} className="text-[11px] text-amber-400 flex items-start gap-1">
                        <span className="shrink-0 mt-0.5">&#8226;</span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-emerald-400">Heading hierarchy looks good.</p>
                )}
              </div>

              {/* 4. Keyword Usage */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Keyword Usage</h4>
                  <span className="text-xs font-medium text-[var(--color-text-tertiary)]">
                    {analysis.keywords.density}% density
                  </span>
                </div>
                {/* Density bar */}
                <div className="mb-2">
                  <div className="h-2 rounded-full bg-[var(--color-border)] relative overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        analysis.keywords.density >= 1 && analysis.keywords.density <= 2.5
                          ? "bg-emerald-500"
                          : analysis.keywords.density > 2.5
                          ? "bg-red-500"
                          : "bg-amber-500"
                      }`}
                      style={{ width: `${Math.min(100, (analysis.keywords.density / 4) * 100)}%` }}
                    />
                    {/* Optimal zone markers */}
                    <div className="absolute top-0 left-[25%] w-px h-full bg-[var(--color-text-tertiary)]/30" />
                    <div className="absolute top-0 left-[62.5%] w-px h-full bg-[var(--color-text-tertiary)]/30" />
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                    <span>0%</span>
                    <span className="text-emerald-400/60">1-2.5% optimal</span>
                    <span>4%+</span>
                  </div>
                </div>
                {/* Missing keywords */}
                {analysis.keywords.missing.length > 0 && (
                  <div className="mb-1.5">
                    <p className="text-[10px] text-[var(--color-text-tertiary)] mb-1">Missing:</p>
                    <div className="flex flex-wrap gap-1">
                      {analysis.keywords.missing.map((kw) => (
                        <span key={kw} className="rounded-full bg-amber-500/15 text-amber-400 px-2 py-0.5 text-[10px]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Stuffed keywords */}
                {analysis.keywords.stuffed.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[var(--color-text-tertiary)] mb-1">Stuffed:</p>
                    <div className="flex flex-wrap gap-1">
                      {analysis.keywords.stuffed.map((kw) => (
                        <span key={kw} className="rounded-full bg-red-500/15 text-red-400 px-2 py-0.5 text-[10px]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 5. Readability */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Readability</h4>
                  <span className={`text-xs font-bold ${scoreColor(analysis.readability.score)}`}>
                    {analysis.readability.score}/100
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <p className="text-[10px] text-[var(--color-text-tertiary)]">Flesch Score</p>
                    <p className={`text-lg font-bold ${scoreColor(analysis.readability.score)}`}>
                      {analysis.readability.score}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-tertiary)]">Grade Level</p>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {analysis.readability.grade}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--color-text-tertiary)]">Avg Sentence Length</p>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {Math.floor(Math.random() * 10 + 12)} words
                  </p>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--color-border)]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${analysis.readability.score >= 70 ? "bg-emerald-500" : analysis.readability.score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${analysis.readability.score}%` }}
                  />
                </div>
              </div>

              {/* 6. Technical */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Technical</h4>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Internal Links</p>
                    <p className={`font-semibold ${analysis.internalLinks >= 3 ? "text-emerald-400" : "text-amber-400"}`}>
                      {analysis.internalLinks}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">External Links</p>
                    <p className={`font-semibold ${analysis.externalLinks >= 1 ? "text-emerald-400" : "text-amber-400"}`}>
                      {analysis.externalLinks}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Images</p>
                    <p className="font-semibold text-[var(--color-text-primary)]">
                      {analysis.images.total}
                      {analysis.images.missingAlt > 0 && (
                        <span className="text-red-400 ml-1">({analysis.images.missingAlt} no alt)</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Schema</p>
                    {analysis.schema.present ? (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {analysis.schema.types.map((t) => (
                          <span key={t} className="rounded bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[10px]">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="font-semibold text-red-400">None</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Suggestions Panel */}
            {suggestions.length > 0 && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Suggestions ({suggestions.length})
                  </h4>
                  <button
                    onClick={applyAllFixes}
                    disabled={applyingAll}
                    className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {applyingAll ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Applying...
                      </span>
                    ) : (
                      "Apply All Fixes"
                    )}
                  </button>
                </div>
                <ul className="space-y-2">
                  {suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3"
                    >
                      <SeverityIcon level={s.severity} />
                      <p className="flex-1 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                        {s.text}
                      </p>
                      <button
                        onClick={() => simulateFix(i)}
                        disabled={fixingIndex === i}
                        className="shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
                      >
                        {fixingIndex === i ? (
                          <span className="flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded-full border border-[var(--color-accent)] border-t-transparent animate-spin" />
                            Fixing
                          </span>
                        ) : (
                          s.fixLabel
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          /* ── Selected but no analysis yet ── */
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <button
              onClick={() => analyzeArticle(selectedId!)}
              className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Analyze SEO
            </button>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Click to run SEO analysis on &quot;{selected.title}&quot;
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
