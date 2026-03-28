"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ContentItem, AeoAnalysis } from "../types";

/* ── Props ── */
type Props = {
  items: ContentItem[];
  onUpdate: (id: string, updates: Partial<ContentItem>) => void;
};

/* ── Simulated analysis generator ── */
function simulateAeoAnalysis(item: ContentItem): AeoAnalysis {
  const base = item.aeoScore || Math.floor(Math.random() * 40 + 40);
  const qualityOptions = ["Excellent", "Good", "Needs Work"];
  const qualityIndex = base >= 80 ? 0 : base >= 55 ? 1 : 2;
  return {
    score: base,
    directAnswers: {
      count: Math.floor(base / 15) + 1,
      quality: qualityOptions[qualityIndex],
    },
    featuredSnippetReady: base >= 70,
    faqSchema: base >= 60,
    questionCoverage: Math.min(100, base + Math.floor(Math.random() * 15)),
    citationReadiness: Math.min(100, base - 5 + Math.floor(Math.random() * 20)),
    llmFriendliness: Math.min(100, base + Math.floor(Math.random() * 10)),
    suggestions: [
      ...(base < 70 ? ["Add FAQ schema markup to improve snippet eligibility"] : []),
      ...(base < 80 ? ["Include more direct answer paragraphs (40-60 words)"] : []),
      ...(base < 85 ? ["Add statistical data and cite sources for higher citation readiness"] : []),
      ...(base < 75 ? ["Structure content with clear H2/H3 hierarchy for LLM parsing"] : []),
      ...(base < 90 ? ["Add a concise summary paragraph at the top of the article"] : []),
      "Use numbered lists for step-by-step processes",
    ].slice(0, 5),
  };
}

/* ── Derived detail types ── */
interface QuestionCoverageItem {
  question: string;
  covered: boolean;
}

interface CitationBreakdown {
  factualClaims: number;
  sourceAttribution: number;
  dataFreshness: number;
}

function deriveQuestions(item: ContentItem): QuestionCoverageItem[] {
  const topic = item.topic || item.title;
  const questions = [
    `What is ${topic}?`,
    `How does ${topic} work?`,
    `What are the benefits of ${topic}?`,
    `Who should consider ${topic}?`,
    `What are the costs of ${topic}?`,
    `How to get started with ${topic}?`,
    `What are alternatives to ${topic}?`,
    `Is ${topic} worth it?`,
  ];
  const score = item.aeoScore || 50;
  const coveredCount = Math.ceil((score / 100) * questions.length);
  return questions.map((q, i) => ({ question: q, covered: i < coveredCount }));
}

function deriveCitationBreakdown(analysis: AeoAnalysis): CitationBreakdown {
  const base = analysis.citationReadiness;
  return {
    factualClaims: Math.floor(base / 8) + 2,
    sourceAttribution: Math.min(100, base + 5),
    dataFreshness: Math.min(100, base - 3 + Math.floor(Math.random() * 10)),
  };
}

/* ── Score Ring SVG ── */
function ScoreRing({ score, size = 140, stroke = 10 }: { score: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? "text-th-purple" : score >= 55 ? "text-yellow-500" : "text-red-500";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-th-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${color} transition-all duration-700 ease-out`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-bold ${color}`}>{score}</span>
        <span className="text-xs text-th-text-muted">AEO Score</span>
      </div>
    </div>
  );
}

/* ── KPI Card ── */
function KpiCard({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "flat";
}) {
  return (
    <div className="bg-th-card border border-th-border rounded-xl p-4 flex flex-col gap-1">
      <p className="text-xs font-medium text-th-text-muted uppercase tracking-wide">{label}</p>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-th-text">{value}</span>
        {trend && (
          <span
            className={`text-sm font-medium ${
              trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-th-text-muted"
            }`}
          >
            {trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "\u2192"}
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-th-text-muted">{sub}</p>}
    </div>
  );
}

/* ── Analysis Card ── */
function AnalysisCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-th-card border border-th-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-th-purple">{icon}</span>
        <h4 className="text-sm font-semibold text-th-text">{title}</h4>
      </div>
      {children}
    </div>
  );
}

