"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TabKey } from "../types";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */
interface Connection {
  provider: string;
  property_id: string;
  property_name: string;
  email: string;
  connected: boolean;
  connected_at: string;
}
interface PropertyOption {
  id: string;
  name: string;
  account?: string;
  permission?: string;
}
interface GA4Overview {
  sessions: number; users: number; pageviews: number;
  avgDuration: number; bounceRate: number; newUsers: number;
}
interface TimeseriesPoint { date: string; sessions?: number; users?: number; pageviews?: number; clicks?: number; impressions?: number; ctr?: number; position?: number; }
interface GSCOverview { clicks: number; impressions: number; ctr: number; position: number; }
interface QueryRow { query: string; clicks: number; impressions: number; ctr: number; position: number; }
interface PageRow { path?: string; page?: string; title?: string; pageviews?: number; clicks?: number; impressions?: number; users?: number; }
interface SourceRow { channel: string; sessions: number; users: number; pageviews: number; }
interface BingOverview { clicks: number; impressions: number; ctr: number; avgPosition: number; }

type DateRange = "7" | "28" | "90";

const PROVIDERS = [
  { id: "ga4", name: "Google Analytics", icon: "M", color: "from-orange-500 to-amber-500", desc: "Traffic, sessions, pageviews" },
  { id: "gsc", name: "Search Console", icon: "S", color: "from-blue-500 to-cyan-500", desc: "Clicks, impressions, rankings" },
  { id: "bing", name: "Bing Webmaster", icon: "B", color: "from-teal-500 to-emerald-500", desc: "Bing traffic, crawl, backlinks" },
] as const;

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */
export default function DashboardTab({ onNavigate }: { onNavigate: (tab: TabKey) => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>("28");
  const [loading, setLoading] = useState(true);

  // Data states
  const [ga4Overview, setGa4Overview] = useState<GA4Overview | null>(null);
  const [ga4Timeseries, setGa4Timeseries] = useState<TimeseriesPoint[]>([]);
  const [ga4Sources, setGa4Sources] = useState<SourceRow[]>([]);
  const [ga4Pages, setGa4Pages] = useState<PageRow[]>([]);
  const [gscOverview, setGscOverview] = useState<GSCOverview | null>(null);
  const [gscTimeseries, setGscTimeseries] = useState<TimeseriesPoint[]>([]);
  const [gscQueries, setGscQueries] = useState<QueryRow[]>([]);
  const [bingOverview, setBingOverview] = useState<BingOverview | null>(null);

  // Property picker modal
  const [pickerProvider, setPickerProvider] = useState<string | null>(null);
  const [pickerOptions, setPickerOptions] = useState<PropertyOption[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Article stats
  const [articleCount, setArticleCount] = useState(0);
  const [totalWords, setTotalWords] = useState(0);

  // Fetch connections + check URL params
  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/auth?action=list");
      const data = await res.json();
      setConnections(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }, []);

  // Fetch all analytics data for connected providers
  const fetchAnalyticsData = useCallback(async (conns: Connection[], days: string) => {
    const ga4 = conns.find((c) => c.provider === "ga4" && c.connected && c.property_id);
    const gsc = conns.find((c) => c.provider === "gsc" && c.connected && c.property_id);
    const bing = conns.find((c) => c.provider === "bing" && c.connected && c.property_id);

    const fetches: Promise<void>[] = [];

    if (ga4) {
      fetches.push(
        fetch(`/api/analytics/ga4?metric=overview&days=${days}`).then((r) => r.json()).then(setGa4Overview).catch(() => {}),
        fetch(`/api/analytics/ga4?metric=timeseries&days=${days}`).then((r) => r.json()).then((d) => setGa4Timeseries(Array.isArray(d) ? d : [])).catch(() => {}),
        fetch(`/api/analytics/ga4?metric=sources&days=${days}`).then((r) => r.json()).then((d) => setGa4Sources(Array.isArray(d) ? d : [])).catch(() => {}),
        fetch(`/api/analytics/ga4?metric=pages&days=${days}`).then((r) => r.json()).then((d) => setGa4Pages(Array.isArray(d) ? d : [])).catch(() => {}),
      );
    }
    if (gsc) {
      fetches.push(
        fetch(`/api/analytics/gsc?metric=overview&days=${days}`).then((r) => r.json()).then(setGscOverview).catch(() => {}),
        fetch(`/api/analytics/gsc?metric=timeseries&days=${days}`).then((r) => r.json()).then((d) => setGscTimeseries(Array.isArray(d) ? d : [])).catch(() => {}),
        fetch(`/api/analytics/gsc?metric=queries&days=${days}`).then((r) => r.json()).then((d) => setGscQueries(Array.isArray(d) ? d : [])).catch(() => {}),
      );
    }
    if (bing) {
      fetches.push(
        fetch(`/api/analytics/bing?metric=overview`).then((r) => r.json()).then(setBingOverview).catch(() => {}),
      );
    }

    await Promise.all(fetches);
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      const conns = await fetchConnections();

      // Check URL for post-OAuth redirect
      const params = new URLSearchParams(window.location.search);
      const connected = params.get("analytics_connected");
      if (connected) {
        window.history.replaceState({}, "", "/");
        setPickerProvider(connected);
        loadProperties(connected);
      }

      // Fetch article stats
      try {
        const res = await fetch("/api/article?list=true");
        const articles = await res.json();
        if (Array.isArray(articles)) {
          setArticleCount(articles.length);
          setTotalWords(articles.reduce((s: number, a: { word_count: number }) => s + a.word_count, 0));
        }
      } catch { /* ignore */ }

      await fetchAnalyticsData(conns, dateRange);
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when date range changes
  useEffect(() => {
    if (!loading) {
      fetchAnalyticsData(connections, dateRange);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  // Start OAuth
  const startOAuth = async (provider: string) => {
    try {
      const res = await fetch(`/api/analytics/auth?provider=${provider}`);
      const data = await res.json();
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      } else if (data.error) {
        alert(data.error);
      }
    } catch { alert("Failed to start authentication"); }
  };

  // Load properties for picker
  const loadProperties = async (provider: string) => {
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/analytics/auth?action=properties&provider=${provider}`);
      const data = await res.json();
      setPickerOptions(Array.isArray(data) ? data : []);
    } catch { setPickerOptions([]); }
    setPickerLoading(false);
  };

  // Select property
  const selectProperty = async (provider: string, id: string, name: string) => {
    await fetch("/api/analytics/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, property_id: id, property_name: name }),
    });
    setPickerProvider(null);
    setPickerOptions([]);
    const conns = await fetchConnections();
    await fetchAnalyticsData(conns, dateRange);
  };

  // Disconnect
  const disconnect = async (provider: string) => {
    await fetch(`/api/analytics/auth?provider=${provider}`, { method: "DELETE" });
    const conns = await fetchConnections();
    if (provider === "ga4") { setGa4Overview(null); setGa4Timeseries([]); setGa4Sources([]); setGa4Pages([]); }
    if (provider === "gsc") { setGscOverview(null); setGscTimeseries([]); setGscQueries([]); }
    if (provider === "bing") { setBingOverview(null); }
    await fetchAnalyticsData(conns, dateRange);
  };

  const ga4Connected = connections.find((c) => c.provider === "ga4" && c.connected && c.property_id);
  const gscConnected = connections.find((c) => c.provider === "gsc" && c.connected && c.property_id);
  const bingConnected = connections.find((c) => c.provider === "bing" && c.connected && c.property_id);
  const anyConnected = ga4Connected || gscConnected || bingConnected;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
          <p className="text-sm text-th-text-muted">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1400px]">

      {/* ── Welcome + Content Stats (always visible) ── */}
      <div className="flex items-start gap-4">
        <div className="cs-card p-5 flex-1 bg-gradient-to-r from-th-card to-th-bg-secondary">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-th-text">
                {articleCount === 0 ? "Welcome to Content Studio" : "Your Content at a Glance"}
              </h2>
              <p className="text-xs text-th-text-muted mt-1 max-w-md">
                {articleCount === 0
                  ? "Start by generating your first article, then connect analytics to track how it performs."
                  : anyConnected
                    ? `Tracking ${[ga4Connected && "traffic", gscConnected && "search", bingConnected && "Bing"].filter(Boolean).join(", ")} for ${articleCount.toLocaleString()} articles.`
                    : `${articleCount.toLocaleString()} articles generated. Connect analytics below to see how they're performing.`
                }
              </p>
            </div>
            <div className="flex items-center gap-6 shrink-0">
              <div className="text-center">
                <p className="text-2xl font-bold text-th-text">{fmtNum(articleCount)}</p>
                <p className="text-[10px] text-th-text-muted">Articles</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-th-text">{totalWords >= 1000000 ? `${(totalWords / 1e6).toFixed(1)}M` : totalWords >= 1000 ? `${(totalWords / 1000).toFixed(0)}K` : totalWords}</p>
                <p className="text-[10px] text-th-text-muted">Words</p>
              </div>
              {ga4Overview && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-orange-500">{fmtNum(ga4Overview.sessions)}</p>
                  <p className="text-[10px] text-th-text-muted">Sessions</p>
                </div>
              )}
              {gscOverview && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-500">{fmtNum(gscOverview.clicks)}</p>
                  <p className="text-[10px] text-th-text-muted">Search Clicks</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Date range selector */}
        {anyConnected && (
          <div className="flex items-center bg-th-bg-secondary rounded-lg p-0.5 shrink-0 mt-3">
            {(["7", "28", "90"] as DateRange[]).map((d) => (
              <button
                key={d}
                onClick={() => setDateRange(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  dateRange === d ? "bg-th-card text-th-text shadow-sm" : "text-th-text-muted hover:text-th-text"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Connection Cards ── */}
      <div className="flex gap-3">
          {PROVIDERS.map((p) => {
            const conn = connections.find((c) => c.provider === p.id);
            const isConnected = conn?.connected && conn.property_id;
            return (
              <div key={p.id} className="cs-card p-4 flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                      {p.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-th-text truncate">{p.name}</p>
                      <p className="text-[10px] text-th-text-muted truncate">
                        {isConnected ? conn!.property_name || conn!.property_id : p.desc}
                      </p>
                    </div>
                  </div>
                  {isConnected ? (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <button onClick={() => disconnect(p.id)} className="text-[10px] text-th-text-muted hover:text-th-danger transition-colors">
                        Disconnect
                      </button>
                    </div>
                  ) : conn?.connected ? (
                    <button
                      onClick={() => { setPickerProvider(p.id); loadProperties(p.id); }}
                      className="text-[10px] font-medium text-th-accent hover:text-th-accent-hover transition-colors"
                    >
                      Pick property
                    </button>
                  ) : (
                    <button
                      onClick={() => startOAuth(p.id)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-th-accent text-white hover:bg-th-accent-hover transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
                {isConnected && conn!.email && (
                  <p className="text-[10px] text-th-text-muted truncate mt-1 pl-[42px]">{conn!.email}</p>
                )}
              </div>
            );
          })}
      </div>

      {/* ── KPI Cards ── */}
      {anyConnected && (
        <div className="grid grid-cols-4 gap-3">
          {ga4Overview && (
            <>
              <KpiCard label="Sessions" value={fmtNum(ga4Overview.sessions)} icon={iconSessions} color="text-orange-500" sub={`${fmtNum(ga4Overview.newUsers)} new users`} />
              <KpiCard label="Pageviews" value={fmtNum(ga4Overview.pageviews)} icon={iconPageviews} color="text-blue-500" sub={`${fmtNum(ga4Overview.users)} unique users`} />
            </>
          )}
          {gscOverview && (
            <>
              <KpiCard label="Search Clicks" value={fmtNum(gscOverview.clicks)} icon={iconClicks} color="text-emerald-500" sub={`${fmtNum(gscOverview.impressions)} impressions`} />
              <KpiCard label="Avg Position" value={gscOverview.position.toFixed(1)} icon={iconPosition} color="text-purple-500" sub={`${(gscOverview.ctr * 100).toFixed(1)}% CTR`} />
            </>
          )}
          {!ga4Overview && !gscOverview && bingOverview && (
            <>
              <KpiCard label="Bing Clicks" value={fmtNum(bingOverview.clicks)} icon={iconClicks} color="text-teal-500" sub={`${fmtNum(bingOverview.impressions)} impressions`} />
              <KpiCard label="Bing Position" value={bingOverview.avgPosition.toFixed(1)} icon={iconPosition} color="text-teal-500" sub={`${(bingOverview.ctr * 100).toFixed(1)}% CTR`} />
            </>
          )}
          {/* Fill remaining slots */}
          {ga4Overview && !gscOverview && (
            <>
              <KpiCard label="Bounce Rate" value={`${(ga4Overview.bounceRate * 100).toFixed(1)}%`} icon={iconBounce} color="text-amber-500" sub={`${Math.round(ga4Overview.avgDuration)}s avg duration`} />
              <KpiCard label="Articles" value={fmtNum(articleCount)} icon={iconArticles} color="text-indigo-500" sub={`${fmtNum(totalWords)} total words`} />
            </>
          )}
          {!ga4Overview && gscOverview && (
            <>
              <KpiCard label="Articles" value={fmtNum(articleCount)} icon={iconArticles} color="text-indigo-500" sub={`${fmtNum(totalWords)} total words`} />
              <KpiCard label="Impressions" value={fmtNum(gscOverview.impressions)} icon={iconImpressions} color="text-sky-500" sub={`${dateRange}-day total`} />
            </>
          )}
          {ga4Overview && gscOverview && (
            <>
              {/* Already 4 cards above */}
            </>
          )}
        </div>
      )}

      {/* ── Time Series Charts ── */}
      {(ga4Timeseries.length > 0 || gscTimeseries.length > 0) && (
        <div className={`grid gap-4 ${ga4Timeseries.length > 0 && gscTimeseries.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
          {ga4Timeseries.length > 0 && (
            <div className="cs-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-th-text">Traffic</h3>
                <div className="flex items-center gap-4 text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Sessions</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Pageviews</span>
                </div>
              </div>
              <AreaChart
                data={ga4Timeseries}
                lines={[
                  { key: "sessions", color: "#f97316", fillColor: "rgba(249,115,22,0.1)" },
                  { key: "pageviews", color: "#60a5fa", fillColor: "rgba(96,165,250,0.08)" },
                ]}
                height={200}
              />
            </div>
          )}
          {gscTimeseries.length > 0 && (
            <div className="cs-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-th-text">Search Performance</h3>
                <div className="flex items-center gap-4 text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Clicks</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" /> Impressions</span>
                </div>
              </div>
              <AreaChart
                data={gscTimeseries}
                lines={[
                  { key: "clicks", color: "#10b981", fillColor: "rgba(16,185,129,0.1)" },
                  { key: "impressions", color: "#a78bfa", fillColor: "rgba(167,139,250,0.08)" },
                ]}
                height={200}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Tables: Queries + Sources ── */}
      {(gscQueries.length > 0 || ga4Sources.length > 0) && (
        <div className={`grid gap-4 ${gscQueries.length > 0 && ga4Sources.length > 0 ? "grid-cols-5" : "grid-cols-1"}`}>
          {/* Top Queries — 3 cols */}
          {gscQueries.length > 0 && (
            <div className={`cs-card p-5 ${ga4Sources.length > 0 ? "col-span-3" : ""}`}>
              <h3 className="text-sm font-semibold text-th-text mb-3">Top Search Queries</h3>
              <div className="overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-th-text-muted border-b border-th-border">
                      <th className="text-left py-2 font-medium">Query</th>
                      <th className="text-right py-2 font-medium w-16">Clicks</th>
                      <th className="text-right py-2 font-medium w-20">Impr.</th>
                      <th className="text-right py-2 font-medium w-14">CTR</th>
                      <th className="text-right py-2 font-medium w-14">Pos.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gscQueries.slice(0, 15).map((q, i) => (
                      <tr key={i} className="border-b border-th-border/50 hover:bg-th-bg-secondary/50 transition-colors">
                        <td className="py-2 text-th-text truncate max-w-[200px]" title={q.query}>{q.query}</td>
                        <td className="py-2 text-right font-medium text-th-text">{fmtNum(q.clicks)}</td>
                        <td className="py-2 text-right text-th-text-secondary">{fmtNum(q.impressions)}</td>
                        <td className="py-2 text-right text-th-text-secondary">{(q.ctr * 100).toFixed(1)}%</td>
                        <td className="py-2 text-right">
                          <span className={`font-medium ${q.position <= 10 ? "text-emerald-500" : q.position <= 20 ? "text-amber-500" : "text-th-text-muted"}`}>
                            {q.position.toFixed(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Traffic Sources — 2 cols */}
          {ga4Sources.length > 0 && (
            <div className={`cs-card p-5 ${gscQueries.length > 0 ? "col-span-2" : ""}`}>
              <h3 className="text-sm font-semibold text-th-text mb-3">Traffic Sources</h3>
              <div className="space-y-2.5">
                {ga4Sources.slice(0, 8).map((s, i) => {
                  const maxSessions = ga4Sources[0]?.sessions || 1;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-th-text truncate">{s.channel}</span>
                        <span className="text-xs font-medium text-th-text ml-2">{fmtNum(s.sessions)}</span>
                      </div>
                      <div className="w-full bg-th-bg-secondary rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all"
                          style={{ width: `${(s.sessions / maxSessions) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Top Pages ── */}
      {(ga4Pages.length > 0) && (
        <div className="cs-card p-5">
          <h3 className="text-sm font-semibold text-th-text mb-3">Top Pages</h3>
          <div className="overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-th-text-muted border-b border-th-border">
                  <th className="text-left py-2 font-medium">Page</th>
                  <th className="text-right py-2 font-medium w-20">Views</th>
                  <th className="text-right py-2 font-medium w-16">Users</th>
                  <th className="text-right py-2 font-medium w-20">Bounce</th>
                  <th className="text-left py-2 font-medium w-28">Traffic</th>
                </tr>
              </thead>
              <tbody>
                {ga4Pages.slice(0, 12).map((p, i) => {
                  const maxViews = ga4Pages[0]?.pageviews || 1;
                  return (
                    <tr key={i} className="border-b border-th-border/50 hover:bg-th-bg-secondary/50 transition-colors">
                      <td className="py-2 text-th-text">
                        <p className="truncate max-w-[350px]" title={p.path}>{p.title || p.path}</p>
                        {p.title && <p className="truncate max-w-[350px] text-[10px] text-th-text-muted">{p.path}</p>}
                      </td>
                      <td className="py-2 text-right font-medium text-th-text">{fmtNum(p.pageviews ?? 0)}</td>
                      <td className="py-2 text-right text-th-text-secondary">{fmtNum(p.users ?? 0)}</td>
                      <td className="py-2 text-right text-th-text-secondary">—</td>
                      <td className="py-2">
                        <div className="w-full bg-th-bg-secondary rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-blue-500 transition-all"
                            style={{ width: `${((p.pageviews ?? 0) / maxViews) * 100}%` }}
                          />
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

      {/* ── Getting Started (nothing connected) ── */}
      {!anyConnected && (
        <div className="grid grid-cols-3 gap-4">
          {/* Step 1 */}
          <div className="cs-card p-5 border-l-4 border-l-th-accent">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-th-accent text-white text-xs font-bold flex items-center justify-center">1</span>
              <h4 className="text-sm font-semibold text-th-text">Generate Content</h4>
            </div>
            <p className="text-xs text-th-text-muted mb-3">Create high-quality articles using AI. Single, bulk, or news pipeline — pick your mode.</p>
            <button onClick={() => onNavigate("Content Generator")} className="text-xs font-medium text-th-accent hover:text-th-accent-hover transition-colors">
              Go to Generator &rarr;
            </button>
          </div>
          {/* Step 2 */}
          <div className="cs-card p-5 border-l-4 border-l-th-purple">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-th-purple text-white text-xs font-bold flex items-center justify-center">2</span>
              <h4 className="text-sm font-semibold text-th-text">Publish & Index</h4>
            </div>
            <p className="text-xs text-th-text-muted mb-3">Publish to WordPress directly from the library. Content goes live with one click.</p>
            <button onClick={() => onNavigate("Content Library")} className="text-xs font-medium text-th-purple hover:opacity-80 transition-opacity">
              Browse Library &rarr;
            </button>
          </div>
          {/* Step 3 */}
          <div className="cs-card p-5 border-l-4 border-l-emerald-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center">3</span>
              <h4 className="text-sm font-semibold text-th-text">Track Performance</h4>
            </div>
            <p className="text-xs text-th-text-muted mb-3">Connect Google Analytics & Search Console above to see traffic, clicks, rankings, and more.</p>
            <p className="text-[10px] text-th-text-muted">Click &ldquo;Connect&rdquo; on any card above to get started.</p>
          </div>
        </div>
      )}

      {/* ── Bottom Row: Content Stats + Quick Actions ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="cs-card p-5">
          <h3 className="text-sm font-semibold text-th-text mb-3">Content Pipeline</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-th-text-muted">Articles Generated</span>
              <span className="text-sm font-semibold text-th-text">{fmtNum(articleCount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-th-text-muted">Total Words</span>
              <span className="text-sm font-semibold text-th-text">{totalWords >= 1000000 ? `${(totalWords / 1e6).toFixed(1)}M` : `${(totalWords / 1000).toFixed(0)}K`}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-th-text-muted">Avg Words/Article</span>
              <span className="text-sm font-semibold text-th-text">{articleCount > 0 ? fmtNum(Math.round(totalWords / articleCount)) : "—"}</span>
            </div>
          </div>
        </div>

        <div className="cs-card p-5 col-span-2">
          <h3 className="text-sm font-semibold text-th-text mb-3">Quick Actions</h3>
          <div className="flex gap-2">
            <button onClick={() => onNavigate("Content Generator")} className="flex-1 cs-btn cs-btn-primary text-sm py-2.5 justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
              Generate Article
            </button>
            <button onClick={() => onNavigate("Content Library")} className="flex-1 cs-btn cs-btn-secondary text-sm py-2.5 justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
              Content Library
            </button>
            <button onClick={() => onNavigate("Configuration")} className="flex-1 cs-btn cs-btn-ghost text-sm py-2.5 justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Configuration
            </button>
          </div>
        </div>
      </div>

      {/* ── Property Picker Modal ── */}
      {pickerProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setPickerProvider(null); setPickerOptions([]); }}>
          <div className="bg-th-card rounded-2xl shadow-2xl border border-th-border p-6 w-full max-w-lg mx-4 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-th-text">
                Select {pickerProvider === "ga4" ? "GA4 Property" : pickerProvider === "gsc" ? "Search Console Site" : "Bing Site"}
              </h3>
              <button onClick={() => { setPickerProvider(null); setPickerOptions([]); }} className="text-th-text-muted hover:text-th-text">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {pickerLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-6 h-6 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
              </div>
            ) : pickerOptions.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm text-th-text-muted">No properties found.</p>
                <p className="text-xs text-th-text-muted mt-1">Make sure your Google account has access.</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 space-y-1.5">
                {pickerOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => selectProperty(pickerProvider!, opt.id, opt.name)}
                    className="w-full text-left p-3 rounded-lg border border-th-border hover:border-th-accent hover:bg-th-card-hover transition-all"
                  >
                    <p className="text-sm font-medium text-th-text">{opt.name}</p>
                    <p className="text-[10px] text-th-text-muted mt-0.5">
                      {opt.account ? `${opt.account} · ` : ""}{opt.id}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   KPI Card
   ══════════════════════════════════════════════════════════ */
function KpiCard({ label, value, icon, color, sub }: { label: string; value: string; icon: string; color: string; sub: string }) {
  return (
    <div className="cs-card p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color} bg-current/10`} style={{ backgroundColor: "transparent" }}>
          <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-th-text tracking-tight">{value}</p>
          <p className="text-[11px] text-th-text-muted">{label}</p>
        </div>
      </div>
      <p className="text-[10px] text-th-text-muted mt-2 pl-[52px]">{sub}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SVG Area Chart
   ══════════════════════════════════════════════════════════ */
function AreaChart({ data, lines, height }: {
  data: TimeseriesPoint[];
  lines: { key: string; color: string; fillColor: string }[];
  height: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: TimeseriesPoint } | null>(null);

  if (data.length === 0) return null;

  const W = 600;
  const H = height;
  const PAD = { top: 10, right: 10, bottom: 28, left: 45 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Compute max across all lines
  let maxVal = 0;
  for (const pt of data) {
    for (const line of lines) {
      const v = (pt as unknown as unknown as Record<string, unknown>)[line.key];
      if (typeof v === "number" && v > maxVal) maxVal = v;
    }
  }
  if (maxVal === 0) maxVal = 1;

  // Scale helpers
  const xScale = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const yScale = (v: number) => PAD.top + chartH - (v / maxVal) * chartH;

  // Build paths
  const pathsLine: string[] = [];
  const pathsFill: string[] = [];
  for (const line of lines) {
    let linePath = "";
    let fillPath = "";
    data.forEach((pt, i) => {
      const v = (pt as unknown as Record<string, unknown>)[line.key] as number ?? 0;
      const x = xScale(i);
      const y = yScale(v);
      if (i === 0) {
        linePath = `M${x},${y}`;
        fillPath = `M${x},${yScale(0)}L${x},${y}`;
      } else {
        linePath += `L${x},${y}`;
        fillPath += `L${x},${y}`;
      }
    });
    fillPath += `L${xScale(data.length - 1)},${yScale(0)}Z`;
    pathsLine.push(linePath);
    pathsFill.push(fillPath);
  }

  // Y-axis ticks (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxVal / 4) * i));

  // X-axis labels (show ~6 dates)
  const step = Math.max(1, Math.floor(data.length / 6));
  const xLabels: { i: number; label: string }[] = [];
  for (let i = 0; i < data.length; i += step) {
    const d = data[i].date;
    xLabels.push({ i, label: formatShortDate(d) });
  }

  return (
    <div ref={containerRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: `${height}px` }}>
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke="currentColor" className="text-th-border" strokeWidth={0.5} strokeDasharray={i > 0 ? "4,4" : ""} />
            <text x={PAD.left - 6} y={yScale(v) + 3} textAnchor="end" className="fill-th-text-muted" style={{ fontSize: "9px" }}>{fmtNum(v)}</text>
          </g>
        ))}

        {/* X labels */}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle" className="fill-th-text-muted" style={{ fontSize: "9px" }}>{label}</text>
        ))}

        {/* Area fills + lines */}
        {lines.map((line, idx) => (
          <g key={line.key}>
            <path d={pathsFill[idx]} fill={line.fillColor} />
            <path d={pathsLine[idx]} fill="none" stroke={line.color} strokeWidth={2} strokeLinejoin="round" />
          </g>
        ))}

        {/* Hover zones */}
        {data.map((pt, i) => (
          <rect
            key={i}
            x={xScale(i) - chartW / data.length / 2}
            y={PAD.top}
            width={chartW / data.length}
            height={chartH}
            fill="transparent"
            onMouseEnter={(e) => {
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, data: pt });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-th-card border border-th-border rounded-lg shadow-lg px-3 py-2 z-10"
          style={{ left: Math.min(tooltip.x, (containerRef.current?.offsetWidth ?? 400) - 160), top: Math.max(0, tooltip.y - 70) }}
        >
          <p className="text-[10px] text-th-text-muted mb-1">{tooltip.data.date}</p>
          {lines.map((line) => {
            const v = (tooltip.data as unknown as Record<string, unknown>)[line.key];
            return (
              <div key={line.key} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: line.color }} />
                <span className="text-th-text capitalize">{line.key}:</span>
                <span className="font-semibold text-th-text">{typeof v === "number" ? fmtNum(v) : "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════ */
function fmtNum(n: number): string {
  if (!n || isNaN(n)) return "0";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return dateStr; }
}

/* ── Icon paths ── */
const iconSessions = "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z";
const iconPageviews = "M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z";
const iconClicks = "M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59";
const iconPosition = "M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 16.5m0 0L12 12m4.5 4.5V3";
const iconBounce = "M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3";
const iconArticles = "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z";
const iconImpressions = "M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605";
