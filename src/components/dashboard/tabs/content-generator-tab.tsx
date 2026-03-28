"use client";

import { useState, useCallback, useRef, type ChangeEvent } from "react";
import type {
  ContentType,
  ContentItem,
  ProjectSettings,
  GenerationRequest,
} from "../types";
import { contentTypeLabels, contentTypeDescriptions } from "../types";

/* ────────────────────────────────────────────────────────
   Props
   ──────────────────────────────────────────────────────── */
type Props = {
  settings: ProjectSettings;
  onContentCreated: (item: ContentItem) => void;
};

/* ────────────────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────────────────── */
type Mode = "single" | "bulk";
type GenerationStage =
  | "idle"
  | "analyzing"
  | "detecting"
  | "researching"
  | "outlining"
  | "writing"
  | "optimizing"
  | "done";

const GENERATION_STEPS: { key: GenerationStage; label: string; duration: number }[] = [
  { key: "analyzing", label: "Analyzing your topic", duration: 1200 },
  { key: "detecting", label: "Auto-detecting best format", duration: 900 },
  { key: "researching", label: "Researching from 8+ sources", duration: 2000 },
  { key: "outlining", label: "Generating structured outline", duration: 1400 },
  { key: "writing", label: "Writing each section with AI", duration: 2500 },
  { key: "optimizing", label: "Optimizing for SEO + AEO + GEO", duration: 1600 },
];

const TONES = ["Professional", "Casual", "Academic", "Conversational", "Authoritative"];

const CONTENT_TYPE_ICONS: Record<ContentType | "auto", string> = {
  auto: "🔮",
  blog_post: "📝",
  listicle: "📋",
  comparison: "⚖️",
  how_to_guide: "📖",
  product_review: "⭐",
  case_study: "📊",
  news_article: "📰",
  opinion_piece: "💡",
  technical_guide: "🔧",
  landing_page: "🚀",
  custom: "✏️",
};

