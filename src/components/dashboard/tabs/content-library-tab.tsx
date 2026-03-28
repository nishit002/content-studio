"use client";

import { useState, useMemo, useCallback } from "react";
import {
  type ContentItem,
  type ContentStatus,
  type ContentType,
  contentTypeLabels,
} from "../types";

/* ── Props ── */
type Props = {
  items: ContentItem[];
  onUpdate: (id: string, updates: Partial<ContentItem>) => void;
  onDelete: (id: string) => void;
};

/* ── Constants ── */
type SortKey = "newest" | "oldest" | "seo" | "aeo";
type ViewMode = "grid" | "list";

const statusColors: Record<ContentStatus, { bg: string; text: string; dot: string }> = {
  draft: { bg: "bg-th-bg-secondary", text: "text-th-text-muted", dot: "bg-th-text-muted" },
  optimizing: { bg: "bg-th-warning-soft", text: "text-th-warning", dot: "bg-th-warning" },
  ready: { bg: "bg-th-success-soft", text: "text-th-success", dot: "bg-th-success" },
  published: { bg: "bg-th-accent-soft", text: "text-th-accent", dot: "bg-th-accent" },
  error: { bg: "bg-th-danger-soft", text: "text-th-danger", dot: "bg-th-danger" },
};

const typeColors: Record<ContentType, { bg: string; text: string }> = {
  blog_post: { bg: "bg-th-accent-soft", text: "text-th-accent" },
  listicle: { bg: "bg-th-purple-soft", text: "text-th-purple" },
  comparison: { bg: "bg-th-teal-soft", text: "text-th-teal" },
  how_to_guide: { bg: "bg-th-success-soft", text: "text-th-success" },
  product_review: { bg: "bg-th-orange-soft", text: "text-th-orange" },
  case_study: { bg: "bg-th-pink-soft", text: "text-th-pink" },
  news_article: { bg: "bg-th-warning-soft", text: "text-th-warning" },
  opinion_piece: { bg: "bg-th-purple-soft", text: "text-th-purple" },
  technical_guide: { bg: "bg-th-teal-soft", text: "text-th-teal" },
  landing_page: { bg: "bg-th-accent-soft", text: "text-th-accent" },
  custom: { bg: "bg-th-bg-secondary", text: "text-th-text-secondary" },
};

/* ── Icons ── */
function SearchIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function GridIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function ListIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
    </svg>
  );
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function EditIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
    </svg>
  );
}

function ChevronDownIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function SparklesIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    </svg>
  );
}

function DocumentIcon({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function DownloadIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function SortIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 16.5m0 0L12 12m4.5 4.5V3" />
    </svg>
  );
}

