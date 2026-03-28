"use client";

import { useState, useEffect, useCallback } from "react";
import { tabs, type TabKey, type AppState, type ContentItem, defaultSettings } from "./types";
import { ContentGeneratorTab } from "./tabs/content-generator-tab";
import { ContentLibraryTab } from "./tabs/content-library-tab";
import { SeoOptimizerTab } from "./tabs/seo-optimizer-tab";
import { AeoOptimizerTab } from "./tabs/aeo-optimizer-tab";
import { GeoOptimizerTab } from "./tabs/geo-optimizer-tab";
import { SettingsTab } from "./tabs/settings-tab";

/* ── Icons ── */
const icons: Record<TabKey, React.ReactNode> = {
  "Content Generator": (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
    </svg>
  ),
  "Content Library": (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  "SEO Optimizer": (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
    </svg>
  ),
  "AEO Optimizer": (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  ),
  "GEO Optimizer": (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  ),
  Settings: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

const defaultState: AppState = {
  activeTab: "Content Generator",
  theme: "system",
  settings: defaultSettings,
  contentLibrary: [],
  bulkJobs: [],
  sidebarCollapsed: false,
};

export function ContentStudioDashboard() {
  const [state, setState] = useState<AppState>(defaultState);
  const [mounted, setMounted] = useState(false);

  // Load state from localStorage on mount
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem("cs-state");
      if (saved) {
        const parsed = JSON.parse(saved);
        setState((prev) => ({ ...prev, ...parsed }));
      }
    } catch {}
  }, []);

  // Persist state
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("cs-state", JSON.stringify(state));
    } catch {}
  }, [state, mounted]);

  // Theme toggle
  const toggleTheme = useCallback(() => {
    setState((prev) => {
      const next = prev.theme === "dark" ? "light" : prev.theme === "light" ? "dark" : "dark";
      if (next === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      localStorage.setItem("cs-theme", next);
      return { ...prev, theme: next };
    });
  }, []);

  const setTab = useCallback((tab: TabKey) => {
    setState((prev) => ({ ...prev, activeTab: tab }));
  }, []);

  const updateSettings = useCallback((settings: Partial<AppState["settings"]>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...settings } }));
  }, []);

  const addContent = useCallback((item: ContentItem) => {
    setState((prev) => ({ ...prev, contentLibrary: [item, ...prev.contentLibrary] }));
  }, []);

  const updateContent = useCallback((id: string, updates: Partial<ContentItem>) => {
    setState((prev) => ({
      ...prev,
      contentLibrary: prev.contentLibrary.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
  }, []);

  const deleteContent = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      contentLibrary: prev.contentLibrary.filter((c) => c.id !== id),
    }));
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

  function renderActiveTab() {
    switch (state.activeTab) {
      case "Content Generator":
        return (
          <ContentGeneratorTab
            settings={state.settings}
            onContentCreated={addContent}
          />
        );
      case "Content Library":
        return (
          <ContentLibraryTab
            items={state.contentLibrary}
            onUpdate={updateContent}
            onDelete={deleteContent}
          />
        );
      case "SEO Optimizer":
        return (
          <SeoOptimizerTab
            items={state.contentLibrary}
            onUpdate={updateContent}
          />
        );
      case "AEO Optimizer":
        return (
          <AeoOptimizerTab
            items={state.contentLibrary}
            onUpdate={updateContent}
          />
        );
      case "GEO Optimizer":
        return (
          <GeoOptimizerTab
            items={state.contentLibrary}
            onUpdate={updateContent}
          />
        );
      case "Settings":
        return (
          <SettingsTab
            settings={state.settings}
            onUpdate={updateSettings}
          />
        );
    }
  }

  return (
    <div className="flex h-screen bg-th-bg overflow-hidden">
      {/* ── Sidebar ── */}
      <aside
        className={`flex flex-col border-r border-th-border bg-th-sidebar transition-all duration-200 ${
          state.sidebarCollapsed ? "w-16" : "w-64"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-th-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-th-accent to-th-purple flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          {!state.sidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-th-text truncate">Content Studio</h1>
              <p className="text-xs text-th-text-muted">AI-Powered Content</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {tabs.map((tab) => {
            const isActive = state.activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setTab(tab)}
                title={tab}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-th-sidebar-active text-th-accent"
                    : "text-th-text-secondary hover:bg-th-sidebar-hover hover:text-th-text"
                } ${state.sidebarCollapsed ? "justify-center" : ""}`}
              >
                <span className="shrink-0">{icons[tab]}</span>
                {!state.sidebarCollapsed && <span className="truncate">{tab}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom controls */}
        <div className="border-t border-th-border p-2 space-y-1 shrink-0">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-th-text-secondary hover:bg-th-sidebar-hover hover:text-th-text transition-all"
          >
            <span className="shrink-0">
              {state.theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </span>
            {!state.sidebarCollapsed && <span>{state.theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
          </button>

          {/* Collapse toggle */}
          <button
            onClick={() => setState((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed }))}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-th-text-secondary hover:bg-th-sidebar-hover hover:text-th-text transition-all"
          >
            <span className="shrink-0">
              <svg
                className={`w-5 h-5 transition-transform ${state.sidebarCollapsed ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
              </svg>
            </span>
            {!state.sidebarCollapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 h-16 border-b border-th-border bg-th-card shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-th-text">{state.activeTab}</h2>
            <p className="text-xs text-th-text-muted">
              {state.activeTab === "Content Generator" && "Create content for any topic with AI-powered template detection"}
              {state.activeTab === "Content Library" && "Browse, search, and manage all your generated content"}
              {state.activeTab === "SEO Optimizer" && "Analyze and improve on-page SEO for your content"}
              {state.activeTab === "AEO Optimizer" && "Optimize content for AI answer engines and featured snippets"}
              {state.activeTab === "GEO Optimizer" && "Optimize for geographic and local search relevance"}
              {state.activeTab === "Settings" && "Configure your project, API keys, and publishing targets"}
            </p>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <p className="text-th-text-muted text-xs">Articles</p>
                <p className="font-semibold text-th-text">{state.contentLibrary.length}</p>
              </div>
              <div className="text-center">
                <p className="text-th-text-muted text-xs">Avg SEO</p>
                <p className="font-semibold text-th-success">
                  {state.contentLibrary.length
                    ? Math.round(state.contentLibrary.reduce((a, b) => a + b.seoScore, 0) / state.contentLibrary.length)
                    : "—"}
                </p>
              </div>
              <div className="text-center">
                <p className="text-th-text-muted text-xs">Avg AEO</p>
                <p className="font-semibold text-th-purple">
                  {state.contentLibrary.length
                    ? Math.round(state.contentLibrary.reduce((a, b) => a + b.aeoScore, 0) / state.contentLibrary.length)
                    : "—"}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6 animate-fadeIn">
          {renderActiveTab()}
        </div>
      </main>
    </div>
  );
}
