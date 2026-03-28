"use client";

import { useState, useMemo } from "react";
import type { ContentItem, GeoAnalysis } from "../types";

/* ── Props ── */
type Props = {
  items: ContentItem[];
  onUpdate: (id: string, updates: Partial<ContentItem>) => void;
};

/* ── Simulated GEO Analysis ── */
const REGIONS = ["Mumbai", "Delhi NCR", "Bangalore", "Pune", "Hyderabad", "Chennai", "Kolkata", "Jaipur"];

const LOCAL_KEYWORDS_POOL = [
  "near me", "in mumbai", "in delhi", "top colleges", "best institute",
  "admission open", "local campus", "city center", "nearby coaching",
  "metro accessible", "in pune", "in bangalore", "affordable fees",
  "placement record", "local ranking",
];

const MISSING_KEYWORDS_POOL = [
  "near railway station", "in city center", "walking distance",
  "local transport", "neighborhood guide", "area map",
  "district wise", "zone specific", "pin code",
];

const CITATION_SOURCES = [
  { name: "Google Business Profile", status: "optimized" as const },
  { name: "Justdial", status: "listed" as const },
  { name: "Sulekha", status: "missing" as const },
  { name: "IndiaMART", status: "missing" as const },
  { name: "Yellow Pages India", status: "listed" as const },
  { name: "Facebook Local", status: "optimized" as const },
];

function simulateGeoAnalysis(item: ContentItem): GeoAnalysis & {
  targetRegions: string[];
  missingRegions: string[];
  regionKeywords: string[];
  localKeywordsFound: string[];
  missingKeywords: string[];
  keywordDensity: number;
  hasLocalBusiness: boolean;
  hasAddress: boolean;
  hasOpeningHours: boolean;
  citations: typeof CITATION_SOURCES;
  regionRelevanceBreakdown: { region: string; score: number }[];
  competitors: { name: string; strength: string }[];
} {
  const seed = item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1);
  const pick = <T,>(arr: T[], count: number): T[] => {
    const shuffled = [...arr].sort(() => Math.sin(seed + arr.indexOf(shuffled[0] as T)) - 0.5);
    return shuffled.slice(0, count);
  };

  const targetRegions = pick(REGIONS, 2 + (seed % 3));
  const missingRegions = REGIONS.filter((r) => !targetRegions.includes(r)).slice(0, 2);
  const localKeywordsFound = pick(LOCAL_KEYWORDS_POOL, 3 + (seed % 4));
  const missingKeywords = pick(MISSING_KEYWORDS_POOL, 2 + (seed % 3));

  return {
    score: item.geoScore,
    localKeywords: localKeywordsFound,
    geoTargeting: targetRegions.join(", "),
    localSchema: seed % 3 !== 0,
    napConsistency: seed % 4 !== 0,
    localCitations: 2 + (seed % 5),
    regionRelevance: 40 + (seed % 50),
    suggestions: [
      `Add "${missingKeywords[0]}" to target local intent`,
      `Include region-specific data for ${missingRegions[0]}`,
      "Add LocalBusiness structured data markup",
      "Improve NAP (Name, Address, Phone) consistency",
      `Reference local landmarks near ${targetRegions[0]}`,
      "Add opening hours to schema markup",
    ],
    targetRegions,
    missingRegions,
    regionKeywords: localKeywordsFound.slice(0, 3),
    localKeywordsFound,
    missingKeywords,
    keywordDensity: +(0.5 + (seed % 30) / 10).toFixed(1),
    hasLocalBusiness: seed % 3 !== 0,
    hasAddress: seed % 2 === 0,
    hasOpeningHours: seed % 5 !== 0,
    citations: CITATION_SOURCES.map((c, i) => ({
      ...c,
      status: (["optimized", "listed", "missing"] as const)[(seed + i) % 3],
    })),
    regionRelevanceBreakdown: targetRegions.map((r, i) => ({
      region: r,
      score: Math.min(100, 35 + ((seed + i * 13) % 60)),
    })),
    competitors: [
      { name: `${targetRegions[0]} Education Hub`, strength: "Strong local backlinks" },
      { name: `Study${targetRegions[0].replace(/\s/g, "")}`, strength: "High GMB rating" },
      { name: `Local Academy ${targetRegions[1] || targetRegions[0]}`, strength: "Active local citations" },
    ],
  };
}

