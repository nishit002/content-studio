"use client";

import { useState, useEffect, useRef } from "react";
import type { AuditReport, AuditCheck, SROResult, LLMRecommendation } from "@/lib/server/sro-types";

export interface AeoSuggestions {
  topic: string;
  customOutline: string;
  fromUrl: string;
}

export type SubTab = "aeo" | "sro" | "prompts" | "responses" | "analytics" | "citations" | "opportunities" | "battlecards" | "fanout" | "niche" | "automation" | "competitors";

interface AeoTabProps {
  onGenerateFromAeo: (suggestions: AeoSuggestions) => void;
  subTab: SubTab;
  setSubTab: (t: SubTab) => void;
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

          {/* SWOT Analysis */}
          {report.swot && (
            <div className="rounded-xl border border-th-border bg-th-card p-5">
              <div className="text-sm font-semibold text-th-text mb-4">SWOT Analysis</div>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: "strengths" as const, label: "Strengths", color: "border-green-500/30 bg-green-500/5", textColor: "text-green-400", icon: "✓" },
                  { key: "weaknesses" as const, label: "Weaknesses", color: "border-red-500/30 bg-red-500/5", textColor: "text-red-400", icon: "✗" },
                  { key: "opportunities" as const, label: "Opportunities", color: "border-blue-500/30 bg-blue-500/5", textColor: "text-blue-400", icon: "→" },
                  { key: "threats" as const, label: "Threats", color: "border-amber-500/30 bg-amber-500/5", textColor: "text-amber-400", icon: "⚠" },
                ] as const).map(({ key, label, color, textColor, icon }) => (
                  <div key={key} className={`rounded-lg border p-3 ${color}`}>
                    <div className={`text-xs font-semibold mb-2 ${textColor}`}>{label}</div>
                    <ul className="space-y-1.5">
                      {(report.swot![key] ?? []).map((item, i) => (
                        <li key={i} className="flex gap-2 text-xs text-th-text-secondary">
                          <span className={`shrink-0 ${textColor}`}>{icon}</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Fixes */}
          {report.fixes && report.fixes.length > 0 && (
            <div className="rounded-xl border border-th-border bg-th-card p-5">
              <div className="text-sm font-semibold text-th-text mb-4">Top Priority Fixes</div>
              <div className="space-y-3">
                {report.fixes.map((fix, i) => {
                  const priorityStyle = fix.priority === "high"
                    ? "bg-red-500/15 text-red-400 border-red-500/30"
                    : fix.priority === "medium"
                      ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
                      : "bg-green-500/15 text-green-400 border-green-500/30";
                  return (
                    <div key={i} className="flex gap-4 rounded-lg border border-th-border bg-th-card-alt px-4 py-3">
                      <div className="text-lg font-bold text-th-text-muted/40 shrink-0 w-5">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-semibold text-th-text">{fix.title}</span>
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${priorityStyle}`}>{fix.priority}</span>
                        </div>
                        <div className="text-xs text-th-accent mb-1.5">{fix.impact}</div>
                        <div className="text-xs text-th-text-secondary">{fix.action}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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

  // Ref to clear SRO poll on unmount
  const sroJobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resume any running SRO job on mount
  useEffect(() => {
    fetch("/api/jobs?active=1")
      .then((r) => r.json())
      .then((data: { jobs?: Array<{ id: string; job_type: string; progress: { stage?: string; result?: SROResult } }> }) => {
        const running = data.jobs?.find((j) => j.job_type === "sro");
        if (!running) return;
        setStage(running.progress?.stage ?? "grounding");
        const jobId = running.id;
        const poll = setInterval(async () => {
          try {
            const r = await fetch(`/api/jobs?id=${jobId}`);
            if (!r.ok) return;
            const job = await r.json() as { status: string; progress: { stage?: string; result?: SROResult; error?: string } };
            setStage(job.progress?.stage ?? "grounding");
            if (job.status === "done") {
              if (job.progress?.result) setResult(job.progress.result);
              clearInterval(poll);
              if (sroJobPollRef.current === poll) sroJobPollRef.current = null;
            } else if (job.status === "error") {
              setError(job.progress?.error ?? "Analysis failed");
              setStage("error");
              clearInterval(poll);
              if (sroJobPollRef.current === poll) sroJobPollRef.current = null;
            }
          } catch { /* ignore */ }
        }, 3000);
        sroJobPollRef.current = poll;
      })
      .catch(() => {});
    return () => { if (sroJobPollRef.current) clearInterval(sroJobPollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSro() {
    if (!url.trim() || !keyword.trim()) return;
    setStage("grounding");
    setError("");
    setResult(null);

    // Submit — server runs in background, returns serverJobId immediately
    let serverJobId: string | null = null;
    try {
      const res = await fetch("/api/sro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), keyword: keyword.trim() }),
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { serverJobId: string };
      serverJobId = data.serverJobId;
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    // Clear any previous poll
    if (sroJobPollRef.current) { clearInterval(sroJobPollRef.current); sroJobPollRef.current = null; }

    // Poll every 3s for stage updates and final result
    const jobId = serverJobId;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs?id=${jobId}`);
        if (!r.ok) return;
        const job = await r.json() as {
          status: string;
          progress: { stage?: string; result?: SROResult; error?: string };
        };
        setStage(job.progress?.stage ?? "grounding");
        if (job.status === "done") {
          if (job.progress?.result) setResult(job.progress.result);
          clearInterval(poll);
          if (sroJobPollRef.current === poll) sroJobPollRef.current = null;
        } else if (job.status === "error") {
          setError(job.progress?.error ?? "Analysis failed");
          setStage("error");
          clearInterval(poll);
          if (sroJobPollRef.current === poll) sroJobPollRef.current = null;
        }
      } catch { /* ignore transient errors */ }
    }, 3000);
    sroJobPollRef.current = poll;
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

// ── Shared types ─────────────────────────────────────────────────────────

interface AeoBrandConfig { brandName: string; aliases: string; website: string; industry: string; keywords: string; description: string; competitors: string; }
interface AeoPrompt { id: string; promptText: string; volumeData: string; createdAt: string; }
interface AeoRun { id: string; provider: string; promptText: string; answer: string; sources: string[]; visibilityScore: number; sentiment: string; brandMentioned: boolean; competitors: string[]; accuracyFlags: string; createdAt: string; }
interface AeoBattlecard { id: string; competitor: string; summary: string; sections: { title: string; content: string }[]; sentiment: string; createdAt: string; }
interface AeoScheduleData { enabled: boolean; intervalMs: number; lastRunAt: string; }
interface AeoDriftAlert { id: string; promptText: string; provider: string; oldScore: number; newScore: number; delta: number; dismissed: boolean; createdAt: string; }

const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT", perplexity: "Perplexity", copilot: "Copilot",
  gemini: "Gemini", google_ai: "Google AI", grok: "Grok",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-green-400", neutral: "text-th-text-muted", negative: "text-red-400",
};

// ── Brand Settings Panel ──────────────────────────────────────────────────

function BrandSettingsPanel() {
  const [cfg, setCfg] = useState<AeoBrandConfig>({ brandName: "", aliases: "", website: "", industry: "", keywords: "", description: "", competitors: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/aeo/config").then(r => r.json()).then(d => setCfg(d as AeoBrandConfig)).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    await fetch("/api/aeo/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const field = (label: string, key: keyof AeoBrandConfig, placeholder: string, multiline?: boolean) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-th-text-muted uppercase tracking-wide">{label}</label>
      {multiline
        ? <textarea value={cfg[key]} onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className="cs-input min-h-[80px] resize-y" />
        : <input value={cfg[key]} onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className="cs-input" />}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-th-text-secondary">Configure your brand so every prompt and analysis is contextualized correctly. Visibility scores are computed against these brand terms.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("Brand / Company Name", "brandName", "FindMyCollege")}
        {field("Brand Aliases (comma-separated)", "aliases", "FMC, findmycollege.com")}
        {field("Website URL", "website", "https://findmycollege.com")}
        {field("Industry / Vertical", "industry", "EdTech, College Admissions")}
        {field("Target Keywords (comma-separated)", "keywords", "MBA colleges, top engineering colleges")}
        {field("Competitors (comma-separated)", "competitors", "Shiksha, Collegedunia, Careers360")}
      </div>
      {field("Brand Description", "description", "Brief description of your product/service…", true)}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="cs-btn cs-btn-primary">
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Brand Settings"}
        </button>
        <div className="flex gap-2 flex-wrap text-xs text-th-text-muted">
          {cfg.brandName && <span className="bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-2 py-0.5">✓ Brand name</span>}
          {cfg.website && <span className="bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-2 py-0.5">✓ Website</span>}
          {cfg.keywords && <span className="bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-2 py-0.5">✓ Keywords</span>}
        </div>
      </div>
    </div>
  );
}

// ── Prompt Hub Panel ──────────────────────────────────────────────────────

interface SuggestGroup { intent: string; description: string; prompts: string[]; }
interface VolumeData { volume: number | null; trend: string; keyword: string; }

function clusterIntent(text: string): string {
  const t = text.toLowerCase();
  if (/\bvs\b|versus|compare|alternative|instead of|better than/.test(t)) return "comparison";
  if (/price|cost|fee|pricing|worth|cheap|expensive|budget/.test(t)) return "pricing";
  if (/review|rating|experience|opinion|feedback|good|bad|best/.test(t)) return "reviews";
  if (/what is|who is|about|overview|explain|tell me|describe/.test(t)) return "awareness";
  return "feature";
}

const CLUSTER_COLORS: Record<string, string> = {
  awareness: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  comparison: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  pricing: "text-green-400 bg-green-500/10 border-green-500/20",
  reviews: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  feature: "text-th-accent bg-th-accent/10 border-th-accent/20",
};

function PromptHubPanel() {
  const [prompts, setPrompts] = useState<AeoPrompt[]>([]);
  const [newPrompt, setNewPrompt] = useState("");
  const [scraping, setScraping] = useState(false);
  const aeoJobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resume any running AEO scrape job on mount
  useEffect(() => {
    fetch("/api/jobs?active=1")
      .then((r) => r.json())
      .then((data: { jobs?: Array<{ id: string; job_type: string; progress: { done?: number; total?: number; log?: string[] } }> }) => {
        const running = data.jobs?.find((j) => j.job_type === "aeo_scrape");
        if (!running) return;
        setScraping(true);
        setProgress({ done: running.progress?.done ?? 0, total: running.progress?.total ?? 0, log: running.progress?.log ?? [] });
        const jobId = running.id;
        const poll = setInterval(async () => {
          try {
            const r = await fetch(`/api/jobs?id=${jobId}`);
            if (!r.ok) return;
            const job = await r.json() as { status: string; progress: { done?: number; total?: number; log?: string[] } };
            setProgress({ done: job.progress.done ?? 0, total: job.progress.total ?? 0, log: job.progress.log ?? [] });
            if (job.status === "done" || job.status === "error") {
              clearInterval(poll);
              setScraping(false);
              if (aeoJobPollRef.current === poll) aeoJobPollRef.current = null;
            }
          } catch { /* ignore */ }
        }, 3000);
        aeoJobPollRef.current = poll;
      })
      .catch(() => {});
    return () => { if (aeoJobPollRef.current) clearInterval(aeoJobPollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [progress, setProgress] = useState<{ done: number; total: number; log: string[] }>({ done: 0, total: 0, log: [] });
  const [providers, setProviders] = useState<string[]>(["chatgpt", "perplexity", "gemini"]);
  const [brandConfigured, setBrandConfigured] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "cluster">("list");
  // Suggest modal
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestGroups, setSuggestGroups] = useState<SuggestGroup[]>([]);
  const [suggestError, setSuggestError] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  // Volume
  const [fetchingVolume, setFetchingVolume] = useState(false);
  const [volumeError, setVolumeError] = useState("");

  const allProviders = Object.keys(PROVIDER_LABELS);

  useEffect(() => {
    fetch("/api/aeo/prompts").then(r => r.json()).then(d => setPrompts(d as AeoPrompt[])).catch(() => {});
    fetch("/api/aeo/config").then(r => r.json()).then((d: AeoBrandConfig) => setBrandConfigured(!!d.brandName?.trim())).catch(() => {});
  }, []);

  async function addPrompt() {
    if (!newPrompt.trim()) return;
    const res = await fetch("/api/aeo/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptText: newPrompt.trim() }) });
    const p = await res.json() as AeoPrompt;
    setPrompts(prev => [...prev, p]);
    setNewPrompt("");
  }

  async function deletePrompt(id: string) {
    await fetch(`/api/aeo/prompts?id=${id}`, { method: "DELETE" });
    setPrompts(prev => prev.filter(p => p.id !== id));
  }

  async function runAll() {
    if (!prompts.length || !providers.length) return;
    setScraping(true);
    setProgress({ done: 0, total: prompts.length * providers.length, log: [] });

    // Submit and get serverJobId immediately — runs in background on server
    let serverJobId: string | null = null;
    try {
      const res = await fetch("/api/aeo/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers }),
      });
      if (!res.ok) { setScraping(false); return; }
      const data = await res.json() as { serverJobId: string; total: number };
      serverJobId = data.serverJobId;
      setProgress({ done: 0, total: data.total, log: [] });
    } catch { setScraping(false); return; }

    if (!serverJobId) { setScraping(false); return; }

    // Poll every 3s for progress updates from server
    const jobId = serverJobId;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs?id=${jobId}`);
        if (!r.ok) return;
        const job = await r.json() as {
          status: string;
          progress: { done?: number; total?: number; log?: string[] };
        };
        setProgress({
          done: job.progress.done ?? 0,
          total: job.progress.total ?? 0,
          log: job.progress.log ?? [],
        });
        if (job.status === "done" || job.status === "error") {
          clearInterval(poll);
          setScraping(false);
        }
      } catch { /* ignore transient errors */ }
    }, 3000);
  }

  async function openSuggest() {
    setShowSuggest(true);
    if (suggestGroups.length) return; // already loaded
    await fetchSuggestions();
  }

  async function fetchSuggestions() {
    setSuggesting(true); setSuggestError("");
    try {
      const res = await fetch("/api/aeo/suggest", { method: "POST" });
      const d = await res.json() as { groups?: SuggestGroup[]; error?: string };
      if (d.error) throw new Error(d.error);
      setSuggestGroups(d.groups ?? []);
    } catch (e) { setSuggestError(e instanceof Error ? e.message : String(e)); }
    setSuggesting(false);
  }

  async function addSelectedSuggestions() {
    const existing = new Set(prompts.map(p => p.promptText.toLowerCase()));
    const toAdd = [...selectedSuggestions].filter(t => !existing.has(t.toLowerCase()));
    for (const text of toAdd) {
      const res = await fetch("/api/aeo/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptText: text }) });
      const p = await res.json() as AeoPrompt;
      setPrompts(prev => [...prev, p]);
    }
    setSelectedSuggestions(new Set());
    setShowSuggest(false);
  }

  async function fetchVolumes() {
    setFetchingVolume(true); setVolumeError("");
    try {
      const res = await fetch("/api/aeo/volume", { method: "POST" });
      const d = await res.json() as { results?: Array<{ id: string; volume: number | null; trend: string; keyword: string }>; error?: string };
      if (d.error) throw new Error(d.error);
      // Merge volume data back into prompts
      setPrompts(prev => prev.map(p => {
        const result = d.results?.find(r => r.id === p.id);
        if (!result) return p;
        return { ...p, volumeData: JSON.stringify({ volume: result.volume, trend: result.trend, keyword: result.keyword }) };
      }));
    } catch (e) { setVolumeError(e instanceof Error ? e.message : String(e)); }
    setFetchingVolume(false);
  }

  function getVolume(p: AeoPrompt): VolumeData | null {
    if (!p.volumeData) return null;
    try { return JSON.parse(p.volumeData) as VolumeData; } catch { return null; }
  }

  function formatVolume(v: number | null): string {
    if (v === null) return "—";
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K/mo`;
    return `${v}/mo`;
  }

  // Cluster view: group prompts by intent
  const clusters = prompts.reduce((acc, p) => {
    const intent = clusterIntent(p.promptText);
    if (!acc[intent]) acc[intent] = [];
    acc[intent].push(p);
    return acc;
  }, {} as Record<string, AeoPrompt[]>);

  const promptRow = (p: AeoPrompt) => {
    const vol = getVolume(p);
    const trendIcon = vol?.trend === "rising" ? "↑" : vol?.trend === "declining" ? "↓" : "";
    const trendColor = vol?.trend === "rising" ? "text-green-400" : vol?.trend === "declining" ? "text-red-400" : "text-th-text-muted";
    return (
      <div key={p.id} className="flex items-center gap-3 rounded-lg border border-th-border bg-th-card-alt px-4 py-2.5">
        <span className="flex-1 text-sm text-th-text">{p.promptText}</span>
        {vol && (
          <span className={`text-xs font-mono shrink-0 ${vol.volume ? "text-th-accent" : "text-th-text-muted"}`}>
            {formatVolume(vol.volume)}
            {trendIcon && <span className={`ml-1 ${trendColor}`}>{trendIcon}</span>}
          </span>
        )}
        <button onClick={() => deletePrompt(p.id)} className="text-th-text-muted hover:text-red-400 text-xs transition-colors shrink-0">✕</button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {!brandConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/8 px-4 py-3 text-sm">
          <span className="text-yellow-400 shrink-0 mt-0.5">⚠</span>
          <span className="text-yellow-300">Brand not configured. Go to <strong>Configuration → Brand & AEO</strong> to set your brand name, keywords, and competitors.</span>
        </div>
      )}

      {/* Provider selector */}
      <div className="rounded-lg border border-th-border bg-th-card-alt p-3 space-y-2">
        <div className="text-xs font-medium text-th-text-muted uppercase tracking-wide">AI Providers to Query</div>
        <div className="flex flex-wrap gap-2">
          {allProviders.map(p => (
            <button key={p} onClick={() => setProviders(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
              className={`px-3 py-1 rounded-full text-xs border transition-all ${providers.includes(p) ? "bg-th-accent/15 border-th-accent/40 text-th-accent" : "border-th-border text-th-text-muted hover:text-th-text"}`}>
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Add prompt row */}
      <div className="flex gap-2">
        <input value={newPrompt} onChange={e => setNewPrompt(e.target.value)} onKeyDown={e => e.key === "Enter" && addPrompt()}
          placeholder="e.g. Best alternatives to {brand} for MBA college search in India"
          className="cs-input flex-1" />
        <button onClick={addPrompt} disabled={!newPrompt.trim()} className="cs-btn cs-btn-primary">Add</button>
        <button onClick={openSuggest} className="cs-btn cs-btn-secondary text-sm whitespace-nowrap">✨ Suggest</button>
      </div>

      {/* Prompt list */}
      {prompts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-th-text-muted">{prompts.length} prompt{prompts.length !== 1 ? "s" : ""}</span>
              {/* View toggle */}
              <div className="flex rounded-lg border border-th-border overflow-hidden text-xs">
                <button onClick={() => setViewMode("list")} className={`px-2.5 py-1 transition-all ${viewMode === "list" ? "bg-th-accent/15 text-th-accent" : "text-th-text-muted hover:text-th-text"}`}>List</button>
                <button onClick={() => setViewMode("cluster")} className={`px-2.5 py-1 border-l border-th-border transition-all ${viewMode === "cluster" ? "bg-th-accent/15 text-th-accent" : "text-th-text-muted hover:text-th-text"}`}>By Intent</button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={fetchVolumes} disabled={fetchingVolume}
                className="cs-btn cs-btn-secondary text-xs whitespace-nowrap">
                {fetchingVolume ? "Fetching…" : "📊 Fetch Volumes"}
              </button>
              <button onClick={runAll} disabled={scraping || !providers.length}
                className="cs-btn cs-btn-primary text-sm">
                {scraping ? `Running… (${progress.done}/${progress.total})` : `▶ Run All × ${providers.length}`}
              </button>
            </div>
          </div>

          {volumeError && <p className="text-xs text-amber-400 bg-amber-500/10 rounded px-3 py-2">{volumeError}</p>}

          {/* Progress log */}
          {scraping && progress.total > 0 && (
            <div className="rounded-lg bg-th-card-alt border border-th-border p-3">
              <div className="flex items-center justify-between mb-2 text-xs text-th-text-muted">
                <span>Progress</span><span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 rounded-full bg-th-border overflow-hidden mb-3">
                <div className="h-full rounded-full bg-th-accent transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <div className="space-y-0.5 max-h-32 overflow-auto">
                {progress.log.map((l, i) => <div key={i} className="text-xs text-th-text-secondary font-mono">{l}</div>)}
              </div>
            </div>
          )}

          {/* List or Cluster view */}
          {viewMode === "list" ? (
            <div className="space-y-1.5">{prompts.map(promptRow)}</div>
          ) : (
            <div className="space-y-4">
              {Object.entries(clusters).map(([intent, items]) => (
                <div key={intent}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${CLUSTER_COLORS[intent] ?? CLUSTER_COLORS.feature}`}>{intent}</span>
                    <span className="text-xs text-th-text-muted">{items.length} prompt{items.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="space-y-1.5 pl-2 border-l-2 border-th-border">{items.map(promptRow)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!prompts.length && (
        <div className="rounded-lg border border-dashed border-th-border py-10 text-center">
          <p className="text-sm text-th-text-muted">No prompts yet.</p>
          <p className="text-xs text-th-text-muted mt-1">Add manually above or click <strong>✨ Suggest</strong> to auto-generate 20 prompts from your brand config.</p>
        </div>
      )}

      {/* ── Suggest Modal ── */}
      {showSuggest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) setShowSuggest(false); }}>
          <div className="w-full max-w-lg rounded-2xl border border-th-border bg-th-card shadow-2xl flex flex-col max-h-[80vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-th-border shrink-0">
              <div>
                <div className="font-semibold text-th-text">✨ AI-Suggested Prompts</div>
                <div className="text-xs text-th-text-muted mt-0.5">Generated from your brand config. Select prompts to add.</div>
              </div>
              <button onClick={() => setShowSuggest(false)} className="text-th-text-muted hover:text-th-text text-lg leading-none">✕</button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
              {suggesting && <div className="py-8 text-center text-sm text-th-text-muted">Generating prompts from your brand config…</div>}
              {suggestError && (
                <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
                  <span>{suggestError}</span>
                  <button onClick={fetchSuggestions} className="shrink-0 text-xs text-red-300 hover:text-red-200 underline whitespace-nowrap">Try again</button>
                </div>
              )}
              {suggestGroups.map(group => (
                <div key={group.intent}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${CLUSTER_COLORS[group.intent] ?? CLUSTER_COLORS.feature}`}>{group.intent}</span>
                    <span className="text-xs text-th-text-muted">{group.description}</span>
                  </div>
                  <div className="space-y-1.5">
                    {group.prompts.map(pt => {
                      const alreadyAdded = prompts.some(p => p.promptText.toLowerCase() === pt.toLowerCase());
                      const checked = selectedSuggestions.has(pt);
                      return (
                        <button key={pt} disabled={alreadyAdded}
                          onClick={() => setSelectedSuggestions(prev => { const s = new Set(prev); s.has(pt) ? s.delete(pt) : s.add(pt); return s; })}
                          className={`w-full flex items-center gap-3 text-left rounded-lg border px-3 py-2 text-sm transition-all ${alreadyAdded ? "border-th-border/30 text-th-text-muted/50 cursor-not-allowed" : checked ? "border-th-accent/40 bg-th-accent/8 text-th-text" : "border-th-border text-th-text-secondary hover:bg-th-card-alt"}`}>
                          <span className={`shrink-0 text-base ${checked ? "text-th-accent" : "text-th-text-muted"}`}>{alreadyAdded ? "✓" : checked ? "☑" : "☐"}</span>
                          <span className="flex-1">{pt}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Modal footer */}
            {suggestGroups.length > 0 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-th-border shrink-0">
                <div className="flex gap-2">
                  <button onClick={() => { const all = new Set(suggestGroups.flatMap(g => g.prompts)); setSelectedSuggestions(all); }} className="text-xs text-th-accent hover:underline">Select all</button>
                  <span className="text-th-text-muted text-xs">·</span>
                  <button onClick={() => setSelectedSuggestions(new Set())} className="text-xs text-th-text-muted hover:underline">Clear</button>
                </div>
                <button onClick={addSelectedSuggestions} disabled={!selectedSuggestions.size}
                  className="cs-btn cs-btn-primary text-sm">
                  Add Selected ({selectedSuggestions.size})
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Responses Panel ───────────────────────────────────────────────────────

interface AccuracyFlags { accurate: boolean; issues: string[]; checkedAt: string; }

function parseAccuracyFlags(raw: string): AccuracyFlags | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as AccuracyFlags; } catch { return null; }
}

function ResponsesPanel() {
  const [runs, setRuns] = useState<AeoRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<"all" | "mentioned" | "not">("all");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [checking, setChecking] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/aeo/runs?limit=200")
      .then(r => r.json())
      .then(d => { setRuns(d as AeoRun[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function checkAccuracy(runId: string) {
    setChecking(prev => new Set([...prev, runId]));
    try {
      const res = await fetch("/api/aeo/accuracy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const d = await res.json() as { results?: Array<{ runId: string; accurate: boolean; issues: string[] }>; error?: string };
      if (d.results?.length) {
        const result = d.results[0];
        setRuns(prev => prev.map(r => r.id === runId
          ? { ...r, accuracyFlags: JSON.stringify({ accurate: result.accurate, issues: result.issues, checkedAt: new Date().toISOString() }) }
          : r
        ));
      }
    } catch { /* silent */ }
    setChecking(prev => { const s = new Set(prev); s.delete(runId); return s; });
  }

  const providers = ["all", ...Array.from(new Set(runs.map(r => r.provider)))];
  const filtered = runs.filter(r => {
    if (filter !== "all" && r.provider !== filter) return false;
    if (brandFilter === "mentioned" && !r.brandMentioned) return false;
    if (brandFilter === "not" && r.brandMentioned) return false;
    if (issuesOnly) {
      const flags = parseAccuracyFlags(r.accuracyFlags);
      if (!flags || flags.accurate || !flags.issues.length) return false;
    }
    return true;
  });

  if (loading) return <div className="py-8 text-center text-sm text-th-text-muted">Loading responses…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 rounded-lg border border-th-border bg-th-card-alt p-0.5">
          {providers.map(p => (
            <button key={p} onClick={() => setFilter(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${filter === p ? "bg-th-card text-th-accent shadow-sm" : "text-th-text-muted hover:text-th-text"}`}>
              {p === "all" ? "All Providers" : PROVIDER_LABELS[p] ?? p}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-th-border bg-th-card-alt p-0.5">
          {(["all", "mentioned", "not"] as const).map(v => (
            <button key={v} onClick={() => setBrandFilter(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${brandFilter === v ? "bg-th-card text-th-accent shadow-sm" : "text-th-text-muted hover:text-th-text"}`}>
              {v === "all" ? "All" : v === "mentioned" ? "Brand Mentioned" : "Not Mentioned"}
            </button>
          ))}
        </div>
        <button onClick={() => setIssuesOnly(!issuesOnly)}
          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${issuesOnly ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-th-border text-th-text-muted hover:text-th-text"}`}>
          ⚠ Issues Only
        </button>
        <span className="text-xs text-th-text-muted ml-auto">{filtered.length} responses</span>
      </div>

      {!filtered.length && <div className="py-8 text-center text-sm text-th-text-muted">No responses match the current filters.</div>}

      <div className="space-y-2">
        {filtered.map(r => {
          const flags = parseAccuracyFlags(r.accuracyFlags);
          const isChecking = checking.has(r.id);

          return (
            <div key={r.id} className="rounded-lg border border-th-border bg-th-card-alt">
              <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-th-card transition-colors">
                <span className="text-xs bg-th-card border border-th-border rounded px-2 py-0.5 font-medium text-th-text-muted shrink-0">{PROVIDER_LABELS[r.provider] ?? r.provider}</span>
                <span className="flex-1 text-sm text-th-text line-clamp-1">{r.promptText}</span>
                <span className={`text-xs font-bold shrink-0 ${r.visibilityScore >= 50 ? "text-green-400" : "text-yellow-400"}`}>{r.visibilityScore}</span>
                <span className={`text-xs shrink-0 ${SENTIMENT_COLORS[r.sentiment] ?? "text-th-text-muted"}`}>{r.sentiment}</span>
                <span className={`text-xs shrink-0 ${r.brandMentioned ? "text-green-400" : "text-red-400"}`}>{r.brandMentioned ? "✓" : "✗"}</span>
                {/* Accuracy badge */}
                {r.brandMentioned && (
                  flags === null
                    ? <span className="text-[10px] text-th-text-muted shrink-0">— unchecked</span>
                    : flags.accurate
                      ? <span className="text-[10px] text-green-400 shrink-0">✓ accurate</span>
                      : <span className="text-[10px] text-amber-400 shrink-0">⚠ {flags.issues.length} issue{flags.issues.length !== 1 ? "s" : ""}</span>
                )}
                <span className="text-xs text-th-text-muted shrink-0">{expanded === r.id ? "▲" : "▼"}</span>
              </button>
              {expanded === r.id && (
                <div className="border-t border-th-border px-4 py-3 space-y-3">
                  <div className="text-sm text-th-text-secondary leading-relaxed prose-sm max-h-64 overflow-auto">{r.answer}</div>

                  {/* Accuracy section */}
                  {r.brandMentioned && (
                    <div className="rounded-lg border border-th-border bg-th-card p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-th-text-muted uppercase tracking-wide">Brand Accuracy</span>
                        {flags === null && (
                          <button onClick={(e) => { e.stopPropagation(); checkAccuracy(r.id); }} disabled={isChecking}
                            className="text-xs text-th-accent hover:underline disabled:opacity-50">
                            {isChecking ? "Checking…" : "Check Accuracy"}
                          </button>
                        )}
                      </div>
                      {flags === null && !isChecking && (
                        <p className="text-xs text-th-text-muted">Click "Check Accuracy" to verify what the AI said against your brand config.</p>
                      )}
                      {isChecking && <p className="text-xs text-th-text-muted">Analysing response against your brand description…</p>}
                      {flags !== null && flags.accurate && (
                        <p className="text-xs text-green-400">✓ No factual issues found. The AI's description aligns with your brand config.</p>
                      )}
                      {flags !== null && !flags.accurate && flags.issues.length > 0 && (
                        <ul className="space-y-1.5">
                          {flags.issues.map((issue, i) => (
                            <li key={i} className="flex gap-2 text-xs">
                              <span className="text-amber-400 shrink-0">⚠</span>
                              <span className="text-th-text-secondary">{issue}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {r.sources.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-th-text-muted mb-1">Sources ({r.sources.length})</div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.sources.slice(0, 8).map((s, i) => (
                          <a key={i} href={s} target="_blank" rel="noreferrer"
                            className="text-xs text-th-accent hover:underline bg-th-card px-2 py-0.5 rounded border border-th-border">
                            {(() => { try { return new URL(s).hostname; } catch { return s.slice(0, 40); } })()}
                          </a>
                        ))}
                        {r.sources.length > 8 && <span className="text-xs text-th-text-muted">+{r.sources.length - 8} more</span>}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-th-text-muted">{new Date(r.createdAt).toLocaleString()}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Visibility Analytics Panel ────────────────────────────────────────────

function VisibilityAnalyticsPanel() {
  const [runs, setRuns] = useState<AeoRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/aeo/runs?limit=500").then(r => r.json()).then(d => { setRuns(d as AeoRun[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-th-text-muted">Loading analytics…</div>;
  if (!runs.length) return <div className="py-8 text-center text-sm text-th-text-muted">No run data yet. Run prompts from Prompt Hub first.</div>;

  const totalRuns = runs.length;
  const mentioned = runs.filter(r => r.brandMentioned).length;
  const avgScore = Math.round(runs.reduce((s, r) => s + r.visibilityScore, 0) / totalRuns);
  const sentimentCounts = runs.reduce((acc, r) => { acc[r.sentiment] = (acc[r.sentiment] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  // Score by provider
  const byProvider: Record<string, { scores: number[]; mentioned: number }> = {};
  for (const r of runs) {
    if (!byProvider[r.provider]) byProvider[r.provider] = { scores: [], mentioned: 0 };
    byProvider[r.provider].scores.push(r.visibilityScore);
    if (r.brandMentioned) byProvider[r.provider].mentioned++;
  }
  const providerStats = Object.entries(byProvider).map(([p, d]) => ({
    provider: p, avg: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length), count: d.scores.length, mentionRate: Math.round((d.mentioned / d.scores.length) * 100),
  })).sort((a, b) => b.avg - a.avg);

  function exportCsv() {
    const rows = [["Provider", "Prompt", "Score", "Sentiment", "Brand Mentioned", "Date"]];
    for (const r of runs) rows.push([r.provider, `"${r.promptText.replace(/"/g, '""')}"`, String(r.visibilityScore), r.sentiment, r.brandMentioned ? "Yes" : "No", r.createdAt]);
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "aeo-visibility.csv"; a.click();
  }

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Share of Voice", value: `${Math.round((mentioned / totalRuns) * 100)}%`, sub: "brand mention rate" },
          { label: "Avg Score", value: avgScore, sub: `${totalRuns} total runs` },
          { label: "Positive Sentiment", value: `${Math.round(((sentimentCounts.positive ?? 0) / totalRuns) * 100)}%`, sub: "of all responses" },
          { label: "Neutral / Negative", value: `${Math.round(((sentimentCounts.negative ?? 0) / totalRuns) * 100)}%`, sub: "need improvement" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-th-border bg-th-card p-4 text-center">
            <div className="text-2xl font-bold text-th-accent">{k.value}</div>
            <div className="text-xs font-medium text-th-text mt-1">{k.label}</div>
            <div className="text-[11px] text-th-text-muted mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Sentiment breakdown */}
      <div className="rounded-xl border border-th-border bg-th-card p-4">
        <div className="text-sm font-semibold text-th-text mb-3">Sentiment Breakdown</div>
        <div className="space-y-2">
          {(["positive", "neutral", "negative"] as const).map(s => {
            const count = sentimentCounts[s] ?? 0;
            const pct = Math.round((count / totalRuns) * 100);
            return (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span className={`w-16 capitalize ${SENTIMENT_COLORS[s]}`}>{s}</span>
                <div className="flex-1 h-2 bg-th-card-alt rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s === "positive" ? "var(--th-success)" : s === "negative" ? "var(--th-danger)" : "var(--th-text-muted)" }} />
                </div>
                <span className="text-xs text-th-text-muted w-12 text-right">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-provider stats */}
      <div className="rounded-xl border border-th-border bg-th-card p-4">
        <div className="text-sm font-semibold text-th-text mb-3">Score by Provider</div>
        <div className="space-y-2">
          {providerStats.map(s => (
            <div key={s.provider} className="flex items-center gap-3 text-sm">
              <span className="w-24 text-th-text-secondary">{PROVIDER_LABELS[s.provider] ?? s.provider}</span>
              <div className="flex-1 h-2 bg-th-card-alt rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-th-accent transition-all" style={{ width: `${s.avg}%` }} />
              </div>
              <span className="text-xs font-bold text-th-accent w-8 text-right">{s.avg}</span>
              <span className="text-xs text-th-text-muted w-24 text-right">{s.mentionRate}% mention</span>
            </div>
          ))}
        </div>
      </div>

      <button onClick={exportCsv} className="cs-btn cs-btn-secondary text-sm">Export CSV</button>
    </div>
  );
}

// ── Citations Panel ───────────────────────────────────────────────────────

function CitationsPanel() {
  const [runs, setRuns] = useState<AeoRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/aeo/runs?limit=500").then(r => r.json()).then(d => { setRuns(d as AeoRun[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-th-text-muted">Loading citations…</div>;
  if (!runs.length) return <div className="py-8 text-center text-sm text-th-text-muted">No data yet. Run prompts from Prompt Hub first.</div>;

  const domainCounts: Record<string, { count: number; urls: Set<string> }> = {};
  for (const r of runs) {
    for (const src of r.sources) {
      try {
        const host = new URL(src).hostname.replace(/^www\./, "");
        if (!domainCounts[host]) domainCounts[host] = { count: 0, urls: new Set() };
        domainCounts[host].count++;
        domainCounts[host].urls.add(src);
      } catch { /* skip */ }
    }
  }
  const sorted = Object.entries(domainCounts).sort((a, b) => b[1].count - a[1].count).slice(0, 50);

  return (
    <div className="space-y-3">
      <p className="text-sm text-th-text-secondary">Domains most frequently cited by AI models across all your tracked prompts.</p>
      {!sorted.length && <div className="py-8 text-center text-sm text-th-text-muted">No citations found in responses.</div>}
      <div className="space-y-1.5">
        {sorted.map(([domain, data], i) => (
          <div key={domain} className="flex items-center gap-3 rounded-lg border border-th-border bg-th-card-alt px-4 py-2.5">
            <span className="text-xs text-th-text-muted w-6 text-right">{i + 1}</span>
            <span className="flex-1 text-sm text-th-text">{domain}</span>
            <span className="text-xs text-th-text-muted">{data.urls.size} URL{data.urls.size !== 1 ? "s" : ""}</span>
            <span className="text-sm font-bold text-th-accent">{data.count}×</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Citation Opportunities Panel ──────────────────────────────────────────

function CitationOpportunitiesPanel() {
  const [runs, setRuns] = useState<AeoRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/aeo/runs?limit=500").then(r => r.json()).then(d => { setRuns(d as AeoRun[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-th-text-muted">Loading…</div>;
  if (!runs.length) return <div className="py-8 text-center text-sm text-th-text-muted">No data yet. Run prompts from Prompt Hub first.</div>;

  // Domains cited in runs where brand was NOT mentioned
  const opportunityDomains: Record<string, { count: number; prompts: Set<string> }> = {};
  for (const r of runs.filter(x => !x.brandMentioned)) {
    for (const src of r.sources) {
      try {
        const host = new URL(src).hostname.replace(/^www\./, "");
        if (!opportunityDomains[host]) opportunityDomains[host] = { count: 0, prompts: new Set() };
        opportunityDomains[host].count++;
        opportunityDomains[host].prompts.add(r.promptText);
      } catch { /* skip */ }
    }
  }
  const sorted = Object.entries(opportunityDomains).sort((a, b) => b[1].count - a[1].count).slice(0, 40);

  return (
    <div className="space-y-3">
      <p className="text-sm text-th-text-secondary">These domains are cited by AI models in responses where your brand was <strong className="text-red-400">NOT mentioned</strong>. Getting referenced on these sites could improve your visibility.</p>
      {!sorted.length && <div className="py-6 text-center text-sm text-th-text-muted">No citation opportunities found — or your brand was mentioned in every response!</div>}
      <div className="space-y-1.5">
        {sorted.map(([domain, data], i) => (
          <div key={domain} className="flex items-start gap-3 rounded-lg border border-th-border bg-th-card-alt px-4 py-2.5">
            <span className="text-xs text-th-text-muted w-6 text-right mt-0.5">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-th-text">{domain}</div>
              <div className="text-xs text-th-text-muted mt-0.5 line-clamp-1">{Array.from(data.prompts).slice(0, 2).join(" · ")}</div>
            </div>
            <span className="text-xs text-th-text-muted shrink-0">{data.prompts.size} prompt{data.prompts.size !== 1 ? "s" : ""}</span>
            <span className="text-sm font-bold text-red-400 shrink-0">{data.count}×</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Competitor Intelligence Panel ────────────────────────────────────────

interface CompetitorKeyword { text: string; type: "organic" | "ai_prompt"; volume: number | null; trend: string; tracked: boolean; }
interface CompetitorResearchResult { id: string; domain: string; url: string; industry: string; brand: string; keywords: CompetitorKeyword[]; totalVolume: number; analyzedAt: string; warning?: string; }
interface CompetitorResearchSummary { domain: string; brand: string; totalVolume: number; keywordCount: number; analyzedAt: string; }

interface CompetitorStat {
  name: string; sovPct: number; appearanceCount: number; totalRuns: number;
  byProvider: Record<string, { appearances: number; total: number; pct: number }>;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  promptsAppearing: string[]; gapPrompts: string[];
}
interface CompetitorIntelResponse {
  brandSov: number; brandAppearances: number; totalRuns: number;
  competitors: CompetitorStat[]; allPrompts: string[];
  promptMatrix: Array<{ promptText: string; brandMentioned: boolean; competitorsPresent: string[]; providers: string[] }>;
}

function fmtVol(v: number | null): string {
  if (v === null || v === 0) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
}
function trendIcon(t: string) {
  if (t === "rising") return <span className="text-green-400 font-bold">↑</span>;
  if (t === "declining") return <span className="text-red-400 font-bold">↓</span>;
  if (t === "stable") return <span className="text-th-text-muted">→</span>;
  return <span className="text-th-text-muted/40">—</span>;
}

function CompetitorIntelligencePanel() {
  const [view, setView] = useState<"research" | "coverage">("research");

  // ── Website Research state ──
  const [yourSite, setYourSite] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([""]);
  const [runningAll, setRunningAll] = useState(false);
  const [runErrors, setRunErrors] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [sites, setSites] = useState<CompetitorResearchSummary[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [siteData, setSiteData] = useState<CompetitorResearchResult | null>(null);
  const [loadingSite, setLoadingSite] = useState(false);
  const [filter, setFilter] = useState<"all" | "ai_prompt" | "organic" | "untapped">("all");
  const [addedLocal, setAddedLocal] = useState<Set<string>>(new Set());
  const [brandWebsite, setBrandWebsite] = useState("");

  // ── AI Coverage state ──
  const [coverageData, setCoverageData] = useState<CompetitorIntelResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState("");
  const [selectedComp, setSelectedComp] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("Your Brand");

  useEffect(() => {
    fetch("/api/aeo/config").then(r => r.json())
      .then((d: AeoBrandConfig) => {
        if (d.brandName) setBrandName(d.brandName);
        if (d.website) { setBrandWebsite(d.website); setYourSite(d.website); }
      }).catch(() => {});
    fetch("/api/aeo/competitor-research")
      .then(r => r.json())
      .then((d: { sites?: CompetitorResearchSummary[] }) => {
        if (d.sites?.length) {
          setSites(d.sites);
          setSelectedDomain(d.sites[0].domain);
          loadSiteData(d.sites[0].domain);
        }
      }).catch(() => {});
  }, []);

  async function loadSiteData(domain: string) {
    setLoadingSite(true); setSiteData(null);
    try {
      const res = await fetch(`/api/aeo/competitor-research?domain=${encodeURIComponent(domain)}`);
      const d = await res.json() as CompetitorResearchResult | { error: string };
      if ("error" in d) { setLoadingSite(false); return; }
      setSiteData(d);
    } catch { /* silent */ }
    setLoadingSite(false);
  }

  async function analyzeSingle(url: string): Promise<CompetitorResearchResult | null> {
    const res = await fetch("/api/aeo/competitor-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const d = await res.json() as CompetitorResearchResult | { error: string };
    if ("error" in d) throw new Error(d.error);
    return d;
  }

  async function analyze() {
    const url = yourSite.trim() || brandWebsite.trim();
    if (!url) return;
    setAnalyzing(true); setAnalyzeError("");
    try {
      const d = await analyzeSingle(url);
      if (!d) { setAnalyzing(false); return; }
      setSiteData(d);
      setSelectedDomain(d.domain);
      setSites(prev => {
        const without = prev.filter(s => s.domain !== d.domain);
        return [{ domain: d.domain, brand: d.brand, totalVolume: d.totalVolume, keywordCount: d.keywords.length, analyzedAt: d.analyzedAt }, ...without];
      });
      setFilter("all");
    } catch (e) { setAnalyzeError(e instanceof Error ? e.message : "Analysis failed."); }
    setAnalyzing(false);
  }

  async function runAll() {
    const urls = [yourSite.trim(), ...competitors.map(c => c.trim())].filter(Boolean);
    if (!urls.length) return;
    setRunningAll(true); setRunErrors([]); setAnalyzeError("");
    const results = await Promise.allSettled(urls.map(u => analyzeSingle(u)));
    const errors: string[] = [];
    let firstResult: CompetitorResearchResult | null = null;
    setSites(prev => {
      let updated = [...prev];
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value) {
          const d = r.value;
          if (!firstResult) firstResult = d;
          const without = updated.filter(s => s.domain !== d.domain);
          updated = [{ domain: d.domain, brand: d.brand, totalVolume: d.totalVolume, keywordCount: d.keywords.length, analyzedAt: d.analyzedAt }, ...without];
        } else if (r.status === "rejected") {
          errors.push(`${urls[i]}: ${r.reason instanceof Error ? r.reason.message : "Failed"}`);
        }
      });
      return updated;
    });
    if (firstResult) { setSiteData(firstResult); setSelectedDomain((firstResult as CompetitorResearchResult).domain); }
    if (errors.length) setRunErrors(errors);
    setRunningAll(false);
  }

  async function deleteSite(domain: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/aeo/competitor-research?domain=${encodeURIComponent(domain)}`, { method: "DELETE" });
    setSites(prev => prev.filter(s => s.domain !== domain));
    if (selectedDomain === domain) { setSiteData(null); setSelectedDomain(null); }
  }

  async function selectSite(domain: string) {
    setSelectedDomain(domain);
    setFilter("all");
    if (siteData?.domain === domain) return;
    loadSiteData(domain);
  }

  async function addToPrompts(keyword: string) {
    try {
      await fetch("/api/aeo/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: keyword }),
      });
      setAddedLocal(prev => new Set(prev).add(keyword));
      // Mark as tracked in current site data
      setSiteData(prev => prev ? {
        ...prev,
        keywords: prev.keywords.map(k => k.text === keyword ? { ...k, tracked: true } : k),
      } : prev);
    } catch { /* silent */ }
  }

  function loadCoverage() {
    if (coverageData || coverageLoading) return;
    setCoverageLoading(true); setCoverageError("");
    fetch("/api/aeo/competitors").then(r => r.json())
      .then((d: CompetitorIntelResponse | { error: string }) => {
        if ("error" in d) { setCoverageError(d.error); } else { setCoverageData(d); if (d.competitors.length) setSelectedComp(d.competitors[0].name); }
        setCoverageLoading(false);
      }).catch(() => { setCoverageError("Failed to load."); setCoverageLoading(false); });
  }

  const filteredKeywords = siteData?.keywords.filter(k => {
    if (filter === "ai_prompt") return k.type === "ai_prompt";
    if (filter === "organic") return k.type === "organic";
    if (filter === "untapped") return !k.tracked;
    return true;
  }) ?? [];

  const untappedCount = siteData?.keywords.filter(k => !k.tracked).length ?? 0;
  const aiPromptCount = siteData?.keywords.filter(k => k.type === "ai_prompt").length ?? 0;
  const organicCount = siteData?.keywords.filter(k => k.type === "organic").length ?? 0;

  const coverageComp = coverageData?.competitors.find(c => c.name === selectedComp);
  const maxSov = coverageData ? Math.max(coverageData.brandSov, ...coverageData.competitors.map(c => c.sovPct), 1) : 1;

  return (
    <div className="space-y-4">
      {/* ── Tab switcher ── */}
      <div className="flex gap-1 border-b border-th-border pb-0">
        <button onClick={() => setView("research")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-all ${view === "research" ? "border-th-accent text-th-accent" : "border-transparent text-th-text-muted hover:text-th-text"}`}>
          Website Intelligence
        </button>
        <button onClick={() => { setView("coverage"); loadCoverage(); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-all ${view === "coverage" ? "border-th-accent text-th-accent" : "border-transparent text-th-text-muted hover:text-th-text"}`}>
          AI Response Coverage
        </button>
      </div>

      {/* ══════════ WEBSITE INTELLIGENCE TAB ══════════ */}
      {view === "research" && (
        <div className="space-y-4">

          {/* ── SEMrush-style landing (shown when no sites analyzed yet) ── */}
          {sites.length === 0 && !runningAll && (
            <div className="rounded-2xl border border-th-border bg-gradient-to-b from-th-card to-th-card-alt p-8 text-center space-y-6">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-th-text-muted">AI Competitor Gap Analysis</div>
                <h2 className="text-2xl font-bold text-th-text">Find the Gaps in Your AI Visibility</h2>
                <p className="text-sm text-th-text-muted max-w-lg mx-auto">
                  See how AI platforms position your competitors vs your brand. Compare keyword overlap and uncover prompts where rivals get cited — but you don&apos;t.
                </p>
              </div>

              <div className="max-w-lg mx-auto space-y-2 text-left">
                {/* You row */}
                <div className="flex items-center gap-2 rounded-xl border border-th-accent/30 bg-th-accent/5 px-4 py-3">
                  <span className="text-xs font-bold bg-th-accent text-white rounded px-1.5 py-0.5 shrink-0">You</span>
                  <input
                    value={yourSite}
                    onChange={e => setYourSite(e.target.value)}
                    placeholder={brandWebsite || "your-domain.com"}
                    className="flex-1 bg-transparent text-sm text-th-text outline-none placeholder:text-th-text-muted/50"
                  />
                </div>

                {/* Competitor rows */}
                {competitors.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl border border-th-border bg-th-card px-4 py-3">
                    <span className="w-2 h-2 rounded-full bg-th-text-muted/40 shrink-0" />
                    <input
                      value={c}
                      onChange={e => setCompetitors(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                      placeholder="Add competitor (e.g. shiksha.com)"
                      className="flex-1 bg-transparent text-sm text-th-text outline-none placeholder:text-th-text-muted/40"
                    />
                    {competitors.length > 1 && (
                      <button onClick={() => setCompetitors(prev => prev.filter((_, j) => j !== i))}
                        className="text-th-text-muted hover:text-red-400 text-lg leading-none">×</button>
                    )}
                  </div>
                ))}

                {/* Add / Run row */}
                <div className="flex items-center justify-between pt-1">
                  {competitors.length < 3 ? (
                    <button onClick={() => setCompetitors(prev => [...prev, ""])}
                      className="text-sm text-th-accent hover:underline font-medium">
                      + Add up to {3 - competitors.length} more competitor{3 - competitors.length !== 1 ? "s" : ""}
                    </button>
                  ) : <span />}
                  <button
                    onClick={runAll}
                    disabled={!yourSite.trim() && !brandWebsite.trim()}
                    className="cs-btn cs-btn-primary px-6">
                    Run competitor analysis
                  </button>
                </div>

                {analyzeError && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{analyzeError}</div>}
              </div>
            </div>
          )}

          {/* ── Running state ── */}
          {runningAll && (
            <div className="rounded-2xl border border-th-border bg-th-card p-12 text-center space-y-3">
              <div className="text-2xl animate-pulse">🔍</div>
              <div className="text-sm font-medium text-th-text">Analyzing sites with DataForSEO…</div>
              <div className="text-xs text-th-text-muted">Fetching real keyword data for each domain. This takes ~5 seconds per site.</div>
            </div>
          )}

          {/* ── Results: analyzed sites chips + re-run option ── */}
          {sites.length > 0 && !runningAll && (
            <div className="flex items-center gap-2 flex-wrap">
              {sites.map(site => (
                <button key={site.domain} onClick={() => selectSite(site.domain)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selectedDomain === site.domain ? "bg-th-accent/10 border-th-accent/40 text-th-accent font-medium" : "border-th-border text-th-text-secondary hover:bg-th-card-alt"}`}>
                  <span>{site.brand || site.domain}</span>
                  {site.totalVolume > 0 && <span className="text-[10px] opacity-60">{fmtVol(site.totalVolume)}/mo</span>}
                  <span onClick={e => deleteSite(site.domain, e)} className="ml-0.5 text-th-text-muted hover:text-red-400 leading-none">×</span>
                </button>
              ))}
              <button onClick={() => setSites([])} className="text-xs text-th-text-muted hover:text-th-accent ml-auto">↩ New analysis</button>
            </div>
          )}

          {/* Errors */}
          {runErrors.length > 0 && (
            <div className="space-y-1">
              {runErrors.map((e, i) => <div key={i} className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-1.5">{e}</div>)}
            </div>
          )}

          {/* Loading */}
          {loadingSite && (
            <div className="py-8 text-center text-sm text-th-text-muted">Loading keyword data…</div>
          )}

          {/* Site data */}
          {siteData && !loadingSite && (
            <div className="space-y-4">
              {/* Site header */}
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-semibold text-th-text">{siteData.brand}</div>
                  <div className="text-xs text-th-text-muted">{siteData.domain} · {siteData.industry} · analyzed {new Date(siteData.analyzedAt).toLocaleDateString()}</div>
                </div>
              </div>
              {siteData.warning && (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  ⚠ {siteData.warning}
                </div>
              )}

              {/* KPI cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-th-border bg-th-card-alt p-3 text-center">
                  <div className="text-xl font-bold text-th-text">{siteData.keywords.length}</div>
                  <div className="text-xs text-th-text-muted mt-0.5">Total Queries</div>
                </div>
                <div className="rounded-lg border border-th-border bg-th-card-alt p-3 text-center">
                  <div className="text-xl font-bold text-th-accent">{fmtVol(siteData.totalVolume)}</div>
                  <div className="text-xs text-th-text-muted mt-0.5">Monthly Volume</div>
                </div>
                <div className="rounded-lg border border-th-border bg-th-card-alt p-3 text-center">
                  <div className="text-xl font-bold text-purple-400">{aiPromptCount}</div>
                  <div className="text-xs text-th-text-muted mt-0.5">AI Prompts</div>
                </div>
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center">
                  <div className="text-xl font-bold text-red-400">{untappedCount}</div>
                  <div className="text-xs text-th-text-muted mt-0.5">Not Tracked</div>
                </div>
              </div>

              {/* Filter tabs */}
              <div className="flex gap-1 flex-wrap">
                {([
                  ["all", `All ${siteData.keywords.length}`],
                  ["ai_prompt", `AI Prompts ${aiPromptCount}`],
                  ["organic", `SEO Queries ${organicCount}`],
                  ["untapped", `Untapped ${untappedCount}`],
                ] as const).map(([f, label]) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs border transition-all ${filter === f ? "bg-th-accent/10 border-th-accent/40 text-th-accent font-medium" : "border-th-border text-th-text-muted hover:text-th-text"}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Keyword table */}
              <div className="rounded-xl border border-th-border bg-th-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-th-border bg-th-card-alt">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-th-text-muted uppercase tracking-wide">Query / Keyword</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-th-text-muted uppercase tracking-wide whitespace-nowrap">Vol/mo</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-th-text-muted uppercase tracking-wide">Trend</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-th-text-muted uppercase tracking-wide">Type</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-th-text-muted uppercase tracking-wide">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKeywords.map((kw, i) => (
                        <tr key={i} className={`border-b border-th-border/50 hover:bg-th-card-alt/50 transition-colors ${!kw.tracked ? "bg-red-500/2" : ""}`}>
                          <td className="px-4 py-2.5 text-th-text leading-snug">{kw.text}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`text-sm font-semibold ${kw.volume && kw.volume > 0 ? "text-th-text" : "text-th-text-muted/40"}`}>
                              {fmtVol(kw.volume)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-sm">{trendIcon(kw.trend)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${kw.type === "ai_prompt" ? "border-purple-500/30 bg-purple-500/10 text-purple-400" : "border-blue-500/30 bg-blue-500/10 text-blue-400"}`}>
                              {kw.type === "ai_prompt" ? "AI" : "SEO"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {kw.tracked ? (
                              <span className="text-[10px] text-green-400 font-semibold">✓ tracked</span>
                            ) : (
                              <button onClick={() => addToPrompts(kw.text)}
                                className="text-[11px] text-th-accent hover:text-th-accent/80 font-semibold whitespace-nowrap hover:underline">
                                + Add
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filteredKeywords.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-th-text-muted">No keywords match this filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Opportunity callout */}
              {untappedCount > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                  <strong>{untappedCount} untapped queries</strong> drive traffic to {siteData.brand} but you&apos;re not tracking them.
                  Click <strong>Untapped</strong> filter → <strong>+ Add</strong> to start monitoring them in Prompt Hub.
                </div>
              )}
            </div>
          )}

          {/* Empty: sites analyzed but none selected */}
          {!siteData && !loadingSite && sites.length > 0 && (
            <div className="rounded-lg border border-dashed border-th-border py-10 text-center text-sm text-th-text-muted">
              Select a site above to view its keyword data.
            </div>
          )}
        </div>
      )}

      {/* ══════════ AI RESPONSE COVERAGE TAB ══════════ */}
      {view === "coverage" && (
        <div className="space-y-5">
          {coverageLoading && <div className="py-12 text-center text-sm text-th-text-muted">Loading AI coverage data…</div>}
          {coverageError && <div className="py-8 rounded-lg border border-th-border bg-th-card-alt text-center text-sm text-th-text-muted">{coverageError}</div>}
          {coverageData && (
            <>
              {/* SOV bars */}
              <div className="rounded-xl border border-th-border bg-th-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold text-th-text">Share of Voice in AI Responses</div>
                  <div className="text-xs text-th-text-muted">{coverageData.totalRuns} responses analyzed</div>
                </div>
                <div className="space-y-3">
                  {[{ name: brandName, sov: coverageData.brandSov, isYou: true }, ...coverageData.competitors.map(c => ({ name: c.name, sov: c.sovPct, isYou: false }))].map(row => (
                    <div key={row.name} className="flex items-center gap-3">
                      <div className="w-28 shrink-0 text-sm truncate" style={{ color: row.isYou ? "var(--th-accent)" : "var(--th-text-secondary)" }}>
                        {row.name} {row.isYou && <span className="text-[10px] opacity-60">(you)</span>}
                      </div>
                      <div className="flex-1 h-3 bg-th-card-alt rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${(row.sov / maxSov) * 100}%`, backgroundColor: row.isYou ? "var(--th-accent)" : "var(--th-text-muted)" }} />
                      </div>
                      <div className={`text-sm font-bold w-10 text-right shrink-0 ${row.isYou ? "text-th-accent" : row.sov > coverageData.brandSov ? "text-red-400" : "text-th-text-secondary"}`}>
                        {row.sov}%
                      </div>
                      {!row.isYou && row.sov > coverageData.brandSov && <span className="text-[10px] text-red-400 shrink-0">▲</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Competitor drill-down */}
              {coverageData.competitors.length > 0 && (
                <div className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {coverageData.competitors.map(c => (
                      <button key={c.name} onClick={() => setSelectedComp(c.name)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${selectedComp === c.name ? "bg-th-accent/10 border-th-accent/40 text-th-accent font-medium" : "border-th-border text-th-text-secondary hover:bg-th-card-alt"}`}>
                        {c.name} <span className={`ml-1.5 text-xs font-bold ${c.sovPct > coverageData.brandSov ? "text-red-400" : "text-green-400"}`}>{c.sovPct}%</span>
                      </button>
                    ))}
                  </div>
                  {coverageComp && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-th-border bg-th-card-alt p-3 text-center">
                          <div className={`text-xl font-bold ${coverageComp.sovPct > coverageData.brandSov ? "text-red-400" : "text-green-400"}`}>{coverageComp.sovPct}%</div>
                          <div className="text-xs text-th-text-muted mt-0.5">Their SOV</div>
                          <div className="text-xs text-th-text-muted">{coverageComp.sovPct > coverageData.brandSov ? `+${coverageComp.sovPct - coverageData.brandSov}% ahead` : `${coverageData.brandSov - coverageComp.sovPct}% behind you`}</div>
                        </div>
                        <div className="rounded-lg border border-th-border bg-th-card-alt p-3 text-center">
                          <div className="text-xl font-bold text-red-400">{coverageComp.gapPrompts.length}</div>
                          <div className="text-xs text-th-text-muted mt-0.5">Gap Prompts</div>
                          <div className="text-xs text-th-text-muted">they appear, you don&apos;t</div>
                        </div>
                        <div className="rounded-lg border border-th-border bg-th-card-alt p-3 text-center">
                          <div className="text-xl font-bold text-green-400">{coverageComp.sentimentBreakdown.positive}</div>
                          <div className="text-xs text-th-text-muted mt-0.5">Positive Mentions</div>
                          <div className="text-xs text-th-text-muted">of {coverageComp.appearanceCount} total</div>
                        </div>
                      </div>
                      {coverageComp.gapPrompts.length > 0 && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                          <div className="text-sm font-semibold text-red-400 mb-2">{coverageComp.name} surfaces here — you don&apos;t ({coverageComp.gapPrompts.length} prompts)</div>
                          <div className="space-y-1.5">
                            {coverageComp.gapPrompts.map((p, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm">
                                <span className="text-red-400 shrink-0 mt-0.5">✗</span>
                                <span className="text-th-text-secondary">{p}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Prompt coverage matrix */}
              {coverageData.promptMatrix.length > 0 && (
                <div className="rounded-xl border border-th-border bg-th-card p-4">
                  <div className="text-sm font-semibold text-th-text mb-3">Prompt Coverage Matrix</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-th-border">
                          <th className="text-left py-2 pr-3 text-th-text-muted font-medium w-64">Prompt</th>
                          <th className="text-center py-2 px-2 text-th-accent font-medium whitespace-nowrap">{brandName}</th>
                          {coverageData.competitors.map(c => (
                            <th key={c.name} className="text-center py-2 px-2 text-th-text-muted font-medium whitespace-nowrap">{c.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {coverageData.promptMatrix.map((row, i) => (
                          <tr key={i} className={`border-b border-th-border/50 ${!row.brandMentioned ? "bg-red-500/3" : ""}`}>
                            <td className="py-2 pr-3 text-th-text-secondary leading-tight">{row.promptText}</td>
                            <td className="text-center py-2 px-2">
                              <span className={row.brandMentioned ? "text-green-400" : "text-red-400"}>{row.brandMentioned ? "✓" : "✗"}</span>
                            </td>
                            {coverageData.competitors.map(c => {
                              const present = row.competitorsPresent.includes(c.name.toLowerCase());
                              return <td key={c.name} className="text-center py-2 px-2"><span className={present ? "text-th-text-secondary" : "text-th-text-muted/30"}>{present ? "✓" : "–"}</span></td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {coverageData.competitors.length === 0 && (
                <div className="rounded-lg border border-dashed border-th-border py-10 text-center text-sm text-th-text-muted">
                  No AI response data yet. Add competitors in <strong>Configuration → Brand & AEO</strong> and run prompts from Prompt Hub.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Battlecards Panel ─────────────────────────────────────────────────────

function BattlecardsPanel() {
  const [cards, setCards] = useState<AeoBattlecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/aeo/analyze").then(r => r.json()).then(d => { setCards(d as AeoBattlecard[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function generate() {
    setGenerating(true); setError("");
    try {
      const res = await fetch("/api/aeo/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "battlecards" }) });
      const d = await res.json() as { battlecards?: AeoBattlecard[]; error?: string };
      if (d.error) throw new Error(d.error);
      setCards(prev => [...(d.battlecards ?? []), ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setGenerating(false);
  }

  async function deleteCard(id: string) {
    await fetch(`/api/aeo/analyze?id=${id}`, { method: "DELETE" });
    setCards(prev => prev.filter(c => c.id !== id));
  }

  if (loading) return <div className="py-8 text-center text-sm text-th-text-muted">Loading battlecards…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-th-text-secondary">AI-generated competitive analysis cards. Requires competitors configured in Brand Settings + run data.</p>
        <button onClick={generate} disabled={generating} className="cs-btn cs-btn-primary shrink-0">
          {generating ? "Generating…" : "Generate Battlecards"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</p>}
      {!cards.length && !generating && (
        <div className="rounded-lg border border-dashed border-th-border py-10 text-center text-sm text-th-text-muted">
          No battlecards yet. Generate them using your run data.
        </div>
      )}
      <div className="space-y-3">
        {cards.map(card => (
          <div key={card.id} className="rounded-xl border border-th-border bg-th-card">
            <button onClick={() => setExpanded(expanded === card.id ? null : card.id)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-th-card-alt transition-colors">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-th-text">{card.competitor}</div>
                <div className="text-xs text-th-text-secondary mt-0.5 line-clamp-1">{card.summary}</div>
              </div>
              <span className={`text-xs capitalize px-2 py-0.5 rounded-full border ${card.sentiment === "positive" ? "bg-green-500/10 border-green-500/20 text-green-400" : card.sentiment === "negative" ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-th-card-alt border-th-border text-th-text-muted"}`}>{card.sentiment}</span>
              <span className="text-xs text-th-text-muted">{expanded === card.id ? "▲" : "▼"}</span>
            </button>
            {expanded === card.id && (
              <div className="border-t border-th-border px-5 py-4 space-y-3">
                <p className="text-sm text-th-text-secondary">{card.summary}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {card.sections.map((s, i) => (
                    <div key={i} className="rounded-lg bg-th-card-alt border border-th-border p-3">
                      <div className="text-xs font-semibold text-th-accent mb-1.5">{s.title}</div>
                      <div className="text-sm text-th-text-secondary leading-relaxed">{s.content}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-th-text-muted">{new Date(card.createdAt).toLocaleDateString()}</span>
                  <button onClick={() => deleteCard(card.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Fan-Out Panel ─────────────────────────────────────────────────────────

function FanOutPanel() {
  const [personas, setPersonas] = useState<Array<{ persona: string; prompts: string[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  async function generate() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/aeo/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "fanout" }) });
      const d = await res.json() as { personas?: typeof personas; error?: string };
      if (d.error) throw new Error(d.error);
      setPersonas(d.personas ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-th-text-secondary">Generate prompt variants for 5 different user personas. Helps you see how different audiences ask AI models about your space.</p>
        <button onClick={generate} disabled={loading} className="cs-btn cs-btn-primary shrink-0">
          {loading ? "Generating…" : "Generate Fan-Out"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</p>}
      {!personas.length && !loading && (
        <div className="rounded-lg border border-dashed border-th-border py-10 text-center text-sm text-th-text-muted">
          No persona variants yet. Click Generate Fan-Out to create them.
        </div>
      )}
      <div className="space-y-2">
        {personas.map((p, i) => (
          <div key={i} className="rounded-lg border border-th-border bg-th-card-alt">
            <button onClick={() => setExpanded(expanded === i ? null : i)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-th-card transition-colors">
              <span className="flex-1 text-sm font-medium text-th-text">{p.persona}</span>
              <span className="text-xs text-th-text-muted">{p.prompts.length} prompts</span>
              <span className="text-xs text-th-text-muted">{expanded === i ? "▲" : "▼"}</span>
            </button>
            {expanded === i && (
              <div className="border-t border-th-border px-4 py-3 space-y-2">
                {p.prompts.map((prompt, j) => (
                  <div key={j} className="flex items-start gap-2 text-sm text-th-text-secondary bg-th-card rounded-lg px-3 py-2">
                    <span className="text-th-accent shrink-0">{j + 1}.</span>
                    <span>{prompt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Niche Explorer Panel ──────────────────────────────────────────────────

function NicheExplorerPanel() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/aeo/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "niche" }) });
      const d = await res.json() as { questions?: string[]; error?: string };
      if (d.error) throw new Error(d.error);
      setQuestions(d.questions ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-th-text-secondary">AI-generated niche, long-tail questions that users actually ask AI assistants in your space. Use these as new tracking prompts.</p>
        <button onClick={generate} disabled={loading} className="cs-btn cs-btn-primary shrink-0">
          {loading ? "Generating…" : "Generate Questions"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</p>}
      {!questions.length && !loading && (
        <div className="rounded-lg border border-dashed border-th-border py-10 text-center text-sm text-th-text-muted">
          No niche questions yet. Click Generate Questions to create them.
        </div>
      )}
      {questions.length > 0 && (
        <div className="space-y-1.5">
          {questions.map((q, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-th-border bg-th-card-alt px-4 py-2.5">
              <span className="text-xs text-th-text-muted w-5 mt-0.5">{i + 1}.</span>
              <span className="flex-1 text-sm text-th-text">{q}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Automation Panel ──────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
  { label: "Every hour", ms: 3600000 },
  { label: "Every 6 hours", ms: 21600000 },
  { label: "Daily", ms: 86400000 },
  { label: "Every 3 days", ms: 259200000 },
  { label: "Weekly", ms: 604800000 },
];

function AutomationPanel() {
  const [schedule, setScheduleState] = useState<AeoScheduleData>({ enabled: false, intervalMs: 86400000, lastRunAt: "" });
  const [alerts, setAlerts] = useState<AeoDriftAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/aeo/schedule").then(r => r.json())
      .then(d => { const dd = d as { schedule: AeoScheduleData; alerts: AeoDriftAlert[] }; setScheduleState(dd.schedule); setAlerts(dd.alerts); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function saveSchedule(patch: Partial<AeoScheduleData>) {
    const next = { ...schedule, ...patch };
    setScheduleState(next);
    setSaving(true);
    await fetch("/api/aeo/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    setSaving(false);
  }

  async function dismissAlert(id: string) {
    await fetch("/api/aeo/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss", alertId: id }) });
    setAlerts(prev => prev.filter(a => a.id !== id));
  }

  if (loading) return <div className="py-8 text-center text-sm text-th-text-muted">Loading automation settings…</div>;

  const activeAlerts = alerts.filter(a => !a.dismissed);

  return (
    <div className="space-y-5">
      {/* Schedule toggle */}
      <div className="rounded-xl border border-th-border bg-th-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-th-text">Scheduled Runs</div>
            <div className="text-sm text-th-text-secondary mt-0.5">Automatically run all prompts across providers on a schedule.</div>
          </div>
          <button onClick={() => saveSchedule({ enabled: !schedule.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${schedule.enabled ? "bg-th-accent" : "bg-th-border"}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${schedule.enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {INTERVAL_OPTIONS.map(opt => (
            <button key={opt.ms} onClick={() => saveSchedule({ intervalMs: opt.ms })}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${schedule.intervalMs === opt.ms ? "bg-th-accent/15 border-th-accent/40 text-th-accent" : "border-th-border text-th-text-secondary hover:text-th-text"}`}>
              {opt.label}
            </button>
          ))}
        </div>

        {schedule.lastRunAt && <div className="text-xs text-th-text-muted">Last run: {new Date(schedule.lastRunAt).toLocaleString()}</div>}
        {saving && <div className="text-xs text-th-text-muted">Saving…</div>}
      </div>

      {/* Drift alerts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-th-text">Drift Alerts {activeAlerts.length > 0 && <span className="ml-2 text-xs bg-red-500/15 text-red-400 border border-red-500/20 rounded-full px-2 py-0.5">{activeAlerts.length}</span>}</div>
        </div>
        {!activeAlerts.length && (
          <div className="rounded-lg border border-th-border bg-th-card-alt px-4 py-6 text-center text-sm text-th-text-muted">
            No drift alerts. Alerts fire when visibility score changes significantly between runs.
          </div>
        )}
        <div className="space-y-2">
          {activeAlerts.map(a => (
            <div key={a.id} className="flex items-start gap-3 rounded-lg border border-th-border bg-th-card-alt px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-th-text line-clamp-1">{a.promptText}</div>
                <div className="text-xs text-th-text-muted mt-0.5">{PROVIDER_LABELS[a.provider] ?? a.provider} · {new Date(a.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-sm font-bold ${a.delta > 0 ? "text-green-400" : "text-red-400"}`}>{a.delta > 0 ? "+" : ""}{a.delta} pts</div>
                <div className="text-xs text-th-text-muted">{a.oldScore} → {a.newScore}</div>
              </div>
              <button onClick={() => dismissAlert(a.id)} className="text-xs text-th-text-muted hover:text-th-text transition-colors shrink-0">Dismiss</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main AEO Tab ──────────────────────────────────────────────────────────

// ── Main AEO Tab ──────────────────────────────────────────────────────────

interface NavItem { key: SubTab; icon: string; label: string; desc: string; }
interface NavGroup { group: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    group: "Audit Tools",
    items: [
      { key: "aeo", icon: "🏥", label: "AEO Audit", desc: "AI-readiness score for any URL" },
      { key: "sro", icon: "📡", label: "SRO Analysis", desc: "5-stage search relevance pipeline" },
    ],
  },
  {
    group: "Brand Tracker",
    items: [
      { key: "prompts", icon: "💬", label: "Prompt Hub", desc: "Manage & run tracking prompts" },
      { key: "responses", icon: "📋", label: "Responses", desc: "Browse AI model answers" },
      { key: "analytics", icon: "📈", label: "Visibility Analytics", desc: "Scores, sentiment & trends" },
      { key: "citations", icon: "🔗", label: "Citations", desc: "Most-cited domains" },
      { key: "opportunities", icon: "🎯", label: "Opportunities", desc: "Gaps where brand isn't cited" },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { key: "competitors", icon: "🏆", label: "Competitor Intel", desc: "SOV & gap analysis vs rivals" },
      { key: "battlecards", icon: "⚔️", label: "Battlecards", desc: "Competitive analysis cards" },
      { key: "fanout", icon: "👥", label: "Fan-Out", desc: "Persona-based prompt variants" },
      { key: "niche", icon: "🔍", label: "Niche Explorer", desc: "Long-tail AI search queries" },
      { key: "automation", icon: "🤖", label: "Automation", desc: "Scheduled runs & drift alerts" },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap(g => g.items);

export default function AeoTab({ onGenerateFromAeo, subTab, setSubTab }: AeoTabProps) {
  const active = ALL_ITEMS.find(i => i.key === subTab) ?? ALL_ITEMS[0];

  return (
    <div className="min-h-[600px]">
      {/* Page header */}
      <div className="mb-5 border-b border-th-border pb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-th-text">
          <span>{active.icon}</span> {active.label}
        </h2>
        <p className="mt-1 text-sm text-th-text-secondary">{active.desc}</p>
      </div>

      {/* Panel */}
      {subTab === "aeo" && <AeoAuditPanel onGenerate={onGenerateFromAeo} />}
      {subTab === "sro" && <SroAnalysisPanel onGenerate={onGenerateFromAeo} />}
      {subTab === "prompts" && <PromptHubPanel />}
      {subTab === "responses" && <ResponsesPanel />}
      {subTab === "analytics" && <VisibilityAnalyticsPanel />}
      {subTab === "citations" && <CitationsPanel />}
      {subTab === "opportunities" && <CitationOpportunitiesPanel />}
      {subTab === "competitors" && <CompetitorIntelligencePanel />}
      {subTab === "battlecards" && <BattlecardsPanel />}
      {subTab === "fanout" && <FanOutPanel />}
      {subTab === "niche" && <NicheExplorerPanel />}
      {subTab === "automation" && <AutomationPanel />}
    </div>
  );
}
