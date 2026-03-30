"use client";

import { useState } from "react";
import type { AuditReport, AuditCheck, SROResult, LLMRecommendation } from "@/lib/server/sro-types";

export interface AeoSuggestions {
  topic: string;
  customOutline: string;
  fromUrl: string;
}

interface AeoTabProps {
  onGenerateFromAeo: (suggestions: AeoSuggestions) => void;
}

// ── Score Ring ────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 80 ? "var(--th-success)" : score >= 50 ? "var(--th-warning)" : "var(--th-danger)";
  return (
    <div className="relative flex items-center justify-center" style={{ width: 110, height: 110 }}>
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--th-border)" strokeWidth="8" />
        <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 55 55)" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <span className="absolute text-2xl font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

// ── AEO Check Row ─────────────────────────────────────────────────────────

function CheckRow({ check }: { check: AuditCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-th-border bg-th-card-alt">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-th-card transition-colors">
        <span className={check.pass ? "text-green-500" : "text-red-400"}>{check.pass ? "✓" : "✗"}</span>
        <span className="flex-1 font-medium text-th-text">{check.label}</span>
        <span className="rounded-md bg-th-card px-2 py-0.5 text-xs text-th-text-muted">{check.value}</span>
        <span className="text-xs text-th-text-muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-th-border px-4 py-2.5 text-sm text-th-text-secondary leading-relaxed">
          {check.detail}
        </div>
      )}
    </div>
  );
}

// ── SRO Progress Bar ──────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  idle: "Ready",
  grounding: "Running Gemini Grounding…",
  serp: "Fetching SERP Data…",
  scraping: "Scraping Pages…",
  context: "Analyzing Site Context…",
  analyzing: "Running SRO Analysis…",
  done: "Complete",
  error: "Error",
};

const STAGE_PCT: Record<string, number> = {
  idle: 0, grounding: 15, serp: 35, scraping: 55, context: 70, analyzing: 88, done: 100, error: 0,
};

function SROProgress({ stage }: { stage: string }) {
  const pct = STAGE_PCT[stage] ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-th-text-muted">
        <span>{STAGE_LABELS[stage] ?? stage}</span>
        <span>{stage === "done" ? "✓" : `${pct}%`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-th-card-alt">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: stage === "error" ? "var(--th-danger)" : "var(--th-accent)" }} />
      </div>
    </div>
  );
}

// ── Recommendation Card ───────────────────────────────────────────────────