/* ── Score Ring ── */
function ScoreRing({
  value,
  label,
  color,
  size = 44,
}: {
  value: number;
  label: string;
  color: string;
  size?: number;
}) {
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
          style={{ color }}
        >
          {value}
        </span>
      </div>
      <span className="text-[10px] font-medium text-th-text-muted uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

/* ── Score Bar (compact, for list view) ── */
function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 rounded-full bg-th-border-subtle overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/* ── Helpers ── */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function exportCsv(items: ContentItem[]) {
  const headers = ["Title", "Topic", "Type", "Status", "SEO", "AEO", "GEO", "Words", "Created"];
  const rows = items.map((i) => [
    `"${i.title.replace(/"/g, '""')}"`,
    `"${i.topic.replace(/"/g, '""')}"`,
    contentTypeLabels[i.type],
    i.status,
    i.seoScore,
    i.aeoScore,
    i.geoScore,
    i.wordCount,
    i.createdAt,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "content-library.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════════════ */
export function ContentLibraryTab({ items, onUpdate, onDelete }: Props) {
  /* ── Local state ── */
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContentStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ContentType | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optimizeDropdown, setOptimizeDropdown] = useState<string | null>(null);

  /* ── Derived data ── */
  const filtered = useMemo(() => {
    let result = [...items];

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.topic.toLowerCase().includes(q) ||
          i.keywords.some((k) => k.toLowerCase().includes(q))
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter((i) => i.status === statusFilter);
    }

    // Type filter
    if (typeFilter !== "all") {
      result = result.filter((i) => i.type === typeFilter);
    }

    // Sort
    switch (sortKey) {
      case "newest":
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "oldest":
        result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "seo":
        result.sort((a, b) => b.seoScore - a.seoScore);
        break;
      case "aeo":
        result.sort((a, b) => b.aeoScore - a.aeoScore);
        break;
    }

    return result;
  }, [items, search, statusFilter, typeFilter, sortKey]);

  /* ── Selection helpers ── */
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === filtered.length) return new Set();
      return new Set(filtered.map((i) => i.id));
    });
  }, [filtered]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const deleteSelected = useCallback(() => {
    selected.forEach((id) => onDelete(id));
    clearSelection();
  }, [selected, onDelete, clearSelection]);

  const bulkOptimize = useCallback(
    (type: "seo" | "aeo" | "geo") => {
      selected.forEach((id) => {
        onUpdate(id, { status: "optimizing" });
      });
      clearSelection();
    },
    [selected, onUpdate, clearSelection]
  );

  /* ── Status badge ── */
  function StatusBadge({ status }: { status: ContentStatus }) {
    const c = statusColors[status];
    return (
      <span className={`cs-badge ${c.bg} ${c.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot} mr-1.5`} />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  }

  /* ── Type badge ── */
  function TypeBadge({ type }: { type: ContentType }) {
    const c = typeColors[type];
    return (
      <span className={`cs-badge ${c.bg} ${c.text}`}>
        {contentTypeLabels[type]}
      </span>
    );
  }

  /* ── Optimize dropdown button ── */
  function OptimizeButton({ itemId }: { itemId: string }) {
    const isOpen = optimizeDropdown === itemId;
    return (
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOptimizeDropdown(isOpen ? null : itemId);
          }}
          className="cs-btn cs-btn-ghost px-2 py-1 text-xs gap-1"
        >
          <SparklesIcon className="w-3.5 h-3.5" />
          Optimize
          <ChevronDownIcon className="w-3 h-3" />
        </button>
        {isOpen && (
          <div className="absolute right-0 top-full mt-1 z-20 w-36 py-1 cs-card shadow-lg animate-fadeIn">
            {(["seo", "aeo", "geo"] as const).map((t) => (
              <button
                key={t}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(itemId, { status: "optimizing" });
                  setOptimizeDropdown(null);
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-th-text-secondary hover:bg-th-bg-secondary hover:text-th-text transition-colors"
              >
                {t === "seo" && "SEO Optimize"}
                {t === "aeo" && "AEO Optimize"}
                {t === "geo" && "GEO Optimize"}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     Empty State
     ══════════════════════════════════════════════════════════ */
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 animate-fadeIn">
        <div className="w-20 h-20 rounded-2xl bg-th-accent-soft flex items-center justify-center mb-6">
          <DocumentIcon className="w-10 h-10 text-th-accent" />
        </div>
        <h3 className="text-xl font-semibold text-th-text mb-2">No content yet</h3>
        <p className="text-th-text-muted text-sm mb-6 max-w-md text-center">
          Your content library is empty. Start by generating your first article using the Content Generator.
        </p>
        <button className="cs-btn cs-btn-primary">
          <SparklesIcon className="w-4 h-4" />
          Create your first article
        </button>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     No results after filtering
     ══════════════════════════════════════════════════════════ */
  const noResults = filtered.length === 0 && items.length > 0;

  /* ══════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════ */
  return (
    <div
      className="space-y-4 animate-fadeIn"
      onClick={() => setOptimizeDropdown(null)}
    >
      {/* ── Top Bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-th-text-muted" />
          <input
            type="text"
            placeholder="Search titles, topics, keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="cs-input pl-9"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ContentStatus | "all")}
          className="cs-input w-auto min-w-[130px]"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="optimizing">Optimizing</option>
          <option value="ready">Ready</option>
          <option value="published">Published</option>
          <option value="error">Error</option>
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ContentType | "all")}
          className="cs-input w-auto min-w-[150px]"
        >
          <option value="all">All Types</option>
          {(Object.keys(contentTypeLabels) as ContentType[]).map((t) => (
            <option key={t} value={t}>
              {contentTypeLabels[t]}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="cs-input w-auto min-w-[160px]"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="seo">Highest SEO Score</option>
          <option value="aeo">Highest AEO Score</option>
        </select>

        {/* View toggle */}
        <div className="flex items-center border border-th-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 transition-colors ${
              viewMode === "grid"
                ? "bg-th-accent text-th-text-inverse"
                : "bg-th-card text-th-text-muted hover:text-th-text"
            }`}
            title="Grid view"
          >
            <GridIcon />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 transition-colors ${
              viewMode === "list"
                ? "bg-th-accent text-th-text-inverse"
                : "bg-th-card text-th-text-muted hover:text-th-text"
            }`}
            title="List view"
          >
            <ListIcon />
          </button>
        </div>

        {/* Count badge */}
        <span className="cs-badge bg-th-accent-soft text-th-accent font-semibold tabular-nums">
          {filtered.length} item{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── No results state ── */}
      {noResults && (
        <div className="flex flex-col items-center py-16">
          <SearchIcon className="w-10 h-10 text-th-text-muted mb-4" />
          <h3 className="text-lg font-semibold text-th-text mb-1">No results found</h3>
          <p className="text-th-text-muted text-sm">
            Try adjusting your search or filters.
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
         Grid View
         ══════════════════════════════════════════════════════════ */}
      {!noResults && viewMode === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((item) => {
            const isSelected = selected.has(item.id);
            return (
              <div
                key={item.id}
                className={`cs-card p-4 flex flex-col gap-3 transition-all ${
                  isSelected ? "ring-2 ring-th-accent" : ""
                }`}
              >
                {/* Top row: checkbox + type badge + status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      className="w-4 h-4 rounded border-th-border text-th-accent focus:ring-th-ring accent-[var(--accent)]"
                    />
                    <TypeBadge type={item.type} />
                  </div>
                  <StatusBadge status={item.status} />
                </div>

                {/* Title */}
                <h3 className="text-sm font-semibold text-th-text leading-snug line-clamp-2">
                  {item.title}
                </h3>

                {/* Topic */}
                <p className="text-xs text-th-text-muted leading-relaxed line-clamp-1">
                  {item.topic}
                </p>

                {/* Score rings */}
                <div className="flex items-center justify-around py-2">
                  <ScoreRing value={item.seoScore} label="SEO" color="var(--success)" />
                  <ScoreRing value={item.aeoScore} label="AEO" color="var(--purple)" />
                  <ScoreRing value={item.geoScore} label="GEO" color="var(--teal)" />
                </div>

                {/* Meta row */}
                <div className="flex items-center justify-between text-xs text-th-text-muted pt-1 border-t border-th-border-subtle">
                  <span>{item.wordCount.toLocaleString()} words</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 pt-1">
                  <button className="cs-btn cs-btn-secondary px-2.5 py-1 text-xs flex-1">
                    <EditIcon className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <OptimizeButton itemId={item.id} />
                  <button
                    onClick={() => onDelete(item.id)}
                    className="cs-btn cs-btn-ghost px-2 py-1 text-xs text-th-danger hover:bg-th-danger-soft"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
         List View
         ══════════════════════════════════════════════════════════ */}
      {!noResults && viewMode === "list" && (
        <div className="cs-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-th-border">
                  <th className="text-left p-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-th-border accent-[var(--accent)]"
                    />
                  </th>
                  <th className="text-left p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    Title
                  </th>
                  <th className="text-left p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    Type
                  </th>
                  <th className="text-left p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-center p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    <span className="flex items-center justify-center gap-1">
                      SEO <SortIcon />
                    </span>
                  </th>
                  <th className="text-center p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    <span className="flex items-center justify-center gap-1">
                      AEO <SortIcon />
                    </span>
                  </th>
                  <th className="text-center p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    <span className="flex items-center justify-center gap-1">
                      GEO <SortIcon />
                    </span>
                  </th>
                  <th className="text-right p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    Words
                  </th>
                  <th className="text-right p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    Date
                  </th>
                  <th className="text-right p-3 font-medium text-th-text-muted text-xs uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isSelected = selected.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-th-border-subtle transition-colors hover:bg-th-card-hover ${
                        isSelected ? "bg-th-accent-soft" : ""
                      }`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.id)}
                          className="w-4 h-4 rounded border-th-border accent-[var(--accent)]"
                        />
                      </td>
                      <td className="p-3">
                        <div className="max-w-xs">
                          <p className="font-medium text-th-text truncate">{item.title}</p>
                          <p className="text-xs text-th-text-muted truncate">{item.topic}</p>
                        </div>
                      </td>
                      <td className="p-3">
                        <TypeBadge type={item.type} />
                      </td>
                      <td className="p-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="p-3">
                        <div className="flex justify-center">
                          <ScoreBar value={item.seoScore} color="var(--success)" />
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-center">
                          <ScoreBar value={item.aeoScore} color="var(--purple)" />
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-center">
                          <ScoreBar value={item.geoScore} color="var(--teal)" />
                        </div>
                      </td>
                      <td className="p-3 text-right text-th-text-secondary tabular-nums">
                        {item.wordCount.toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-th-text-muted text-xs whitespace-nowrap">
                        {formatDateShort(item.createdAt)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          <button className="cs-btn cs-btn-ghost px-2 py-1 text-xs">
                            <EditIcon className="w-3.5 h-3.5" />
                          </button>
                          <OptimizeButton itemId={item.id} />
                          <button
                            onClick={() => onDelete(item.id)}
                            className="cs-btn cs-btn-ghost px-2 py-1 text-xs text-th-danger hover:bg-th-danger-soft"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
         Bulk Action Bar
         ══════════════════════════════════════════════════════════ */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fadeIn">
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-th-card border border-th-border shadow-2xl">
            <span className="text-sm font-medium text-th-text">
              {selected.size} selected
            </span>

            <div className="w-px h-6 bg-th-border" />

            <button
              onClick={deleteSelected}
              className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs text-th-danger hover:bg-th-danger-soft"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              Delete Selected
            </button>

            <button
              onClick={() => bulkOptimize("seo")}
              className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs text-th-success hover:bg-th-success-soft"
            >
              <SparklesIcon className="w-3.5 h-3.5" />
              Bulk Optimize SEO
            </button>

            <button
              onClick={() => {
                const selectedItems = items.filter((i) => selected.has(i.id));
                exportCsv(selectedItems);
              }}
              className="cs-btn cs-btn-ghost px-3 py-1.5 text-xs"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              Export CSV
            </button>

            <div className="w-px h-6 bg-th-border" />

            <button
              onClick={clearSelection}
              className="cs-btn cs-btn-ghost px-2 py-1.5 text-xs text-th-text-muted"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