/* ── Badge helpers ── */
function scoreBadge(score: number) {
  if (score >= 80) return "bg-th-purple-soft text-th-purple";
  if (score >= 55) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

function qualityBadge(quality: string) {
  if (quality === "Excellent") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (quality === "Good") return "bg-th-purple-soft text-th-purple";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

/* ──────────────────────────── Main Component ──────────────────────────── */
export function AeoOptimizerTab({ items, onUpdate }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AeoAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [optimizingIdx, setOptimizingIdx] = useState<number | null>(null);

  // Sort articles by AEO score descending
  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.aeoScore ?? 0) - (a.aeoScore ?? 0)),
    [items],
  );

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  // Run simulated analysis when selection changes
  useEffect(() => {
    if (!selectedItem) {
      setAnalysis(null);
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);
    const t = setTimeout(() => {
      setAnalysis(simulateAeoAnalysis(selectedItem));
      setAnalyzing(false);
    }, 800);
    return () => clearTimeout(t);
  }, [selectedItem]);

  // Auto-optimize handler
  const handleAutoOptimize = useCallback(
    (suggestionIdx: number) => {
      if (!selectedItem || !analysis) return;
      setOptimizingIdx(suggestionIdx);
      setTimeout(() => {
        const boost = Math.min(100, (selectedItem.aeoScore ?? 50) + Math.floor(Math.random() * 8 + 3));
        onUpdate(selectedItem.id, { aeoScore: boost });
        setOptimizingIdx(null);
      }, 1200);
    },
    [selectedItem, analysis, onUpdate],
  );

  // Compute KPIs
  const kpis = useMemo(() => {
    if (items.length === 0) return null;
    const avgScore = Math.round(items.reduce((s, i) => s + (i.aeoScore ?? 0), 0) / items.length);
    const snippetReady = items.filter((i) => (i.aeoScore ?? 0) >= 70).length;
    const avgCitation = Math.round(
      items.reduce((s, i) => s + Math.min(100, (i.aeoScore ?? 40) + Math.floor(Math.random() * 10)), 0) /
        items.length,
    );
    const avgQuestionCov = Math.round(
      items.reduce((s, i) => s + Math.min(100, (i.aeoScore ?? 40) + Math.floor(Math.random() * 15)), 0) /
        items.length,
    );
    return { avgScore, snippetReady, avgCitation, avgQuestionCov };
  }, [items]);

  /* ── Empty state ── */
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center gap-4">
        <div className="w-20 h-20 rounded-full bg-th-purple-soft flex items-center justify-center">
          <svg className="w-10 h-10 text-th-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-th-text">No Content to Analyze</h3>
        <p className="text-sm text-th-text-muted max-w-md">
          Generate some articles in the Content Generator tab first, then come back here to optimize them for AI answer engines and featured snippets.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── KPI Overview ── */}
      {kpis && (
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="AI Visibility Score"
            value={kpis.avgScore}
            sub="Avg across all articles"
            trend={kpis.avgScore >= 70 ? "up" : kpis.avgScore >= 50 ? "flat" : "down"}
          />
          <KpiCard
            label="Featured Snippet Ready"
            value={`${kpis.snippetReady} / ${items.length}`}
            sub="Articles optimized for Position 0"
          />
          <KpiCard
            label="Citation Readiness"
            value={`${kpis.avgCitation}%`}
            sub="Likelihood AI models cite your content"
          />
          <KpiCard
            label="Question Coverage"
            value={`${kpis.avgQuestionCov}%`}
            sub="Related questions answered"
          />
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-2 gap-6 min-h-[600px]">
        {/* ── Left: Article List ── */}
        <div className="bg-th-card border border-th-border rounded-xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-th-border">
            <h3 className="text-sm font-semibold text-th-text">Articles by AEO Score</h3>
            <p className="text-xs text-th-text-muted mt-0.5">{sorted.length} articles</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-th-border">
            {sorted.map((item) => {
              const isSelected = item.id === selectedId;
              const score = item.aeoScore ?? 0;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-th-sidebar-hover ${
                    isSelected ? "bg-th-purple-soft/50 border-l-2 border-l-th-purple" : "border-l-2 border-l-transparent"
                  }`}
                >
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold ${scoreBadge(score)}`}
                  >
                    {score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-th-text truncate">{item.title}</p>
                    <p className="text-xs text-th-text-muted truncate">
                      {item.type.replace(/_/g, " ")} &middot; {item.wordCount.toLocaleString()} words
                    </p>
                  </div>
                  <svg
                    className={`w-4 h-4 shrink-0 text-th-text-muted transition-transform ${isSelected ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: Analysis ── */}
        <div className="space-y-4 overflow-y-auto pr-1">
          {!selectedItem && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <div className="w-16 h-16 rounded-full bg-th-purple-soft flex items-center justify-center">
                <svg className="w-8 h-8 text-th-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-th-text">Select an Article</h3>
              <p className="text-xs text-th-text-muted max-w-xs">
                Choose an article from the list to run a detailed AEO analysis and get optimization suggestions.
              </p>
            </div>
          )}

          {selectedItem && analyzing && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-12 h-12 rounded-full border-2 border-th-purple border-t-transparent animate-spin" />
              <p className="text-sm text-th-text-muted">Analyzing AEO performance...</p>
            </div>
          )}

          {selectedItem && analysis && !analyzing && (
            <>
              {/* Header with score ring */}
              <div className="bg-th-card border border-th-border rounded-xl p-5 flex items-center gap-6">
                <ScoreRing score={analysis.score} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-th-text truncate">{selectedItem.title}</h3>
                  <p className="text-xs text-th-text-muted mt-1">
                    {selectedItem.type.replace(/_/g, " ")} &middot; {selectedItem.wordCount.toLocaleString()} words &middot; Updated{" "}
                    {new Date(selectedItem.updatedAt).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2 mt-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${analysis.featuredSnippetReady ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                      {analysis.featuredSnippetReady ? "Snippet Ready" : "Not Snippet Ready"}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${analysis.faqSchema ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}`}>
                      {analysis.faqSchema ? "FAQ Schema" : "No FAQ Schema"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Analysis cards grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* 1. Direct Answer Quality */}
                <AnalysisCard
                  title="Direct Answer Quality"
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-th-text-muted">Quality Rating</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${qualityBadge(analysis.directAnswers.quality)}`}>
                        {analysis.directAnswers.quality}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-th-text-muted">Direct Answers Found</span>
                      <span className="text-sm font-semibold text-th-text">{analysis.directAnswers.count}</span>
                    </div>
                    <p className="text-xs text-th-text-muted pt-1">
                      {analysis.directAnswers.quality === "Excellent"
                        ? "Content provides clear, concise answers to target questions."
                        : analysis.directAnswers.quality === "Good"
                          ? "Content answers questions but could be more direct and concise."
                          : "Content lacks direct, concise answers to the target question."}
                    </p>
                  </div>
                </AnalysisCard>

                {/* 2. Featured Snippet Optimization */}
                <AnalysisCard
                  title="Featured Snippet Optimization"
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                    </svg>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-th-text-muted">Position 0 Ready</span>
                      <span className={`text-xs font-medium ${analysis.featuredSnippetReady ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                        {analysis.featuredSnippetReady ? "Yes" : "No"}
                      </span>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {["Paragraph snippet", "List snippet", "Table snippet"].map((format, i) => {
                        const detected = i === 0 ? analysis.score >= 50 : i === 1 ? analysis.score >= 65 : analysis.score >= 80;
                        return (
                          <div key={format} className="flex items-center gap-2 text-xs">
                            <span className={detected ? "text-green-500" : "text-th-text-muted"}>
                              {detected ? "\u2713" : "\u2717"}
                            </span>
                            <span className={detected ? "text-th-text" : "text-th-text-muted"}>{format}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </AnalysisCard>

                {/* 3. FAQ Schema */}
                <AnalysisCard
                  title="FAQ Schema"
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                    </svg>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-th-text-muted">Schema Present</span>
                      <span className={`text-xs font-medium ${analysis.faqSchema ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                        {analysis.faqSchema ? "Yes" : "No"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-th-text-muted">Q&A Pairs</span>
                      <span className="text-sm font-semibold text-th-text">{analysis.faqSchema ? analysis.directAnswers.count + 2 : 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-th-text-muted">Quality Check</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${analysis.faqSchema ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                        {analysis.faqSchema ? "Passed" : "Missing"}
                      </span>
                    </div>
                  </div>
                </AnalysisCard>

                {/* 4. Question Coverage */}
                <AnalysisCard
                  title="Question Coverage"
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                  }
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-th-text-muted">Coverage</span>
                      <span className="text-sm font-semibold text-th-purple">{analysis.questionCoverage}%</span>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {deriveQuestions(selectedItem).map((q, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span className={`shrink-0 mt-0.5 ${q.covered ? "text-green-500" : "text-red-400"}`}>
                            {q.covered ? "\u2713" : "\u2717"}
                          </span>
                          <span className={q.covered ? "text-th-text" : "text-th-text-muted"}>{q.question}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </AnalysisCard>

                {/* 5. Citation Readiness */}
                <AnalysisCard
                  title="Citation Readiness"
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  }
                >
                  {(() => {
                    const breakdown = deriveCitationBreakdown(analysis);
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-th-text-muted">Overall Score</span>
                          <span className="text-sm font-semibold text-th-purple">{analysis.citationReadiness}%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-th-text-muted">Factual Claims</span>
                          <span className="text-sm font-medium text-th-text">{breakdown.factualClaims}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-th-text-muted">Source Attribution</span>
                          <span className="text-sm font-medium text-th-text">{breakdown.sourceAttribution}%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-th-text-muted">Data Freshness</span>
                          <span className="text-sm font-medium text-th-text">{breakdown.dataFreshness}%</span>
                        </div>
                      </div>
                    );
                  })()}
                </AnalysisCard>

                {/* 6. LLM Friendliness */}
                <AnalysisCard
                  title="LLM Friendliness"
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-th-text-muted">Overall Score</span>
                      <span className="text-sm font-semibold text-th-purple">{analysis.llmFriendliness}%</span>
                    </div>
                    {[
                      { label: "Clear Structure", met: analysis.llmFriendliness >= 50 },
                      { label: "Concise Paragraphs", met: analysis.llmFriendliness >= 60 },
                      { label: "Factual Density", met: analysis.llmFriendliness >= 75 },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2 text-xs">
                        <span className={item.met ? "text-green-500" : "text-red-400"}>
                          {item.met ? "\u2713" : "\u2717"}
                        </span>
                        <span className={item.met ? "text-th-text" : "text-th-text-muted"}>{item.label}</span>
                      </div>
                    ))}
                    <div className="w-full bg-th-border rounded-full h-1.5 mt-1">
                      <div
                        className="bg-th-purple h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${analysis.llmFriendliness}%` }}
                      />
                    </div>
                  </div>
                </AnalysisCard>
              </div>

              {/* ── Suggestions ── */}
              <div className="bg-th-card border border-th-border rounded-xl p-4">
                <h4 className="text-sm font-semibold text-th-text mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-th-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                  </svg>
                  Optimization Suggestions
                </h4>
                <div className="space-y-2">
                  {analysis.suggestions.map((suggestion, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-th-bg border border-th-border"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-th-purple-soft text-th-purple flex items-center justify-center text-xs font-semibold">
                          {idx + 1}
                        </span>
                        <span className="text-sm text-th-text truncate">{suggestion}</span>
                      </div>
                      <button
                        onClick={() => handleAutoOptimize(idx)}
                        disabled={optimizingIdx !== null}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-th-purple text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {optimizingIdx === idx ? (
                          <>
                            <span className="w-3 h-3 rounded-full border border-white border-t-transparent animate-spin" />
                            Optimizing...
                          </>
                        ) : (
                          "Auto-Optimize"
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