function RecCard({ rec }: { rec: LLMRecommendation }) {
  const [open, setOpen] = useState(false);
  const priorityColors: Record<string, string> = {
    high: "bg-red-500/15 text-red-400 border-red-500/30",
    medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    low: "bg-green-500/15 text-green-400 border-green-500/30",
  };
  const catIcons: Record<string, string> = { content: "📝", structure: "🏗️", technical: "⚙️", strategy: "🎯" };
  return (
    <div className="rounded-lg border border-th-border bg-th-card-alt">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-th-card transition-colors">
        <span className="text-base shrink-0 mt-0.5">{catIcons[rec.category] ?? "📋"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-th-text">{rec.title}</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${priorityColors[rec.priority]}`}>{rec.priority}</span>
          </div>
          {!open && <p className="text-xs text-th-text-muted mt-0.5 line-clamp-1">{rec.description}</p>}
        </div>
        <span className="text-xs text-th-text-muted shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-th-border px-4 py-3 space-y-2">
          <p className="text-sm text-th-text-secondary">{rec.description}</p>
          {rec.actionItems.length > 0 && (
            <ul className="space-y-1">
              {rec.actionItems.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-th-text-secondary">
                  <span className="text-th-accent shrink-0">→</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── AEO Audit Sub-Tab ──────────────────────────────────────────────────────

function AeoAuditPanel({ onGenerate }: { onGenerate: (s: AeoSuggestions) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState("");

  async function runAudit() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReport(data as AuditReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const categories: Array<{ key: AuditCheck["category"]; label: string; icon: string }> = [
    { key: "discovery", label: "Discovery", icon: "🔍" },
    { key: "structure", label: "Structure & Schema", icon: "🏗️" },
    { key: "content", label: "Content Quality", icon: "📝" },
    { key: "technical", label: "Technical", icon: "⚙️" },
    { key: "rendering", label: "Server-Side Rendering", icon: "🖥️" },
  ];

  // Build "Generate Content" context from failed checks
  function handleGenerate() {
    if (!report) return;
    const failedChecks = report.checks.filter((c) => !c.pass);
    const outline = failedChecks.slice(0, 8).map((c) => `Fix: ${c.label} — ${c.detail}`).join("\n");
    const domain = (() => { try { return new URL(report.url).hostname; } catch { return report.url; } })();
    onGenerate({ topic: `AEO improvements for ${domain}`, customOutline: outline, fromUrl: report.url });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAudit()}
          placeholder="https://example.com/page" className="cs-input flex-1" />
        <button onClick={runAudit} disabled={loading || !url.trim()} className="cs-btn cs-btn-primary whitespace-nowrap">
          {loading ? "Auditing…" : "Run AEO Audit"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</p>}

      {report && (
        <div className="space-y-4">
          {/* Score header */}
          <div className="flex items-center gap-6 rounded-xl border border-th-border bg-th-card p-5">
            <ScoreRing score={report.score ?? 0} />
            <div className="flex-1">
              <div className="text-lg font-semibold text-th-text">AEO Readiness Score</div>
              <div className="mt-1 text-sm text-th-text-secondary">
                {report.checks.filter((c) => c.pass).length} of {report.checks.length} checks passed for{" "}
                <span className="text-th-accent">{report.url}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {categories.map(({ key, label, icon }) => {
                  const group = report.checks.filter((c) => c.category === key);
                  if (!group.length) return null;
                  const passed = group.filter((c) => c.pass).length;
                  return (
                    <span key={key} className="inline-flex items-center gap-1 rounded-full border border-th-border bg-th-card-alt px-2.5 py-1 text-xs font-medium text-th-text-secondary">
                      {icon} {label}: {passed}/{group.length}
                    </span>
                  );
                })}
              </div>
            </div>
            {report.checks.some((c) => !c.pass) && (
              <button onClick={handleGenerate} className="cs-btn cs-btn-primary shrink-0">
                Generate Fixes with Content Studio →
              </button>
            )}
          </div>

          {/* Check groups */}
          {categories.map(({ key, label, icon }) => {
            const group = report.checks.filter((c) => c.category === key);
            if (!group.length) return null;
            return (
              <div key={key}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-th-text">{icon} {label}</h3>
                <div className="space-y-1.5">{group.map((c) => <CheckRow key={c.id} check={c} />)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SRO Analysis Sub-Tab ──────────────────────────────────────────────────

function SroAnalysisPanel({ onGenerate }: { onGenerate: (s: AeoSuggestions) => void }) {
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [stage, setStage] = useState("idle");
  const [result, setResult] = useState<SROResult | null>(null);
  const [error, setError] = useState("");

  async function runSro() {
    if (!url.trim() || !keyword.trim()) return;
    setStage("grounding");
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/sro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), keyword: keyword.trim() }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { stage: string; data?: SROResult; error?: string };
            setStage(event.stage);
            if (event.stage === "done" && event.data) setResult(event.data);
            if (event.stage === "error") setError(event.error ?? "Unknown error");
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleGenerate() {
    if (!result?.llmAnalysis) return;
    const gaps = result.llmAnalysis.contentGaps.slice(0, 6).map((g) => `Gap: ${g}`).join("\n");
    const topRecs = result.llmAnalysis.recommendations.filter((r) => r.priority === "high").slice(0, 4).map((r) => `${r.title}: ${r.description}`).join("\n");
    onGenerate({ topic: keyword, customOutline: [gaps, topRecs].filter(Boolean).join("\n\n"), fromUrl: url });
  }

  const analysis = result?.llmAnalysis;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/page" className="cs-input sm:col-span-2" />
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="target keyword" className="cs-input" />
      </div>
      <button onClick={runSro} disabled={stage !== "idle" && stage !== "done" && stage !== "error" || !url.trim() || !keyword.trim()}
        className="cs-btn cs-btn-primary">
        {stage === "idle" || stage === "done" || stage === "error" ? "Run SRO Analysis" : "Analysing…"}
      </button>

      {stage !== "idle" && <SROProgress stage={stage} />}

      {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</p>}

      {analysis && (
        <div className="space-y-5">
          {/* Score + summary */}
          <div className="flex items-start gap-5 rounded-xl border border-th-border bg-th-card p-5">
            <ScoreRing score={analysis.overallScore} />
            <div className="flex-1">
              <div className="text-lg font-semibold text-th-text">SRO Score</div>
              <p className="mt-1 text-sm text-th-text-secondary">{analysis.summary}</p>
              {/* Grounding quick stats */}
              {result?.grounding && (
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-th-text-muted">
                  <span>Selection rate: <strong className="text-th-text">{(result.grounding.selectionRate * 100).toFixed(1)}%</strong></span>
                  <span>Found in grounding: <strong className={result.grounding.targetUrlFound ? "text-green-400" : "text-red-400"}>{result.grounding.targetUrlFound ? "Yes" : "No"}</strong></span>
                  {result.serp?.targetRank && <span>SERP rank: <strong className="text-th-text">#{result.serp.targetRank}</strong></span>}
                </div>
              )}
            </div>
            <button onClick={handleGenerate} className="cs-btn cs-btn-primary shrink-0">
              Generate Content for These Gaps →
            </button>
          </div>

          {/* Recommendations */}
          {analysis.recommendations.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-th-text mb-2">Recommendations ({analysis.recommendations.length})</h3>
              <div className="space-y-2">
                {analysis.recommendations.map((r, i) => <RecCard key={i} rec={r} />)}
              </div>
            </div>
          )}

          {/* Content gaps */}
          {analysis.contentGaps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-th-text mb-2">Content Gaps</h3>
              <ul className="space-y-1.5">
                {analysis.contentGaps.map((gap, i) => (
                  <li key={i} className="flex gap-2 text-sm text-th-text-secondary bg-th-card-alt rounded-lg px-4 py-2">
                    <span className="text-yellow-400 shrink-0">△</span>
                    <span>{gap}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Competitor insights */}
          {analysis.competitorInsights.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-th-text mb-2">Competitor Insights</h3>
              <ul className="space-y-1.5">
                {analysis.competitorInsights.map((ins, i) => (
                  <li key={i} className="flex gap-2 text-sm text-th-text-secondary bg-th-card-alt rounded-lg px-4 py-2">
                    <span className="text-th-accent shrink-0">→</span>
                    <span>{ins}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main AEO Tab ──────────────────────────────────────────────────────────

export default function AeoTab({ onGenerateFromAeo }: AeoTabProps) {
  const [subTab, setSubTab] = useState<"aeo" | "sro">("aeo");

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Sub-tab switcher */}
      <div className="flex gap-1 rounded-lg border border-th-border bg-th-card-alt p-1 w-fit">
        {([["aeo", "🏥 AEO Audit"], ["sro", "📡 SRO Analysis"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${subTab === key ? "bg-th-card text-th-accent shadow-sm" : "text-th-text-secondary hover:text-th-text"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-sm text-th-text-secondary">
        {subTab === "aeo"
          ? "Audit any URL for AI-readiness: llms.txt, Schema.org, BLUF content style, heading structure, and server-side rendering. Get a score and fix list."
          : "Deep 5-stage pipeline: Gemini Grounding → SERP → Page Scraping → Site Context → LLM Analysis. Produces an SRO Score with prioritized recommendations and content gaps."}
      </p>

      {subTab === "aeo" ? (
        <AeoAuditPanel onGenerate={onGenerateFromAeo} />
      ) : (
        <SroAnalysisPanel onGenerate={onGenerateFromAeo} />
      )}
    </div>
  );
}
