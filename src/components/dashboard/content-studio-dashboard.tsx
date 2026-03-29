"use client";

import { useState, useEffect, useCallback } from "react";
import { tabs, type TabKey } from "./types";
import { ConfigurationTab } from "./tabs/configuration-tab";
import { ContentGeneratorTab } from "./tabs/content-generator-tab";

/* ── Icons ── */
const icons: Record<TabKey, React.ReactNode> = {
  Dashboard: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  "Content Generator": (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    </svg>
  ),
  "Content Library": (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  Configuration: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

const tabDescriptions: Record<TabKey, string> = {
  Dashboard: "Pipeline overview, recent activity, and quick actions",
  "Content Generator": "Generate articles, news, and content for any industry",
  "Content Library": "Browse, search, and manage all generated content",
  Configuration: "API keys, writing rules, industry presets, and publishing config",
};

export function ContentStudioDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("Configuration");
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; avgQuality: number } | null>(null);

  useEffect(() => {
    setMounted(true);
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
    // Fetch stats from server
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      if (next === "dark") document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
      localStorage.setItem("cs-theme", next);
      return next;
    });
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-th-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
          <p className="text-th-text-muted text-sm">Loading Content Studio...</p>
        </div>
      </div>
    );
  }

  function renderTab() {
    switch (activeTab) {
      case "Dashboard":
        return <DashboardPlaceholder stats={stats} onNavigate={setActiveTab} />;
      case "Content Generator":
        return <ContentGeneratorTab />;
      case "Content Library":
        return <PlaceholderTab name="Content Library" description="Browse and manage generated content will be here." />;
      case "Configuration":
        return <ConfigurationTab />;
    }
  }

  return (
    <div className="flex h-screen bg-th-bg overflow-hidden">
      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-th-border bg-th-sidebar transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}>
        <div className="flex items-center gap-3 px-4 h-16 border-b border-th-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-th-accent to-th-purple flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-th-text truncate">Content Studio</h1>
              <p className="text-xs text-th-text-muted">AI-Powered Content</p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                title={tab}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive ? "bg-th-sidebar-active text-th-accent" : "text-th-text-secondary hover:bg-th-sidebar-hover hover:text-th-text"
                } ${collapsed ? "justify-center" : ""}`}
              >
                <span className="shrink-0">{icons[tab]}</span>
                {!collapsed && <span className="truncate">{tab}</span>}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-th-border p-2 space-y-1 shrink-0">
          <button onClick={toggleTheme} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-th-text-secondary hover:bg-th-sidebar-hover transition-all">
            <span className="shrink-0">
              {theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>
              )}
            </span>
            {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
          </button>
          <button
            onClick={() => setCollapsed((p) => !p)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-th-text-secondary hover:bg-th-sidebar-hover transition-all"
          >
            <svg className={`w-5 h-5 transition-transform ${collapsed ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
            </svg>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 h-16 border-b border-th-border bg-th-card shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-th-text">{activeTab}</h2>
            <p className="text-xs text-th-text-muted">{tabDescriptions[activeTab]}</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-center">
              <p className="text-th-text-muted text-xs">Articles</p>
              <p className="font-semibold text-th-text">{stats?.total ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-th-text-muted text-xs">Quality</p>
              <p className="font-semibold text-th-success">{stats?.avgQuality ?? "—"}</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 animate-fadeIn">
          {renderTab()}
        </div>
      </main>
    </div>
  );
}

/* ── Dashboard placeholder ── */
function DashboardPlaceholder({
  stats,
  onNavigate,
}: {
  stats: { total: number; byStatus: Record<string, number>; avgQuality: number } | null;
  onNavigate: (tab: TabKey) => void;
}) {
  const statuses = ["pending", "outline_ready", "writing", "done", "published", "error"];
  const statusColors: Record<string, string> = {
    pending: "bg-th-text-muted",
    outline_ready: "bg-th-warning",
    writing: "bg-th-accent",
    done: "bg-th-success",
    published: "bg-th-purple",
    error: "bg-th-danger",
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Articles", value: stats?.total ?? 0, color: "text-th-text" },
          { label: "Avg Quality", value: stats?.avgQuality ? `${stats.avgQuality}/100` : "—", color: "text-th-success" },
          { label: "Published", value: stats?.byStatus?.published ?? 0, color: "text-th-purple" },
        ].map((s) => (
          <div key={s.label} className="cs-card p-5">
            <p className="text-xs text-th-text-muted">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline status */}
      <div className="cs-card p-5">
        <h3 className="text-sm font-semibold text-th-text mb-4">Pipeline Status</h3>
        <div className="flex gap-3">
          {statuses.map((s) => (
            <div key={s} className="flex items-center gap-2 text-sm">
              <div className={`w-2.5 h-2.5 rounded-full ${statusColors[s]}`} />
              <span className="text-th-text-secondary capitalize">{s.replace("_", " ")}</span>
              <span className="font-semibold text-th-text">{stats?.byStatus?.[s] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="cs-card p-5">
        <h3 className="text-sm font-semibold text-th-text mb-4">Quick Actions</h3>
        <div className="flex gap-3">
          <button onClick={() => onNavigate("Content Generator")} className="cs-btn cs-btn-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Generate Article
          </button>
          <button onClick={() => onNavigate("Content Library")} className="cs-btn cs-btn-secondary">
            Browse Library
          </button>
          <button onClick={() => onNavigate("Configuration")} className="cs-btn cs-btn-secondary">
            Configure API Keys
          </button>
        </div>
      </div>

      {/* Setup checklist */}
      <div className="cs-card p-5">
        <h3 className="text-sm font-semibold text-th-text mb-4">Setup Checklist</h3>
        <div className="space-y-2 text-sm">
          <SetupItem label="Configure Gemini API key" done={false} onClick={() => onNavigate("Configuration")} />
          <SetupItem label="Configure You.com Search key" done={false} onClick={() => onNavigate("Configuration")} />
          <SetupItem label="Set industry and brand" done={false} onClick={() => onNavigate("Configuration")} />
          <SetupItem label="Generate first article" done={(stats?.total ?? 0) > 0} onClick={() => onNavigate("Content Generator")} />
        </div>
      </div>
    </div>
  );
}

function SetupItem({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 w-full text-left py-1.5 hover:text-th-accent transition-colors">
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${done ? "border-th-success bg-th-success-soft" : "border-th-border"}`}>
        {done && (
          <svg className="w-3 h-3 text-th-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
        )}
      </div>
      <span className={done ? "text-th-text-muted line-through" : "text-th-text"}>{label}</span>
    </button>
  );
}

/* ── Generic placeholder for unbuilt tabs ── */
function PlaceholderTab({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-96 text-center">
      <div className="w-16 h-16 rounded-2xl bg-th-accent-soft flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-th-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.384 3.178 1.029-5.993-4.357-4.245 6.02-.875L11.42 2l2.693 5.235 6.02.875-4.357 4.245 1.029 5.993z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-th-text mb-2">{name}</h3>
      <p className="text-sm text-th-text-muted max-w-md">{description}</p>
      <p className="text-xs text-th-text-muted mt-4">Coming in the next phase</p>
    </div>
  );
}