/* ── Score Gauge Component ── */
function ScoreGauge({ score, size = 140 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color =
    score >= 80 ? "text-emerald-500" : score >= 60 ? "text-th-teal" : score >= 40 ? "text-amber-500" : "text-red-500";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={8} className="text-th-border opacity-30" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={8}
          strokeDasharray={circumference} strokeDashoffset={circumference - filled}
          strokeLinecap="round" className={`${color} transition-all duration-700`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-bold ${color}`}>{score}</span>
        <span className="text-[10px] text-th-text-muted uppercase tracking-wider">GEO</span>
      </div>
    </div>
  );
}

/* ── Main Component ── */
export function GeoOptimizerTab({ items, onUpdate }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [applyingFixes, setApplyingFixes] = useState<Set<string>>(new Set());

  /* Compute analyses for all items */
  const analyses = useMemo(() => {
    const map = new Map<string, ReturnType<typeof simulateGeoAnalysis>>();
    items.forEach((item) => map.set(item.id, simulateGeoAnalysis(item)));
    return map;
  }, [items]);

  const selectedItem = items.find((i) => i.id === selectedId);
  const selectedAnalysis = selectedId ? analyses.get(selectedId) : null;

  /* KPI calculations */
  const avgGeoScore = items.length
    ? Math.round(items.reduce((s, i) => s + i.geoScore, 0) / items.length)
    : 0;

  const allLocalKeywords = new Set(
    Array.from(analyses.values()).flatMap((a) => a.localKeywordsFound)
  );
  const localKeywordsCoverage = Math.min(100, Math.round((allLocalKeywords.size / LOCAL_KEYWORDS_POOL.length) * 100));

  const allRegions = new Set(
    Array.from(analyses.values()).flatMap((a) => a.targetRegions)
  );

  const schemaCompliance = items.length
    ? Math.round(
        (Array.from(analyses.values()).filter((a) => a.localSchema).length / items.length) * 100
      )
    : 0;

  /* Filtered items by region */
  const filteredItems = useMemo(() => {
    if (regionFilter === "all") return items;
    return items.filter((item) => {
      const a = analyses.get(item.id);
      return a?.targetRegions.includes(regionFilter);
    });
  }, [items, regionFilter, analyses]);

  /* Auto-fix handler */
  const handleAutoFix = (fixId: string, itemId: string, suggestion: string) => {
    setApplyingFixes((prev) => new Set(prev).add(fixId));
    setTimeout(() => {
      const current = items.find((i) => i.id === itemId);
      if (current) {
        onUpdate(itemId, { geoScore: Math.min(100, current.geoScore + 3 + Math.floor(Math.random() * 5)) });
      }
      setApplyingFixes((prev) => {
        const next = new Set(prev);
        next.delete(fixId);
        return next;
      });
    }, 1200);
  };

  /* ── Empty State ── */
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-20 h-20 rounded-full bg-th-teal-soft flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-th-text mb-2">No Content to Optimize</h3>
        <p className="text-th-text-muted max-w-md">
          Generate content first using the Content Generator tab, then return here to optimize for geographic and local search relevance.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Average GEO Score", value: avgGeoScore, suffix: "/100", icon: "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3" },
          { label: "Local Keywords Coverage", value: localKeywordsCoverage, suffix: "%", icon: "M15.75 15.75l-2.489-2.489m0 0a3.375 3.375 0 10-4.773-4.773 3.375 3.375 0 004.773 4.773zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: "Region Targeting", value: allRegions.size, suffix: ` region${allRegions.size !== 1 ? "s" : ""}`, icon: "M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" },
          { label: "Local Schema Compliance", value: schemaCompliance, suffix: "%", icon: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-th-card border border-th-border rounded-xl p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-th-teal-soft flex items-center justify-center">
                <svg className="w-5 h-5 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={kpi.icon} />
                </svg>
              </div>
              <span className="text-xs text-th-text-muted font-medium uppercase tracking-wide">{kpi.label}</span>
            </div>
            <p className="text-2xl font-bold text-th-text">
              {kpi.value}<span className="text-sm font-normal text-th-text-muted ml-1">{kpi.suffix}</span>
            </p>
          </div>
        ))}
      </div>

      {/* ── Split View ── */}
      <div className="flex gap-6" style={{ minHeight: 600 }}>
        {/* Left - Article List (45%) */}
        <div className="w-[45%] shrink-0 flex flex-col bg-th-card border border-th-border rounded-xl overflow-hidden">
          {/* Header + Filter */}
          <div className="px-5 py-4 border-b border-th-border space-y-3">
            <h3 className="text-sm font-semibold text-th-text">Articles</h3>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full bg-th-bg border border-th-border rounded-lg px-3 py-2 text-sm text-th-text focus:outline-none focus:ring-2 focus:ring-th-teal/40"
            >
              <option value="all">All Regions</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Article List */}
          <div className="flex-1 overflow-y-auto divide-y divide-th-border">
            {filteredItems.length === 0 && (
              <div className="p-8 text-center text-th-text-muted text-sm">
                No articles match this region filter.
              </div>
            )}
            {filteredItems.map((item) => {
              const a = analyses.get(item.id);
              const isSelected = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left px-5 py-4 transition-colors ${
                    isSelected ? "bg-th-teal-soft/50" : "hover:bg-th-bg"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-th-text truncate">{item.title}</p>
                      <p className="text-xs text-th-text-muted mt-1 truncate">
                        {a?.targetRegions.join(", ")}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                        item.geoScore >= 80
                          ? "bg-emerald-500/15 text-emerald-600"
                          : item.geoScore >= 60
                          ? "bg-th-teal-soft text-th-teal"
                          : item.geoScore >= 40
                          ? "bg-amber-500/15 text-amber-600"
                          : "bg-red-500/15 text-red-600"
                      }`}
                    >
                      {item.geoScore}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {a?.targetRegions.slice(0, 3).map((r) => (
                      <span key={r} className="text-[10px] bg-th-teal-soft text-th-teal px-1.5 py-0.5 rounded">
                        {r}
                      </span>
                    ))}
                    {(a?.targetRegions.length || 0) > 3 && (
                      <span className="text-[10px] text-th-text-muted">+{(a?.targetRegions.length || 0) - 3}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right - GEO Analysis (55%) */}
        <div className="flex-1 space-y-5 overflow-y-auto">
          {!selectedItem || !selectedAnalysis ? (
            <div className="flex flex-col items-center justify-center h-full text-center bg-th-card border border-th-border rounded-xl py-20">
              <div className="w-16 h-16 rounded-full bg-th-teal-soft flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-th-text mb-1">Select an Article</h3>
              <p className="text-sm text-th-text-muted">Choose an article from the list to view its GEO analysis.</p>
            </div>
          ) : (
            <>
              {/* Score Gauge */}
              <div className="bg-th-card border border-th-border rounded-xl p-6 flex items-center gap-6">
                <ScoreGauge score={selectedAnalysis.score} />
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-th-text truncate">{selectedItem.title}</h3>
                  <p className="text-sm text-th-text-muted mt-1">
                    Targeting {selectedAnalysis.targetRegions.length} region{selectedAnalysis.targetRegions.length !== 1 ? "s" : ""} with{" "}
                    {selectedAnalysis.localKeywordsFound.length} local keywords detected.
                  </p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {selectedAnalysis.targetRegions.map((r) => (
                      <span key={r} className="text-xs bg-th-teal-soft text-th-teal px-2 py-1 rounded-md font-medium">{r}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Analysis Cards Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* 1. Geographic Targeting */}
                <div className="bg-th-card border border-th-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-th-teal-soft flex items-center justify-center">
                      <svg className="w-4 h-4 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-th-text">Geographic Targeting</h4>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-th-text-muted mb-1.5">Target Regions</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedAnalysis.targetRegions.map((r) => (
                          <span key={r} className="text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded">{r}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-th-text-muted mb-1.5">Missing Regions</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedAnalysis.missingRegions.map((r) => (
                          <span key={r} className="text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded">{r}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-th-text-muted mb-1.5">Region Keywords Used</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedAnalysis.regionKeywords.map((k) => (
                          <span key={k} className="text-xs bg-th-teal-soft text-th-teal px-2 py-0.5 rounded">{k}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Local Keywords */}
                <div className="bg-th-card border border-th-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-th-teal-soft flex items-center justify-center">
                      <svg className="w-4 h-4 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75l-2.489-2.489m0 0a3.375 3.375 0 10-4.773-4.773 3.375 3.375 0 004.773 4.773zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-th-text">Local Keywords</h4>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-th-text-muted mb-1.5">Found ({selectedAnalysis.localKeywordsFound.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedAnalysis.localKeywordsFound.map((k) => (
                          <span key={k} className="text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded">{k}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-th-text-muted mb-1.5">Suggested Missing</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedAnalysis.missingKeywords.map((k) => (
                          <span key={k} className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded">{k}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-th-text-muted">Keyword Density:</span>
                      <span className={`font-semibold ${selectedAnalysis.keywordDensity > 3 ? "text-red-500" : "text-th-teal"}`}>
                        {selectedAnalysis.keywordDensity}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Local Schema */}
                <div className="bg-th-card border border-th-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-th-teal-soft flex items-center justify-center">
                      <svg className="w-4 h-4 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-th-text">Local Schema</h4>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: "LocalBusiness Schema", ok: selectedAnalysis.hasLocalBusiness },
                      { label: "Address / NAP Consistency", ok: selectedAnalysis.napConsistency },
                      { label: "Opening Hours", ok: selectedAnalysis.hasOpeningHours },
                    ].map((check) => (
                      <div key={check.label} className="flex items-center justify-between">
                        <span className="text-xs text-th-text-secondary">{check.label}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          check.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"
                        }`}>
                          {check.ok ? "Pass" : "Missing"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. Citation Sources */}
                <div className="bg-th-card border border-th-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-th-teal-soft flex items-center justify-center">
                      <svg className="w-4 h-4 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-th-text">Citation Sources</h4>
                  </div>
                  <div className="space-y-2">
                    {selectedAnalysis.citations.map((c) => (
                      <div key={c.name} className="flex items-center justify-between">
                        <span className="text-xs text-th-text-secondary">{c.name}</span>
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                          c.status === "optimized"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : c.status === "listed"
                            ? "bg-th-teal-soft text-th-teal"
                            : "bg-red-500/10 text-red-500"
                        }`}>
                          {c.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. Region Relevance */}
                <div className="bg-th-card border border-th-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-th-teal-soft flex items-center justify-center">
                      <svg className="w-4 h-4 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-th-text">Region Relevance</h4>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-th-text-muted">Overall</span>
                      <span className="text-sm font-bold text-th-teal">{selectedAnalysis.regionRelevance}%</span>
                    </div>
                    {selectedAnalysis.regionRelevanceBreakdown.map((r) => (
                      <div key={r.region}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-th-text-secondary">{r.region}</span>
                          <span className="text-th-text-muted">{r.score}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-th-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-th-teal rounded-full transition-all duration-500"
                            style={{ width: `${r.score}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 6. Competitor Local Presence */}
                <div className="bg-th-card border border-th-border rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-th-teal-soft flex items-center justify-center">
                      <svg className="w-4 h-4 text-th-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-th-text">Competitor Local Presence</h4>
                  </div>
                  <div className="space-y-3">
                    {selectedAnalysis.competitors.map((c) => (
                      <div key={c.name} className="p-3 bg-th-bg rounded-lg">
                        <p className="text-xs font-semibold text-th-text">{c.name}</p>
                        <p className="text-[10px] text-th-text-muted mt-0.5">{c.strength}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Geographic Reach Map (Simulated) */}
              <div className="bg-th-card border border-th-border rounded-xl p-6">
                <h4 className="text-sm font-semibold text-th-text mb-4">Geographic Reach</h4>
                <div className="relative w-full h-48 bg-th-bg rounded-lg border border-th-border overflow-hidden">
                  {/* Simulated map background grid */}
                  <div className="absolute inset-0 opacity-[0.07]" style={{
                    backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
                    backgroundSize: "40px 40px",
                  }} />
                  {/* Colored circles for target regions */}
                  {selectedAnalysis.targetRegions.map((region, i) => {
                    const positions = [
                      { top: "20%", left: "25%" },
                      { top: "45%", left: "60%" },
                      { top: "30%", left: "75%" },
                      { top: "65%", left: "35%" },
                      { top: "55%", left: "50%" },
                    ];
                    const pos = positions[i % positions.length];
                    const size = 50 + (i * 10);
                    return (
                      <div key={region} className="absolute flex items-center justify-center" style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -50%)" }}>
                        <div
                          className="rounded-full bg-th-teal/20 border-2 border-th-teal/40 flex items-center justify-center animate-pulse"
                          style={{ width: size, height: size, animationDelay: `${i * 0.3}s` }}
                        >
                          <span className="text-[10px] font-semibold text-th-teal whitespace-nowrap">{region}</span>
                        </div>
                      </div>
                    );
                  })}
                  {/* Legend */}
                  <div className="absolute bottom-3 right-3 flex items-center gap-3 bg-th-card/90 backdrop-blur-sm rounded-md px-3 py-1.5 border border-th-border text-[10px]">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-th-teal/40" /> Target Region
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400/40" /> Missing
                    </span>
                  </div>
                  {/* Missing region indicators */}
                  {selectedAnalysis.missingRegions.map((region, i) => {
                    const positions = [
                      { top: "75%", left: "15%" },
                      { top: "15%", left: "85%" },
                    ];
                    const pos = positions[i % positions.length];
                    return (
                      <div key={region} className="absolute flex items-center justify-center" style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -50%)" }}>
                        <div className="w-9 h-9 rounded-full bg-red-400/15 border border-dashed border-red-400/40 flex items-center justify-center">
                          <span className="text-[8px] font-medium text-red-400 whitespace-nowrap">{region}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Suggestions with Auto-Fix */}
              <div className="bg-th-card border border-th-border rounded-xl p-6">
                <h4 className="text-sm font-semibold text-th-text mb-4">Optimization Suggestions</h4>
                <div className="space-y-3">
                  {selectedAnalysis.suggestions.map((suggestion, i) => {
                    const fixId = `${selectedItem.id}-fix-${i}`;
                    const isApplying = applyingFixes.has(fixId);
                    return (
                      <div key={i} className="flex items-start justify-between gap-4 p-3 bg-th-bg rounded-lg">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-5 h-5 rounded-full bg-th-teal-soft flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold text-th-teal">{i + 1}</span>
                          </div>
                          <p className="text-xs text-th-text-secondary leading-relaxed">{suggestion}</p>
                        </div>
                        <button
                          onClick={() => handleAutoFix(fixId, selectedItem.id, suggestion)}
                          disabled={isApplying}
                          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            isApplying
                              ? "bg-th-teal-soft text-th-teal cursor-wait"
                              : "bg-th-teal text-white hover:opacity-90"
                          }`}
                        >
                          {isApplying ? (
                            <span className="flex items-center gap-1.5">
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Fixing
                            </span>
                          ) : (
                            "Auto-Fix"
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
