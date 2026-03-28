"use client";

import { useState, useEffect, useCallback } from "react";
import { apiProviders, industryPresets } from "../types";

type ConfigSection = "project" | "api_keys" | "writing_rules" | "presets";

interface ApiKeyEntry {
  provider: string;
  key_value: string;
  label: string;
  status: string;
  updated_at: string;
  key_hash: string;
}

export function ConfigurationTab() {
  const [section, setSection] = useState<ConfigSection>("project");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [rules, setRules] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Load all config data from server
  useEffect(() => {
    Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/keys").then((r) => r.json()),
      fetch("/api/rules").then((r) => r.json()),
    ])
      .then(([cfg, keys, rls]) => {
        setConfig(cfg);
        setApiKeys(keys);
        setRules(rls);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const saveConfig = useCallback(async (updates: Record<string, string>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      setConfig(data);
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }, []);

  const saveRules = useCallback(async (type: string, rulesData: unknown) => {
    setSaving(true);
    try {
      await fetch("/api/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, rules: rulesData }),
      });
      setRules((prev) => ({ ...prev, [type]: rulesData }));
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-th-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  const sections: { id: ConfigSection; label: string; icon: React.ReactNode }[] = [
    {
      id: "project",
      label: "Project Settings",
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5z" /></svg>,
    },
    {
      id: "api_keys",
      label: "API Keys",
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>,
    },
    {
      id: "writing_rules",
      label: "Writing Rules",
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>,
    },
    {
      id: "presets",
      label: "Industry Presets",
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h12A2.25 2.25 0 0120.25 6v3.776" /></svg>,
    },
  ];

  return (
    <div className="flex gap-6 max-w-6xl">
      {/* Section nav */}
      <div className="w-56 shrink-0 space-y-1">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              section === s.id ? "bg-th-accent-soft text-th-accent" : "text-th-text-secondary hover:bg-th-bg-secondary hover:text-th-text"
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}

        {/* Save indicator */}
        {saveMsg && (
          <div className={`px-3 py-2 text-xs font-medium rounded-lg mt-4 ${saveMsg === "Saved" ? "bg-th-success-soft text-th-success" : "bg-th-danger-soft text-th-danger"}`}>
            {saveMsg}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 animate-fadeIn">
        {section === "project" && <ProjectSection config={config} onSave={saveConfig} saving={saving} />}
        {section === "api_keys" && <ApiKeysSection keys={apiKeys} onKeysChange={setApiKeys} />}
        {section === "writing_rules" && <WritingRulesSection rules={rules} onSave={saveRules} saving={saving} />}
        {section === "presets" && <PresetsSection config={config} onApply={saveConfig} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/* ── PROJECT SETTINGS SECTION ── */
/* ═══════════════════════════════════════ */

function ProjectSection({ config, onSave, saving }: { config: Record<string, string>; onSave: (u: Record<string, string>) => void; saving: boolean }) {
  const [local, setLocal] = useState(config);

  useEffect(() => setLocal(config), [config]);

  const set = (key: string, value: string) => setLocal((p) => ({ ...p, [key]: value }));

  return (
    <div className="space-y-6">
      <div className="cs-card p-6">
        <h3 className="text-sm font-semibold text-th-text mb-4">Project Information</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Project Name" value={local.project_name} onChange={(v) => set("project_name", v)} placeholder="My Content Project" />
          <Field label="Website" value={local.website} onChange={(v) => set("website", v)} placeholder="https://example.com" />
          <Field label="Brand Name" value={local.brand_name} onChange={(v) => set("brand_name", v)} placeholder="Acme Inc" />
          <div>
            <label className="text-xs font-medium text-th-text-secondary block mb-1.5">Industry</label>
            <select
              value={local.industry}
              onChange={(e) => set("industry", e.target.value)}
              className="cs-input"
            >
              <option value="">Select industry...</option>
              {industryPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <Field label="Target Audience" value={local.target_audience} onChange={(v) => set("target_audience", v)} placeholder="e.g., Small business owners" />
          <Field label="Default Region" value={local.default_region} onChange={(v) => set("default_region", v)} placeholder="e.g., India, US, Global" />
        </div>
      </div>

      <div className="cs-card p-6">
        <h3 className="text-sm font-semibold text-th-text mb-4">Content Defaults</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-th-text-secondary block mb-1.5">Default Tone</label>
            <select value={local.default_tone} onChange={(e) => set("default_tone", e.target.value)} className="cs-input">
              {["Professional", "Casual", "Academic", "Conversational", "Authoritative"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-th-text-secondary block mb-1.5">Default Word Count: {local.default_word_count || "2500"}</label>
            <input
              type="range"
              min="500" max="15000" step="500"
              value={local.default_word_count || "2500"}
              onChange={(e) => set("default_word_count", e.target.value)}
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between text-xs text-th-text-muted mt-1"><span>500</span><span>15,000</span></div>
          </div>
          <Field label="FAQ Count" value={local.faq_count || "8"} onChange={(v) => set("faq_count", v)} placeholder="8" />
          <div className="flex flex-col gap-3 justify-center">
            <Toggle label="Include Schema Markup" value={local.include_schema === "true"} onChange={(v) => set("include_schema", v ? "true" : "false")} />
            <Toggle label="Include Internal Links" value={local.include_internal_links === "true"} onChange={(v) => set("include_internal_links", v ? "true" : "false")} />
            <Toggle label="Charts Enabled" value={local.charts_enabled === "true"} onChange={(v) => set("charts_enabled", v ? "true" : "false")} />
          </div>
        </div>
      </div>

      <div className="cs-card p-6">
        <h3 className="text-sm font-semibold text-th-text mb-4">WordPress Publishing</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Site URL" value={local.wp_site_url} onChange={(v) => set("wp_site_url", v)} placeholder="https://yoursite.com" />
          <Field label="Username" value={local.wp_username} onChange={(v) => set("wp_username", v)} placeholder="admin" />
          <Field label="App Password" value={local.wp_app_password} onChange={(v) => set("wp_app_password", v)} placeholder="xxxx xxxx xxxx xxxx" type="password" />
          <div>
            <label className="text-xs font-medium text-th-text-secondary block mb-1.5">Default Status</label>
            <select value={local.wp_default_status} onChange={(e) => set("wp_default_status", e.target.value)} className="cs-input">
              <option value="draft">Draft</option>
              <option value="publish">Publish</option>
            </select>
          </div>
        </div>
      </div>

      <button onClick={() => onSave(local)} disabled={saving} className="cs-btn cs-btn-primary">
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/* ── API KEYS SECTION ── */
/* ═══════════════════════════════════════ */

function ApiKeysSection({ keys, onKeysChange }: { keys: ApiKeyEntry[]; onKeysChange: (k: ApiKeyEntry[]) => void }) {
  const [adding, setAdding] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [testing, setTesting] = useState<string | null>(null);

  const addKey = async (provider: string) => {
    if (!newKey.trim()) return;
    await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key_value: newKey.trim(), label: newLabel.trim() }),
    });
    // Reload keys
    const res = await fetch("/api/keys");
    onKeysChange(await res.json());
    setNewKey("");
    setNewLabel("");
    setAdding(null);
  };

  const deleteKey = async (provider: string, keyValue: string) => {
    await fetch("/api/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key_value: keyValue }),
    });
    const res = await fetch("/api/keys");
    onKeysChange(await res.json());
  };

  const testKey = async (provider: string, keyValue: string) => {
    setTesting(`${provider}:${keyValue}`);
    try {
      await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key_value: keyValue }),
      });
      // Reload to get updated status
      const res = await fetch("/api/keys");
      onKeysChange(await res.json());
    } finally {
      setTesting(null);
    }
  };

  const statusColor = (s: string) => {
    if (s === "connected") return "bg-th-success";
    if (s === "error") return "bg-th-danger";
    return "bg-th-text-muted";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-th-warning-soft text-th-warning text-xs">
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
        API keys are stored server-side in your local database. They are never sent to the browser.
      </div>

      {apiProviders.map((provider) => {
        const providerKeys = keys.filter((k) => k.provider === provider.id);
        return (
          <div key={provider.id} className="cs-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-semibold text-th-text flex items-center gap-2">
                  {provider.name}
                  {provider.required && <span className="text-xs text-th-danger font-normal">Required</span>}
                </h4>
                <p className="text-xs text-th-text-muted">{provider.description}</p>
              </div>
              <button
                onClick={() => setAdding(adding === provider.id ? null : provider.id)}
                className="cs-btn cs-btn-secondary text-xs py-1.5 px-3"
              >
                {adding === provider.id ? "Cancel" : "+ Add Key"}
              </button>
            </div>

            {/* Add key form */}
            {adding === provider.id && (
              <div className="flex gap-2 mb-3 p-3 rounded-lg bg-th-bg-secondary">
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={provider.id === "wordpress" ? "url|username|app_password" : "Paste API key..."}
                  className="cs-input flex-1 text-xs font-mono"
                  type="password"
                />
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Label (optional)"
                  className="cs-input w-32 text-xs"
                />
                <button onClick={() => addKey(provider.id)} className="cs-btn cs-btn-primary text-xs py-1.5">Save</button>
              </div>
            )}

            {/* Existing keys */}
            {providerKeys.length === 0 ? (
              <p className="text-xs text-th-text-muted italic">No keys configured</p>
            ) : (
              <div className="space-y-2">
                {providerKeys.map((k, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-th-bg-secondary">
                    <div className={`w-2 h-2 rounded-full ${statusColor(k.status)}`} />
                    <code className="text-xs text-th-text-secondary font-mono flex-1">{k.key_value}</code>
                    {k.label && <span className="text-xs text-th-text-muted">{k.label}</span>}
                    <span className="text-xs capitalize text-th-text-muted">{k.status}</span>
                    <button
                      onClick={() => testKey(k.provider, k.key_value)}
                      disabled={testing === `${k.provider}:${k.key_value}`}
                      className="cs-btn cs-btn-ghost text-xs py-1 px-2"
                    >
                      {testing === `${k.provider}:${k.key_value}` ? (
                        <span className="w-3 h-3 rounded-full border border-th-accent border-t-transparent animate-spin inline-block" />
                      ) : (
                        "Test"
                      )}
                    </button>
                    <button onClick={() => deleteKey(k.provider, k.key_value)} className="cs-btn cs-btn-ghost text-xs py-1 px-2 text-th-danger">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════ */
/* ── WRITING RULES SECTION ── */
/* ═══════════════════════════════════════ */

function WritingRulesSection({ rules, onSave, saving }: { rules: Record<string, unknown>; onSave: (type: string, data: unknown) => void; saving: boolean }) {
  const [activeRule, setActiveRule] = useState<string>("banned_phrases");
  const [bannedPhrases, setBannedPhrases] = useState<string[]>((rules.banned_phrases as string[]) || []);
  const [aiReplacements, setAiReplacements] = useState<Record<string, string>>((rules.ai_replacements as Record<string, string>) || {});
  const [tableBanned, setTableBanned] = useState<string[]>((rules.table_banned_values as string[]) || []);
  const [qualityThresholds, setQualityThresholds] = useState<Record<string, number>>((rules.quality_thresholds as Record<string, number>) || {});
  const [newPhrase, setNewPhrase] = useState("");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newTableBanned, setNewTableBanned] = useState("");

  const ruleTabs = [
    { id: "banned_phrases", label: "Banned Phrases", count: bannedPhrases.length },
    { id: "ai_replacements", label: "AI Replacements", count: Object.keys(aiReplacements).length },
    { id: "table_banned_values", label: "Table Banned Values", count: tableBanned.length },
    { id: "quality_thresholds", label: "Quality Thresholds", count: Object.keys(qualityThresholds).length },
  ];

  return (
    <div className="space-y-4">
      {/* Rule type tabs */}
      <div className="flex gap-2">
        {ruleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveRule(t.id)}
            className={`cs-btn text-xs ${activeRule === t.id ? "cs-btn-primary" : "cs-btn-secondary"}`}
          >
            {t.label}
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-white/20 text-xs">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Banned phrases */}
      {activeRule === "banned_phrases" && (
        <div className="cs-card p-5 space-y-3">
          <p className="text-xs text-th-text-muted">Words and phrases that will be automatically removed from generated content.</p>
          <div className="flex gap-2">
            <input value={newPhrase} onChange={(e) => setNewPhrase(e.target.value)} placeholder="Add banned phrase..." className="cs-input flex-1 text-xs" onKeyDown={(e) => {
              if (e.key === "Enter" && newPhrase.trim()) {
                setBannedPhrases((p) => [...p, newPhrase.trim()]);
                setNewPhrase("");
              }
            }} />
            <button onClick={() => { if (newPhrase.trim()) { setBannedPhrases((p) => [...p, newPhrase.trim()]); setNewPhrase(""); } }} className="cs-btn cs-btn-secondary text-xs">Add</button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
            {bannedPhrases.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-th-danger-soft text-th-danger text-xs">
                {p}
                <button onClick={() => setBannedPhrases((prev) => prev.filter((_, j) => j !== i))} className="hover:text-th-text ml-1">&times;</button>
              </span>
            ))}
          </div>
          <button onClick={() => onSave("banned_phrases", bannedPhrases)} disabled={saving} className="cs-btn cs-btn-primary text-xs">
            {saving ? "Saving..." : "Save Banned Phrases"}
          </button>
        </div>
      )}

      {/* AI Replacements */}
      {activeRule === "ai_replacements" && (
        <div className="cs-card p-5 space-y-3">
          <p className="text-xs text-th-text-muted">AI-sounding phrases will be replaced with simpler alternatives.</p>
          <div className="flex gap-2">
            <input value={newFrom} onChange={(e) => setNewFrom(e.target.value)} placeholder='Find phrase (e.g., "groundbreaking")' className="cs-input flex-1 text-xs" />
            <span className="text-th-text-muted self-center">&rarr;</span>
            <input value={newTo} onChange={(e) => setNewTo(e.target.value)} placeholder='Replace with (e.g., "notable")' className="cs-input flex-1 text-xs" />
            <button onClick={() => { if (newFrom.trim()) { setAiReplacements((p) => ({ ...p, [newFrom.trim()]: newTo.trim() })); setNewFrom(""); setNewTo(""); } }} className="cs-btn cs-btn-secondary text-xs">Add</button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {Object.entries(aiReplacements).map(([from, to]) => (
              <div key={from} className="flex items-center gap-2 py-1.5 px-3 rounded bg-th-bg-secondary text-xs">
                <code className="text-th-danger flex-1 truncate">{from}</code>
                <span className="text-th-text-muted shrink-0">&rarr;</span>
                <code className="text-th-success flex-1 truncate">{to || "(remove)"}</code>
                <button onClick={() => setAiReplacements((p) => { const n = { ...p }; delete n[from]; return n; })} className="text-th-text-muted hover:text-th-danger">&times;</button>
              </div>
            ))}
          </div>
          <button onClick={() => onSave("ai_replacements", aiReplacements)} disabled={saving} className="cs-btn cs-btn-primary text-xs">
            {saving ? "Saving..." : "Save Replacements"}
          </button>
        </div>
      )}

      {/* Table banned values */}
      {activeRule === "table_banned_values" && (
        <div className="cs-card p-5 space-y-3">
          <p className="text-xs text-th-text-muted">Cell values that should never appear in generated tables. Rows with these values get cleaned.</p>
          <div className="flex gap-2">
            <input value={newTableBanned} onChange={(e) => setNewTableBanned(e.target.value)} placeholder="Add banned value..." className="cs-input flex-1 text-xs" onKeyDown={(e) => {
              if (e.key === "Enter" && newTableBanned.trim()) { setTableBanned((p) => [...p, newTableBanned.trim()]); setNewTableBanned(""); }
            }} />
            <button onClick={() => { if (newTableBanned.trim()) { setTableBanned((p) => [...p, newTableBanned.trim()]); setNewTableBanned(""); } }} className="cs-btn cs-btn-secondary text-xs">Add</button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
            {tableBanned.map((v, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-th-warning-soft text-th-warning text-xs">
                {v}
                <button onClick={() => setTableBanned((prev) => prev.filter((_, j) => j !== i))} className="hover:text-th-text ml-1">&times;</button>
              </span>
            ))}
          </div>
          <button onClick={() => onSave("table_banned_values", tableBanned)} disabled={saving} className="cs-btn cs-btn-primary text-xs">
            {saving ? "Saving..." : "Save Table Values"}
          </button>
        </div>
      )}

      {/* Quality thresholds */}
      {activeRule === "quality_thresholds" && (
        <div className="cs-card p-5 space-y-4">
          <p className="text-xs text-th-text-muted">Scoring weights and thresholds for quality assessment. Total weights should sum to 100.</p>
          {[
            { key: "word_count_weight", label: "Word Count Weight", min: 0, max: 30 },
            { key: "data_density_weight", label: "Data Density Weight", min: 0, max: 30 },
            { key: "heading_structure_weight", label: "Heading Structure Weight", min: 0, max: 30 },
            { key: "tables_lists_weight", label: "Tables & Lists Weight", min: 0, max: 30 },
            { key: "readability_weight", label: "Readability Weight", min: 0, max: 30 },
            { key: "completeness_weight", label: "Completeness Weight", min: 0, max: 30 },
            { key: "variety_weight", label: "Variety Weight", min: 0, max: 30 },
            { key: "max_sentence_words", label: "Max Words per Sentence", min: 15, max: 50 },
            { key: "min_table_rows", label: "Min Table Rows", min: 3, max: 20 },
            { key: "pass_score", label: "Pass Score Threshold", min: 30, max: 90 },
            { key: "fact_check_threshold", label: "Fact Check Pass %", min: 30, max: 90 },
          ].map(({ key, label, min, max }) => (
            <div key={key} className="flex items-center gap-3">
              <label className="text-xs text-th-text-secondary w-48 shrink-0">{label}</label>
              <input
                type="range" min={min} max={max} step={1}
                value={qualityThresholds[key] ?? 15}
                onChange={(e) => setQualityThresholds((p) => ({ ...p, [key]: Number(e.target.value) }))}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="text-xs font-mono text-th-text w-8 text-right">{qualityThresholds[key] ?? 15}</span>
            </div>
          ))}
          <button onClick={() => onSave("quality_thresholds", qualityThresholds)} disabled={saving} className="cs-btn cs-btn-primary text-xs">
            {saving ? "Saving..." : "Save Thresholds"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════ */
/* ── INDUSTRY PRESETS SECTION ── */
/* ═══════════════════════════════════════ */

function PresetsSection({ config, onApply }: { config: Record<string, string>; onApply: (u: Record<string, string>) => void }) {
  const [selected, setSelected] = useState(config.industry || "");

  return (
    <div className="space-y-4">
      <p className="text-sm text-th-text-secondary">
        Choose an industry preset to auto-configure writing rules, banned phrases, and content defaults for your niche.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {industryPresets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => setSelected(preset.id)}
            className={`cs-card p-4 text-left transition-all ${
              selected === preset.id ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : ""
            }`}
          >
            <h4 className="text-sm font-semibold text-th-text">{preset.name}</h4>
            <p className="text-xs text-th-text-muted mt-1">{preset.description}</p>
            {config.industry === preset.id && (
              <span className="inline-block mt-2 text-xs text-th-success font-medium">Currently active</span>
            )}
          </button>
        ))}
      </div>
      {selected && selected !== config.industry && (
        <button onClick={() => onApply({ industry: selected })} className="cs-btn cs-btn-primary">
          Apply {industryPresets.find((p) => p.id === selected)?.name} Preset
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════ */
/* ── SHARED UI COMPONENTS ── */
/* ═══════════════════════════════════════ */

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-th-text-secondary block mb-1.5">{label}</label>
      <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="cs-input" />
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <div
        onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full relative transition-colors ${value ? "bg-th-accent" : "bg-th-border"}`}
      >
        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${value ? "translate-x-4" : "translate-x-0.5"}`} />
      </div>
      <span className="text-xs text-th-text-secondary">{label}</span>
    </label>
  );
}