/* ────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────── */
function uid(): string {
  return `ci_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/* ────────────────────────────────────────────────────────
   Icons (inline SVG to avoid external deps)
   ──────────────────────────────────────────────────────── */
function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
    </svg>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="60"
        strokeDashoffset="20"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckCircle() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-500"
    >
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────
   Toggle component
   ──────────────────────────────────────────────────────── */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-sm text-th-text-secondary group-hover:text-th-text transition-colors">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? "bg-th-accent" : "bg-th-border"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </label>
  );
}

/* ════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════ */
export function ContentGeneratorTab({ settings, onContentCreated }: Props) {
  /* ── Mode ── */
  const [mode, setMode] = useState<Mode>("single");

  /* ── Single Mode State ── */
  const [topic, setTopic] = useState("");
  const [selectedType, setSelectedType] = useState<ContentType | "auto">("auto");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [wordCount, setWordCount] = useState(settings.defaultWordCount || 2500);
  const [tone, setTone] = useState(settings.defaultTone || "Professional");
  const [audience, setAudience] = useState(settings.targetAudience || "");
  const [region, setRegion] = useState(settings.defaultRegion || "");
  const [includeFaqs, setIncludeFaqs] = useState(true);
  const [includeSchema, setIncludeSchema] = useState(true);
  const [includeInternalLinks, setIncludeInternalLinks] = useState(true);

  /* ── Generation State ── */
  const [stage, setStage] = useState<GenerationStage>("idle");
  const [generatedItem, setGeneratedItem] = useState<ContentItem | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /* ── Bulk Mode State ── */
  const [bulkText, setBulkText] = useState("");
  const [bulkTopics, setBulkTopics] = useState<
    { topic: string; detectedType: ContentType }[]
  >([]);
  const [bulkProgress, setBulkProgress] = useState({
    total: 0,
    completed: 0,
    failed: 0,
    running: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ────────────────────────────────────────────────────
     Keyword tag management
     ──────────────────────────────────────────────────── */
  const addKeyword = useCallback(() => {
    const trimmed = keywordsInput.trim();
    if (!trimmed) return;
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    setKeywords((prev) => {
      const set = new Set([...prev, ...parts]);
      return Array.from(set);
    });
    setKeywordsInput("");
  }, [keywordsInput]);

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  };

  /* ────────────────────────────────────────────────────
     Single article generation (simulated)
     ──────────────────────────────────────────────────── */
  const handleGenerate = useCallback(() => {
    if (!topic.trim()) return;
    setGeneratedItem(null);

    // Clear any existing timeouts
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    let cumulative = 0;
    GENERATION_STEPS.forEach((step, i) => {
      cumulative += step.duration;
      const t = setTimeout(() => {
        setStage(step.key);
      }, cumulative);
      timeoutsRef.current.push(t);
    });

    // After all steps, mark done
    cumulative += 800;
    const finalT = setTimeout(() => {
      const resolvedType: ContentType =
        selectedType === "auto" ? pickRandomType() : selectedType;

      const item: ContentItem = {
        id: uid(),
        title: generateTitle(topic, resolvedType),
        topic: topic.trim(),
        type: resolvedType,
        status: "ready",
        wordCount: wordCount + Math.floor(Math.random() * 400 - 200),
        seoScore: 78 + Math.floor(Math.random() * 18),
        aeoScore: 72 + Math.floor(Math.random() * 22),
        geoScore: 65 + Math.floor(Math.random() * 25),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        keywords: keywords.length
          ? keywords
          : topic.split(" ").filter((w) => w.length > 3).slice(0, 5),
      };

      setGeneratedItem(item);
      setStage("done");
      onContentCreated(item);
    }, cumulative);
    timeoutsRef.current.push(finalT);

    // Kick off
    setStage("analyzing");
  }, [topic, selectedType, keywords, wordCount, onContentCreated]);

  const resetGenerator = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setStage("idle");
    setGeneratedItem(null);
  };

  /* ────────────────────────────────────────────────────
     Bulk parsing
     ──────────────────────────────────────────────────── */
  const parseBulkTopics = useCallback((text: string) => {
    setBulkText(text);
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    setBulkTopics(
      lines.map((t) => ({
        topic: t,
        detectedType: pickRandomType(),
      }))
    );
  }, []);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      parseBulkTopics(text);
    };
    reader.readAsText(file);
  };

  const handleBulkGenerate = useCallback(() => {
    if (bulkTopics.length === 0) return;
    setBulkProgress({
      total: bulkTopics.length,
      completed: 0,
      failed: 0,
      running: true,
    });

    bulkTopics.forEach((bt, i) => {
      const delay = (i + 1) * 1800;
      const t = setTimeout(() => {
        const success = Math.random() > 0.08;
        setBulkProgress((prev) => ({
          ...prev,
          completed: prev.completed + (success ? 1 : 0),
          failed: prev.failed + (success ? 0 : 1),
          running: prev.completed + prev.failed + 1 < prev.total,
        }));

        if (success) {
          const item: ContentItem = {
            id: uid(),
            title: generateTitle(bt.topic, bt.detectedType),
            topic: bt.topic,
            type: bt.detectedType,
            status: "ready",
            wordCount: wordCount + Math.floor(Math.random() * 600 - 300),
            seoScore: 75 + Math.floor(Math.random() * 20),
            aeoScore: 70 + Math.floor(Math.random() * 24),
            geoScore: 62 + Math.floor(Math.random() * 28),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            keywords: bt.topic.split(" ").filter((w) => w.length > 3).slice(0, 5),
          };
          onContentCreated(item);
        }
      }, delay);
      timeoutsRef.current.push(t);
    });
  }, [bulkTopics, wordCount, onContentCreated]);

  /* ────────────────────────────────────────────────────
     Render helpers
     ──────────────────────────────────────────────────── */
  const allContentTypes: (ContentType | "auto")[] = [
    "auto",
    ...Object.keys(contentTypeLabels) as ContentType[],
  ];

  const isGenerating = stage !== "idle" && stage !== "done";
  const bulkDone =
    bulkProgress.running === false &&
    bulkProgress.total > 0 &&
    bulkProgress.completed + bulkProgress.failed === bulkProgress.total;

  /* ════════════════════════════════════════════════════
     JSX
     ════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6">
      {/* ── Mode Toggle ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setMode("single"); resetGenerator(); }}
          className={`cs-btn px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
            mode === "single"
              ? "bg-gradient-to-r from-th-accent to-purple-500 text-white shadow-lg shadow-th-accent/25"
              : "cs-btn-secondary"
          }`}
        >
          Single Article
        </button>
        <button
          onClick={() => { setMode("bulk"); resetGenerator(); }}
          className={`cs-btn px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
            mode === "bulk"
              ? "bg-gradient-to-r from-th-accent to-purple-500 text-white shadow-lg shadow-th-accent/25"
              : "cs-btn-secondary"
          }`}
        >
          Bulk Mode
        </button>
      </div>

      {/* ══════════════════════════════════════════════
          SINGLE ARTICLE MODE
          ══════════════════════════════════════════════ */}
      {mode === "single" && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Left Column (3/5 = 60%) ── */}
          <div className="lg:col-span-3 space-y-5">
            {/* Topic */}
            <div className="cs-card p-5 space-y-4">
              <label className="block text-sm font-semibold text-th-text">
                Topic
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., Best CRM Software for Small Business"
                disabled={isGenerating}
                className="cs-input w-full px-4 py-3 text-base rounded-lg bg-th-card border border-th-border text-th-text placeholder:text-th-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-th-accent/40 focus:border-th-accent transition-all"
              />
            </div>

            {/* Content Type */}
            <div className="cs-card p-5 space-y-4">
              <label className="block text-sm font-semibold text-th-text">
                Content Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {allContentTypes.map((ct) => {
                  const isAuto = ct === "auto";
                  const label = isAuto ? "Auto-Detect" : contentTypeLabels[ct];
                  const desc = isAuto
                    ? "AI picks the best format for your topic"
                    : contentTypeDescriptions[ct];
                  const icon = CONTENT_TYPE_ICONS[ct];
                  const active = selectedType === ct;
                  return (
                    <button
                      key={ct}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => setSelectedType(ct)}
                      className={`relative flex flex-col items-start gap-1 p-3 rounded-xl border-2 text-left transition-all duration-200 hover:shadow-md ${
                        active
                          ? "border-th-accent bg-th-accent-soft shadow-md shadow-th-accent/10"
                          : "border-th-border bg-th-card hover:border-th-accent/40"
                      }`}
                    >
                      {active && (
                        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-th-accent" />
                      )}
                      <span className="text-lg">{icon}</span>
                      <span className="text-sm font-semibold text-th-text leading-tight">
                        {label}
                      </span>
                      <span className="text-[11px] text-th-text-secondary leading-snug line-clamp-2">
                        {desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Keywords */}
            <div className="cs-card p-5 space-y-3">
              <label className="block text-sm font-semibold text-th-text">
                Keywords
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                  placeholder="Type keyword and press Enter or comma"
                  disabled={isGenerating}
                  className="cs-input flex-1 px-3 py-2 text-sm rounded-lg bg-th-card border border-th-border text-th-text placeholder:text-th-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-th-accent/40 transition-all"
                />
                <button
                  type="button"
                  onClick={addKeyword}
                  disabled={isGenerating}
                  className="cs-btn cs-btn-secondary px-4 py-2 text-sm rounded-lg"
                >
                  Add
                </button>
              </div>
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="cs-badge inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-th-accent-soft text-th-accent border border-th-accent/20"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeKeyword(kw)}
                        className="hover:text-red-400 transition-colors"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Advanced Options */}
            <div className="cs-card overflow-hidden">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex items-center justify-between w-full p-5 text-sm font-semibold text-th-text hover:bg-th-accent-soft/30 transition-colors"
              >
                <span>Advanced Options</span>
                <ChevronDown open={advancedOpen} />
              </button>

              <div
                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  advancedOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <div className="px-5 pb-5 space-y-5 border-t border-th-border pt-4">
                  {/* Word Count Slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-th-text-secondary">
                        Target Word Count
                      </span>
                      <span className="text-sm font-semibold text-th-accent tabular-nums">
                        {wordCount.toLocaleString()}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1000}
                      max={10000}
                      step={250}
                      value={wordCount}
                      onChange={(e) => setWordCount(Number(e.target.value))}
                      disabled={isGenerating}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer accent-th-accent bg-th-border"
                    />
                    <div className="flex justify-between text-[10px] text-th-text-secondary">
                      <span>1,000</span>
                      <span>5,000</span>
                      <span>10,000</span>
                    </div>
                  </div>

                  {/* Tone */}
                  <div className="space-y-1.5">
                    <label className="text-sm text-th-text-secondary">Tone</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      disabled={isGenerating}
                      className="cs-input w-full px-3 py-2 text-sm rounded-lg bg-th-card border border-th-border text-th-text focus:outline-none focus:ring-2 focus:ring-th-accent/40 transition-all"
                    >
                      {TONES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Target Audience */}
                  <div className="space-y-1.5">
                    <label className="text-sm text-th-text-secondary">
                      Target Audience
                    </label>
                    <input
                      type="text"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="e.g., Small business owners, Marketing managers"
                      disabled={isGenerating}
                      className="cs-input w-full px-3 py-2 text-sm rounded-lg bg-th-card border border-th-border text-th-text placeholder:text-th-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-th-accent/40 transition-all"
                    />
                  </div>

                  {/* Region */}
                  <div className="space-y-1.5">
                    <label className="text-sm text-th-text-secondary">Region</label>
                    <input
                      type="text"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="e.g., India, United States, Global"
                      disabled={isGenerating}
                      className="cs-input w-full px-3 py-2 text-sm rounded-lg bg-th-card border border-th-border text-th-text placeholder:text-th-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-th-accent/40 transition-all"
                    />
                  </div>

                  {/* Toggles */}
                  <div className="space-y-3 pt-1">
                    <Toggle
                      label="Include FAQs"
                      checked={includeFaqs}
                      onChange={setIncludeFaqs}
                    />
                    <Toggle
                      label="Include Schema Markup"
                      checked={includeSchema}
                      onChange={setIncludeSchema}
                    />
                    <Toggle
                      label="Include Internal Links"
                      checked={includeInternalLinks}
                      onChange={setIncludeInternalLinks}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!topic.trim() || isGenerating}
              className="cs-btn cs-btn-primary w-full flex items-center justify-center gap-2.5 px-6 py-3.5 text-base font-semibold rounded-xl text-white bg-gradient-to-r from-th-accent via-purple-500 to-pink-500 shadow-lg shadow-th-accent/30 hover:shadow-xl hover:shadow-th-accent/40 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg transition-all duration-200"
            >
              {isGenerating ? (
                <>
                  <Spinner className="text-white" />
                  Generating...
                </>
              ) : (
                <>
                  <SparkleIcon className="text-white" />
                  Generate Content
                </>
              )}
            </button>
          </div>

          {/* ── Right Column (2/5 = 40%) ── */}
          <div className="lg:col-span-2">
            <div className="cs-card p-6 sticky top-6 min-h-[420px] flex flex-col">
              {/* Idle state - process explanation */}
              {stage === "idle" && (
                <div className="flex-1 flex flex-col justify-center space-y-6">
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-th-accent/20 to-purple-500/20 mb-2">
                      <SparkleIcon className="w-7 h-7 text-th-accent" />
                    </div>
                    <h3 className="text-lg font-bold text-th-text">
                      How It Works
                    </h3>
                    <p className="text-xs text-th-text-secondary">
                      Our AI pipeline creates SEO-optimized content in minutes
                    </p>
                  </div>

                  <div className="space-y-3">
                    {[
                      { step: 1, text: "AI analyzes your topic", color: "from-blue-500 to-cyan-400" },
                      { step: 2, text: "Auto-detects best content format", color: "from-violet-500 to-purple-400" },
                      { step: 3, text: "Researches from 8+ sources", color: "from-amber-500 to-orange-400" },
                      { step: 4, text: "Generates structured outline", color: "from-emerald-500 to-green-400" },
                      { step: 5, text: "Writes each section with AI", color: "from-pink-500 to-rose-400" },
                      { step: 6, text: "Optimizes for SEO + AEO + GEO", color: "from-indigo-500 to-blue-400" },
                    ].map(({ step, text, color }) => (
                      <div key={step} className="flex items-center gap-3">
                        <span
                          className={`flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br ${color} text-white text-xs font-bold flex items-center justify-center shadow-sm`}
                        >
                          {step}
                        </span>
                        <span className="text-sm text-th-text-secondary">
                          {text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generating - progress stepper */}
              {isGenerating && (
                <div className="flex-1 flex flex-col justify-center space-y-6">
                  <div className="text-center space-y-1">
                    <h3 className="text-lg font-bold text-th-text">
                      Generating Content
                    </h3>
                    <p className="text-xs text-th-text-secondary">
                      &ldquo;{topic}&rdquo;
                    </p>
                  </div>

                  <div className="space-y-3">
                    {GENERATION_STEPS.map((step, i) => {
                      const stepIdx = GENERATION_STEPS.findIndex(
                        (s) => s.key === stage
                      );
                      const isCurrent = step.key === stage;
                      const isDone = i < stepIdx;

                      return (
                        <div
                          key={step.key}
                          className={`flex items-center gap-3 transition-all duration-300 ${
                            isCurrent
                              ? "opacity-100"
                              : isDone
                              ? "opacity-60"
                              : "opacity-30"
                          }`}
                        >
                          <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
                            {isDone ? (
                              <CheckCircle />
                            ) : isCurrent ? (
                              <Spinner className="text-th-accent" />
                            ) : (
                              <span className="w-2.5 h-2.5 rounded-full bg-th-border" />
                            )}
                          </span>
                          <span
                            className={`text-sm ${
                              isCurrent
                                ? "text-th-text font-medium"
                                : "text-th-text-secondary"
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1.5">
                    <div className="h-1.5 rounded-full bg-th-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-th-accent to-purple-500 transition-all duration-700 ease-out"
                        style={{
                          width: `${
                            ((GENERATION_STEPS.findIndex((s) => s.key === stage) + 1) /
                              GENERATION_STEPS.length) *
                            100
                          }%`,
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-th-text-secondary text-center tabular-nums">
                      Step{" "}
                      {GENERATION_STEPS.findIndex((s) => s.key === stage) + 1} of{" "}
                      {GENERATION_STEPS.length}
                    </p>
                  </div>
                </div>
              )}

              {/* Done - summary card */}
              {stage === "done" && generatedItem && (
                <div className="flex-1 flex flex-col justify-center space-y-5">
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 mb-1">
                      <CheckCircle />
                    </div>
                    <h3 className="text-lg font-bold text-th-text">
                      Content Ready!
                    </h3>
                    <p className="text-sm text-th-text-secondary line-clamp-2">
                      {generatedItem.title}
                    </p>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-th-accent-soft/40 border border-th-accent/10 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-th-text-secondary mb-0.5">
                        Word Count
                      </p>
                      <p className="text-xl font-bold text-th-text tabular-nums">
                        {generatedItem.wordCount.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/10 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-th-text-secondary mb-0.5">
                        SEO Score
                      </p>
                      <p className="text-xl font-bold text-emerald-500 tabular-nums">
                        {generatedItem.seoScore}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/10 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-th-text-secondary mb-0.5">
                        AEO Score
                      </p>
                      <p className="text-xl font-bold text-blue-500 tabular-nums">
                        {generatedItem.aeoScore}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/10 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-th-text-secondary mb-0.5">
                        GEO Score
                      </p>
                      <p className="text-xl font-bold text-violet-500 tabular-nums">
                        {generatedItem.geoScore}
                      </p>
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <span className="cs-badge px-2.5 py-0.5 text-[11px] rounded-full bg-th-accent-soft text-th-accent border border-th-accent/20 font-medium">
                      {contentTypeLabels[generatedItem.type]}
                    </span>
                    <span className="cs-badge px-2.5 py-0.5 text-[11px] rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
                      Ready
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="cs-btn cs-btn-primary flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-gradient-to-r from-th-accent to-purple-500 text-white shadow hover:shadow-lg transition-all"
                    >
                      View in Library
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resetGenerator();
                        setTopic("");
                        setKeywords([]);
                      }}
                      className="cs-btn cs-btn-secondary px-4 py-2.5 text-sm font-medium rounded-lg"
                    >
                      New
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          BULK MODE
          ══════════════════════════════════════════════ */}
      {mode === "bulk" && (
        <div className="space-y-5">
          {/* Input area */}
          <div className="cs-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-th-text">
                Topics (one per line)
              </label>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="cs-btn cs-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg"
                >
                  <UploadIcon />
                  Upload CSV / Excel
                </button>
              </div>
            </div>
            <textarea
              value={bulkText}
              onChange={(e) => parseBulkTopics(e.target.value)}
              placeholder={
                "Best CRM Software for Small Business\nHow to Start a SaaS Company in 2026\nTop 10 Project Management Tools Compared\nComplete Guide to Email Marketing Automation"
              }
              rows={8}
              disabled={bulkProgress.running}
              className="cs-input w-full px-4 py-3 text-sm rounded-lg bg-th-card border border-th-border text-th-text placeholder:text-th-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-th-accent/40 transition-all resize-y font-mono leading-relaxed"
            />
          </div>

          {/* Parsed table */}
          {bulkTopics.length > 0 && (
            <div className="cs-card overflow-hidden">
              <div className="px-5 py-3 border-b border-th-border flex items-center justify-between">
                <h4 className="text-sm font-semibold text-th-text">
                  Parsed Topics
                </h4>
                <span className="cs-badge px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-th-accent-soft text-th-accent border border-th-accent/20">
                  {bulkTopics.length} topics
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-th-border">
                      <th className="px-5 py-2.5 text-left text-[11px] uppercase tracking-wider text-th-text-secondary font-semibold">
                        #
                      </th>
                      <th className="px-5 py-2.5 text-left text-[11px] uppercase tracking-wider text-th-text-secondary font-semibold">
                        Topic
                      </th>
                      <th className="px-5 py-2.5 text-left text-[11px] uppercase tracking-wider text-th-text-secondary font-semibold">
                        Detected Type
                      </th>
                      <th className="px-5 py-2.5 text-left text-[11px] uppercase tracking-wider text-th-text-secondary font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkTopics.map((bt, i) => {
                      const isComplete =
                        bulkProgress.running || bulkDone
                          ? i < bulkProgress.completed + bulkProgress.failed
                          : false;
                      return (
                        <tr
                          key={i}
                          className="border-b border-th-border/50 hover:bg-th-accent-soft/20 transition-colors"
                        >
                          <td className="px-5 py-2.5 text-th-text-secondary tabular-nums">
                            {i + 1}
                          </td>
                          <td className="px-5 py-2.5 text-th-text font-medium max-w-xs truncate">
                            {bt.topic}
                          </td>
                          <td className="px-5 py-2.5">
                            <span className="cs-badge inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full bg-th-accent-soft text-th-accent border border-th-accent/20">
                              {CONTENT_TYPE_ICONS[bt.detectedType]}{" "}
                              {contentTypeLabels[bt.detectedType]}
                            </span>
                          </td>
                          <td className="px-5 py-2.5">
                            {isComplete ? (
                              <span className="inline-flex items-center gap-1 text-emerald-500 text-xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Done
                              </span>
                            ) : bulkProgress.running &&
                              i ===
                                bulkProgress.completed + bulkProgress.failed ? (
                              <span className="inline-flex items-center gap-1 text-th-accent text-xs">
                                <Spinner className="text-th-accent w-3 h-3" />
                                Generating
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-th-text-secondary text-xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-th-border" />
                                Queued
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Bulk advanced settings */}
          <div className="cs-card overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex items-center justify-between w-full p-5 text-sm font-semibold text-th-text hover:bg-th-accent-soft/30 transition-colors"
            >
              <span>Bulk Settings</span>
              <ChevronDown open={advancedOpen} />
            </button>
            <div
              className={`transition-all duration-300 ease-in-out overflow-hidden ${
                advancedOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="px-5 pb-5 space-y-5 border-t border-th-border pt-4">
                {/* Word Count */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-th-text-secondary">
                      Target Word Count
                    </span>
                    <span className="text-sm font-semibold text-th-accent tabular-nums">
                      {wordCount.toLocaleString()}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1000}
                    max={10000}
                    step={250}
                    value={wordCount}
                    onChange={(e) => setWordCount(Number(e.target.value))}
                    disabled={bulkProgress.running}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer accent-th-accent bg-th-border"
                  />
                </div>
                {/* Tone */}
                <div className="space-y-1.5">
                  <label className="text-sm text-th-text-secondary">Tone</label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    disabled={bulkProgress.running}
                    className="cs-input w-full px-3 py-2 text-sm rounded-lg bg-th-card border border-th-border text-th-text focus:outline-none focus:ring-2 focus:ring-th-accent/40 transition-all"
                  >
                    {TONES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Toggles */}
                <div className="space-y-3 pt-1">
                  <Toggle
                    label="Include FAQs"
                    checked={includeFaqs}
                    onChange={setIncludeFaqs}
                  />
                  <Toggle
                    label="Include Schema Markup"
                    checked={includeSchema}
                    onChange={setIncludeSchema}
                  />
                  <Toggle
                    label="Include Internal Links"
                    checked={includeInternalLinks}
                    onChange={setIncludeInternalLinks}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bulk Progress */}
          {(bulkProgress.running || bulkDone) && (
            <div className="cs-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-th-text">
                  Generation Progress
                </h4>
                {bulkProgress.running ? (
                  <span className="cs-badge inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] rounded-full bg-th-accent-soft text-th-accent border border-th-accent/20 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-th-accent animate-pulse" />
                    Running
                  </span>
                ) : (
                  <span className="cs-badge inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
                    Complete
                  </span>
                )}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-xl bg-th-accent-soft/30">
                  <p className="text-2xl font-bold text-th-text tabular-nums">
                    {bulkProgress.total}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-th-text-secondary mt-0.5">
                    Total
                  </p>
                </div>
                <div className="text-center p-3 rounded-xl bg-emerald-500/10">
                  <p className="text-2xl font-bold text-emerald-500 tabular-nums">
                    {bulkProgress.completed}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-th-text-secondary mt-0.5">
                    Completed
                  </p>
                </div>
                <div className="text-center p-3 rounded-xl bg-red-500/10">
                  <p className="text-2xl font-bold text-red-500 tabular-nums">
                    {bulkProgress.failed}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-th-text-secondary mt-0.5">
                    Failed
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="h-2.5 rounded-full bg-th-border overflow-hidden flex">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-500 ease-out"
                    style={{
                      width: `${
                        (bulkProgress.completed / bulkProgress.total) * 100
                      }%`,
                    }}
                  />
                  <div
                    className="h-full bg-red-400 transition-all duration-500 ease-out"
                    style={{
                      width: `${
                        (bulkProgress.failed / bulkProgress.total) * 100
                      }%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-th-text-secondary text-center tabular-nums">
                  {bulkProgress.completed + bulkProgress.failed} of{" "}
                  {bulkProgress.total} processed (
                  {Math.round(
                    ((bulkProgress.completed + bulkProgress.failed) /
                      bulkProgress.total) *
                      100
                  )}
                  %)
                </p>
              </div>
            </div>
          )}

          {/* Generate All Button */}
          <button
            type="button"
            onClick={handleBulkGenerate}
            disabled={bulkTopics.length === 0 || bulkProgress.running}
            className="cs-btn cs-btn-primary w-full flex items-center justify-center gap-2.5 px-6 py-3.5 text-base font-semibold rounded-xl text-white bg-gradient-to-r from-th-accent via-purple-500 to-pink-500 shadow-lg shadow-th-accent/30 hover:shadow-xl hover:shadow-th-accent/40 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg transition-all duration-200"
          >
            {bulkProgress.running ? (
              <>
                <Spinner className="text-white" />
                Generating...
              </>
            ) : (
              <>
                <SparkleIcon className="text-white" />
                Generate All
                {bulkTopics.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs font-bold rounded-full bg-white/20">
                    {bulkTopics.length}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────
   Utility functions (outside component)
   ──────────────────────────────────────────────────────── */
const ALL_TYPES: ContentType[] = [
  "blog_post",
  "listicle",
  "comparison",
  "how_to_guide",
  "product_review",
  "case_study",
  "news_article",
  "opinion_piece",
  "technical_guide",
  "landing_page",
];

function pickRandomType(): ContentType {
  return ALL_TYPES[Math.floor(Math.random() * ALL_TYPES.length)];
}

function generateTitle(topic: string, type: ContentType): string {
  const prefixes: Record<ContentType, string[]> = {
    blog_post: ["The Ultimate Guide to", "Everything You Need to Know About", "A Deep Dive Into"],
    listicle: ["Top 10", "Best 15", "7 Must-Know"],
    comparison: ["vs.", "Compared:", "Head-to-Head:"],
    how_to_guide: ["How to Master", "Step-by-Step Guide to", "Complete Guide:"],
    product_review: ["Review:", "Honest Review of", "In-Depth Look at"],
    case_study: ["Case Study:", "How We Achieved", "Real Results:"],
    news_article: ["Breaking:", "Update:", "What You Need to Know:"],
    opinion_piece: ["Why", "The Case for", "Rethinking"],
    technical_guide: ["Technical Deep Dive:", "Engineering Guide to", "Advanced"],
    landing_page: ["Discover", "Transform Your", "Unlock"],
    custom: ["Exploring", "Understanding", "Insights on"],
  };
  const options = prefixes[type] || prefixes.blog_post;
  const prefix = options[Math.floor(Math.random() * options.length)];
  return `${prefix} ${topic}`;
}
