"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { tabs, type TabKey, type GeneratorSubTab, type ConfigSubTab } from "./types";

/* ── URL slug ↔ TabKey mapping ── */
const TAB_TO_SLUG: Record<TabKey, string> = {
  Dashboard: "dashboard",
  "Content Generator": "generator",
  "Content Library": "library",
  "AEO & SRO": "aeo",
  Configuration: "config",
};
const SLUG_TO_TAB: Record<string, TabKey> = Object.fromEntries(
  Object.entries(TAB_TO_SLUG).map(([k, v]) => [v, k as TabKey])
);

import { ConfigurationTab } from "./tabs/configuration-tab";
import { ContentGeneratorTab } from "./tabs/content-generator-tab";
import ContentLibraryTab from "./tabs/content-library-tab";
import DashboardTab from "./tabs/dashboard-tab";
import AeoTab, { type AeoSuggestions, type SubTab, NAV_GROUPS } from "./tabs/aeo-tab";

const EXPANDABLE: TabKey[] = ["Content Generator", "Configuration", "AEO & SRO"];

/* ── Main nav icons ── */
const icons: Record<TabKey, React.ReactNode> = {
  Dashboard: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  "Content Generator": (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    </svg>
  ),
  "Content Library": (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  "AEO & SRO": (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
    </svg>
  ),
  Configuration: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

/* ── Sub-item icon helper ── */
function SI({ d, d2 }: { d: string; d2?: string }) {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      {d2 && <path strokeLinecap="round" strokeLinejoin="round" d={d2} />}
    </svg>
  );
}

const GENERATOR_ITEMS = [
  {
    key: "single" as GeneratorSubTab,
    label: "Single Article",
    icon: <SI d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />,
  },
  {
    key: "bulk" as GeneratorSubTab,
    label: "Bulk Generate",
    icon: <SI d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />,
  },
  {
    key: "news" as GeneratorSubTab,
    label: "News Pipeline",
    icon: <SI d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6V7.5z" />,
  },
];

const CONFIG_ITEMS = [
  {
    key: "project" as ConfigSubTab,
    label: "Project Settings",
    icon: <SI d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
  },
  {
    key: "api_keys" as ConfigSubTab,
    label: "API Keys",
    icon: <SI d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />,
  },
  {
    key: "writing_rules" as ConfigSubTab,
    label: "Writing Rules",
    icon: <SI d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />,
  },
  {
    key: "presets" as ConfigSubTab,
    label: "Industry Presets",
    icon: <SI d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />,
  },
  {
    key: "brand_aeo" as ConfigSubTab,
    label: "Brand & AEO",
    icon: <SI d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />,
  },
];

const tabDescriptions: Record<TabKey, string> = {
  Dashboard: "Pipeline overview, recent activity, and quick actions",
  "Content Generator": "Generate articles, news, and content for any industry",
  "Content Library": "Browse, search, and manage all generated content",
  "AEO & SRO": "Audit URLs for AI-readiness, run SRO analysis, generate fixes",
  Configuration: "API keys, writing rules, industry presets, and publishing config",
};

const headerTitles: Record<string, string> = {
  single: "Single Article", bulk: "Bulk Generate", news: "News Pipeline",
  project: "Project Settings", api_keys: "API Keys", writing_rules: "Writing Rules",
  presets: "Industry Presets", brand_aeo: "Brand & AEO",
};

export function ContentStudioDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabKey>("Dashboard");
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("aeo");
  const [generatorSubTab, setGeneratorSubTab] = useState<GeneratorSubTab>("single");
  const [configSubTab, setConfigSubTab] = useState<ConfigSubTab>("project");
  const [libraryInitialSlug, setLibraryInitialSlug] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; avgQuality: number } | null>(null);
  const [aeoSuggestions, setAeoSuggestions] = useState<AeoSuggestions | null>(null);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);

  /* ── Expand state — decoupled from active tab, no flicker ── */
  const [expandedGroups, setExpandedGroups] = useState<Set<TabKey>>(
    () => new Set<TabKey>(["Content Generator", "Configuration"])
  );

  const toggleGroup = useCallback((tab: TabKey, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(tab)) next.delete(tab);
      else next.add(tab);
      return next;
    });
  }, []);

  /* ── Sync state → URL ── */
  const navigate = useCallback((tab: TabKey, sub?: SubTab | GeneratorSubTab | ConfigSubTab) => {
    const params = new URLSearchParams();
    params.set("tab", TAB_TO_SLUG[tab]);
    if (tab === "AEO & SRO" && sub) params.set("sub", sub);
    if (tab === "Content Generator" && sub) params.set("sub", sub);
    if (tab === "Configuration" && sub) params.set("sub", sub);
    router.replace(`/?${params.toString()}`, { scroll: false });
    setActiveTab(tab);
    if (tab === "AEO & SRO" && sub) setActiveSubTab(sub as SubTab);
    if (tab === "Content Generator" && sub) setGeneratorSubTab(sub as GeneratorSubTab);
    if (tab === "Configuration" && sub) setConfigSubTab(sub as ConfigSubTab);
    // Auto-expand the group being navigated into
    if (EXPANDABLE.includes(tab)) {
      setExpandedGroups(prev => new Set([...prev, tab]));
    }
  }, [router]);

  /* ── URL → state on load ── */
  useEffect(() => {
    const tabSlug = searchParams.get("tab");
    const subSlug = searchParams.get("sub");
    if (tabSlug && SLUG_TO_TAB[tabSlug]) {
      const tab = SLUG_TO_TAB[tabSlug];
      setActiveTab(tab);
      if (EXPANDABLE.includes(tab)) {
        setExpandedGroups(prev => new Set([...prev, tab]));
      }
    }
    if (subSlug) {
      setActiveSubTab(subSlug as SubTab);
      setGeneratorSubTab(subSlug as GeneratorSubTab);
      setConfigSubTab(subSlug as ConfigSubTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAeoGenerate(suggestions: AeoSuggestions) {
    setAeoSuggestions(suggestions);
    navigate("Content Generator", "single");
  }

  useEffect(() => {
    setMounted(true);
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
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
          <div className="w-8 h-8 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
          <p className="text-th-text-muted text-xs">Loading Content Studio...</p>
        </div>
      </div>
    );
  }

  const headerTitle = activeTab === "Content Generator"
    ? (headerTitles[generatorSubTab] ?? activeTab)
    : activeTab === "Configuration"
    ? (headerTitles[configSubTab] ?? activeTab)
    : activeTab;

  return (
    <div className="flex h-screen bg-th-bg overflow-hidden">

      {/* ═══════════════════════════════════════ SIDEBAR ═══════════════════════════════════════ */}
      <aside
        className={`relative flex flex-col bg-th-sidebar border-r border-th-border shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
          collapsed ? "w-14" : "w-[232px]"
        }`}
      >
        {/* Brand */}
        <div className={`flex items-center h-[60px] border-b border-th-border shrink-0 ${collapsed ? "justify-center" : "px-4 gap-3"}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-th-accent to-th-purple flex items-center justify-center shrink-0 shadow-sm">
            <svg className="w-[15px] h-[15px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-th-text leading-none tracking-tight">Content Studio</p>
              <p className="text-[10px] text-th-text-muted mt-[3px] tracking-wide">AI Content Pipeline</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden" style={{ padding: collapsed ? "8px 6px" : "8px 8px" }}>
          <div className="space-y-[2px]">
            {tabs.map((tab) => {
              const isActive = activeTab === tab;
              const hasSubItems = EXPANDABLE.includes(tab);
              const isExpanded = expandedGroups.has(tab) && !collapsed;

              return (
                <div key={tab}>
                  {/* ── Main nav item ── */}
                  <button
                    onClick={() => navigate(
                      tab,
                      tab === "Content Generator" ? generatorSubTab
                        : tab === "Configuration" ? configSubTab
                        : undefined
                    )}
                    title={collapsed ? tab : undefined}
                    className={`group relative w-full flex items-center rounded-[8px] text-[13px] font-medium transition-all duration-150 select-none ${
                      collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-[10px] px-3 py-[9px]"
                    } ${
                      isActive
                        ? "bg-th-accent/[0.12] text-th-accent"
                        : "text-th-text-secondary hover:bg-th-sidebar-hover hover:text-th-text"
                    }`}
                  >
                    {/* Left accent indicator */}
                    {isActive && !collapsed && (
                      <span className="absolute left-0 inset-y-[7px] w-[3px] rounded-r-full bg-th-accent" />
                    )}

                    {/* Icon */}
                    <span className={`shrink-0 transition-colors duration-150 ${
                      isActive ? "text-th-accent" : "text-th-text-muted group-hover:text-th-text-secondary"
                    }`}>
                      {icons[tab]}
                    </span>

                    {!collapsed && (
                      <>
                        <span className="truncate flex-1 text-left">{tab}</span>
                        {hasSubItems && (
                          <span
                            role="button"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                            onClick={(e) => toggleGroup(tab, e)}
                            className={`ml-auto shrink-0 p-1 rounded-md transition-all duration-150 ${
                              isActive
                                ? "text-th-accent/60 hover:text-th-accent hover:bg-th-accent/10"
                                : "text-th-text-muted hover:text-th-text-secondary hover:bg-th-sidebar-hover"
                            }`}
                          >
                            <svg
                              className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? "rotate-180" : "rotate-0"}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </span>
                        )}
                      </>
                    )}
                  </button>

                  {/* ── Sub-items with smooth height animation ── */}
                  {hasSubItems && !collapsed && (
                    <div
                      style={{
                        maxHeight: isExpanded ? "500px" : "0px",
                        overflow: "hidden",
                        transition: "max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                    >
                      <div className="mt-[2px] mb-1 space-y-[1px]" style={{ paddingLeft: "6px", paddingRight: "6px" }}>

                        {/* Content Generator sub-items */}
                        {tab === "Content Generator" && GENERATOR_ITEMS.map(({ key, label, icon }) => {
                          const isSubActive = isActive && generatorSubTab === key;
                          return (
                            <button
                              key={key}
                              onClick={() => navigate("Content Generator", key)}
                              className={`w-full flex items-center gap-2 rounded-[6px] text-[12px] font-medium transition-all duration-150 ${
                                isSubActive
                                  ? "bg-th-accent/10 text-th-accent"
                                  : "text-th-text-muted hover:bg-th-sidebar-hover hover:text-th-text-secondary"
                              }`}
                              style={{ paddingLeft: "28px", paddingRight: "10px", paddingTop: "6px", paddingBottom: "6px" }}
                            >
                              <span className={isSubActive ? "text-th-accent" : "text-th-text-muted"}>{icon}</span>
                              <span className="truncate flex-1 text-left">{label}</span>
                              {isSubActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-th-accent shrink-0" />}
                            </button>
                          );
                        })}

                        {/* Configuration sub-items */}
                        {tab === "Configuration" && CONFIG_ITEMS.map(({ key, label, icon }) => {
                          const isSubActive = isActive && configSubTab === key;
                          return (
                            <button
                              key={key}
                              onClick={() => navigate("Configuration", key)}
                              className={`w-full flex items-center gap-2 rounded-[6px] text-[12px] font-medium transition-all duration-150 ${
                                isSubActive
                                  ? "bg-th-accent/10 text-th-accent"
                                  : "text-th-text-muted hover:bg-th-sidebar-hover hover:text-th-text-secondary"
                              }`}
                              style={{ paddingLeft: "28px", paddingRight: "10px", paddingTop: "6px", paddingBottom: "6px" }}
                            >
                              <span className={isSubActive ? "text-th-accent" : "text-th-text-muted"}>{icon}</span>
                              <span className="truncate flex-1 text-left">{label}</span>
                              {isSubActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-th-accent shrink-0" />}
                            </button>
                          );
                        })}

                        {/* AEO & SRO sub-items */}
                        {tab === "AEO & SRO" && NAV_GROUPS.map(({ group, items }) => (
                          <div key={group}>
                            <div
                              className="text-[9px] font-semibold uppercase tracking-[0.12em] text-th-text-muted"
                              style={{ padding: "8px 10px 3px 10px" }}
                            >
                              {group}
                            </div>
                            {items.map(({ key, icon, label }) => {
                              const isSubActive = isActive && activeSubTab === key;
                              return (
                                <button
                                  key={key}
                                  onClick={() => navigate("AEO & SRO", key)}
                                  className={`w-full flex items-center gap-2 rounded-[6px] text-[12px] font-medium transition-all duration-150 ${
                                    isSubActive
                                      ? "bg-th-accent/10 text-th-accent"
                                      : "text-th-text-muted hover:bg-th-sidebar-hover hover:text-th-text-secondary"
                                  }`}
                                  style={{ paddingLeft: "10px", paddingRight: "10px", paddingTop: "5px", paddingBottom: "5px" }}
                                >
                                  <span className="text-[13px] leading-none w-4 text-center shrink-0">{icon}</span>
                                  <span className="truncate flex-1 text-left">{label}</span>
                                  {isSubActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-th-accent shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* Bottom controls */}
        <div className="border-t border-th-border shrink-0 p-2 space-y-[2px]">
          <button
            onClick={toggleTheme}
            title={collapsed ? (theme === "dark" ? "Light Mode" : "Dark Mode") : undefined}
            className={`group w-full flex items-center rounded-[8px] text-[12px] text-th-text-secondary hover:bg-th-sidebar-hover hover:text-th-text transition-all duration-150 ${
              collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-[10px] px-3 py-[7px]"
            }`}
          >
            <span className="shrink-0 text-th-text-muted group-hover:text-th-text-secondary transition-colors">
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </span>
            {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
          </button>

          <button
            onClick={() => setCollapsed((p) => !p)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`group w-full flex items-center rounded-[8px] text-[12px] text-th-text-secondary hover:bg-th-sidebar-hover hover:text-th-text transition-all duration-150 ${
              collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-[10px] px-3 py-[7px]"
            }`}
          >
            <svg
              className={`w-4 h-4 shrink-0 text-th-text-muted group-hover:text-th-text-secondary transition-all duration-200 ${collapsed ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
            </svg>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ═══════════════════════════════════════ MAIN ═══════════════════════════════════════ */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 h-[60px] border-b border-th-border bg-th-card shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-th-text leading-none">{headerTitle}</h2>
            <p className="text-[11px] text-th-text-muted mt-[3px]">{tabDescriptions[activeTab]}</p>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <p className="text-[10px] text-th-text-muted uppercase tracking-wide leading-none">Articles</p>
                <p className="font-semibold text-th-text text-[13px] mt-0.5">{stats?.total ?? 0}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-th-text-muted uppercase tracking-wide leading-none">Quality</p>
                <p className="font-semibold text-th-success text-[13px] mt-0.5">{stats?.avgQuality ?? "—"}</p>
              </div>
            </div>
            <a
              href="/api/auth/logout"
              className="text-th-text-muted hover:text-th-danger text-[12px] px-2.5 py-1.5 rounded-lg border border-th-border hover:border-th-danger/40 hover:bg-th-danger/5 transition-all duration-150"
            >
              Logout
            </a>
          </div>
        </header>

        {/* Tab panels — opacity-based switching eliminates flicker & preserves scroll/state */}
        <div className="flex-1 relative overflow-hidden">
          {(["Dashboard", "Content Generator", "Content Library", "AEO & SRO", "Configuration"] as TabKey[]).map((tab) => {
            const isTabActive = activeTab === tab;
            return (
              <div
                key={tab}
                className={`absolute inset-0 overflow-y-auto p-6 transition-opacity duration-150 ${
                  isTabActive ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
                {...(!isTabActive ? { inert: true } : {})}
              >
                {tab === "Dashboard" && <DashboardTab onNavigate={(t) => navigate(t)} />}
                {tab === "Content Generator" && (
                  <ContentGeneratorTab
                    aeoSuggestions={aeoSuggestions}
                    onAeoSuggestionsConsumed={() => setAeoSuggestions(null)}
                    onArticleGenerated={() => setLibraryRefreshKey(k => k + 1)}
                    subMode={generatorSubTab}
                    onSubModeChange={(m) => navigate("Content Generator", m)}
                    onViewInLibrary={(slug) => {
                      setLibraryInitialSlug(slug);
                      setLibraryRefreshKey(k => k + 1);
                      navigate("Content Library");
                    }}
                  />
                )}
                {tab === "Content Library" && (
                  <ContentLibraryTab refreshKey={libraryRefreshKey} initialSlug={libraryInitialSlug} />
                )}
                {tab === "AEO & SRO" && (
                  <AeoTab
                    onGenerateFromAeo={handleAeoGenerate}
                    subTab={activeSubTab}
                    setSubTab={(sub) => navigate("AEO & SRO", sub)}
                  />
                )}
                {tab === "Configuration" && (
                  <ConfigurationTab
                    activeSection={configSubTab}
                    onSectionChange={(s) => navigate("Configuration", s)}
                  />
                )}
              </div>
            );
          })}
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

      <div className="cs-card p-5">
        <h3 className="text-sm font-semibold text-th-text mb-4">Quick Actions</h3>
        <div className="flex gap-3">
          <button onClick={() => onNavigate("Content Generator")} className="cs-btn cs-btn-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Generate Article
          </button>
          <button onClick={() => onNavigate("Content Library")} className="cs-btn cs-btn-secondary">Browse Library</button>
          <button onClick={() => onNavigate("Configuration")} className="cs-btn cs-btn-secondary">Configure API Keys</button>
        </div>
      </div>

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
          <svg className="w-3 h-3 text-th-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </div>
      <span className={done ? "text-th-text-muted line-through" : "text-th-text"}>{label}</span>
    </button>
  );
}
