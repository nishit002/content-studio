"use client";

import { useState, useEffect, useCallback } from "react";
import { apiProviders, industryPresets } from "../types";

type ConfigSection = "project" | "api_keys" | "writing_rules" | "presets" | "brand_aeo";

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
    {
      id: "brand_aeo",
      label: "Brand & AEO",
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>,
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
        {section === "brand_aeo" && <BrandAeoSection />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ */
/* ── COUNTRY & LANGUAGE DATA ── */
/* ═══════════════════════════════════════ */

const countries = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "AE", name: "UAE" },
  { code: "SG", name: "Singapore" },
  { code: "MY", name: "Malaysia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "ID", name: "Indonesia" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "NG", name: "Nigeria" },
  { code: "ZA", name: "South Africa" },
  { code: "PH", name: "Philippines" },
  { code: "BD", name: "Bangladesh" },
  { code: "PK", name: "Pakistan" },
  { code: "NP", name: "Nepal" },
  { code: "LK", name: "Sri Lanka" },
  { code: "GL", name: "Global" },
];

/** Country → available languages. `defaults` = pre-selected on choosing that country (English always included). */
const countryLanguageMap: Record<string, { all: string[]; defaults: string[] }> = {
  IN: {
    all: ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi", "Odia", "Urdu"],
    defaults: ["English", "Hindi"],
  },
  US: { all: ["English", "Spanish"], defaults: ["English"] },
  GB: { all: ["English"], defaults: ["English"] },
  CA: { all: ["English", "French"], defaults: ["English"] },
  AU: { all: ["English"], defaults: ["English"] },
  AE: { all: ["English", "Arabic"], defaults: ["English", "Arabic"] },
  SG: { all: ["English", "Mandarin", "Malay", "Tamil"], defaults: ["English"] },
  MY: { all: ["English", "Malay", "Mandarin", "Tamil"], defaults: ["English", "Malay"] },
  DE: { all: ["English", "German"], defaults: ["English", "German"] },
  FR: { all: ["English", "French"], defaults: ["English", "French"] },
  ES: { all: ["English", "Spanish"], defaults: ["English", "Spanish"] },
  BR: { all: ["English", "Portuguese"], defaults: ["English", "Portuguese"] },
  MX: { all: ["English", "Spanish"], defaults: ["English", "Spanish"] },
  JP: { all: ["English", "Japanese"], defaults: ["English", "Japanese"] },
  KR: { all: ["English", "Korean"], defaults: ["English", "Korean"] },
  ID: { all: ["English", "Indonesian"], defaults: ["English", "Indonesian"] },
  SA: { all: ["English", "Arabic"], defaults: ["English", "Arabic"] },
  NG: { all: ["English", "Yoruba", "Hausa", "Igbo"], defaults: ["English"] },
  ZA: { all: ["English", "Afrikaans", "Zulu", "Xhosa"], defaults: ["English"] },
  PH: { all: ["English", "Filipino"], defaults: ["English", "Filipino"] },
  BD: { all: ["English", "Bengali"], defaults: ["English", "Bengali"] },
  PK: { all: ["English", "Urdu"], defaults: ["English", "Urdu"] },
  NP: { all: ["English", "Nepali"], defaults: ["English", "Nepali"] },
  LK: { all: ["English", "Sinhala", "Tamil"], defaults: ["English", "Sinhala"] },
  GL: { all: ["English"], defaults: ["English"] },
};

function getLanguageOptions(countryCode: string): string[] {
  const entry = countryLanguageMap[countryCode];
  if (entry) return entry.all;
  return ["English"];
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
          <div>
            <label className="text-xs font-medium text-th-text-secondary block mb-1.5">Country</label>
            <select
              value={local.default_country || ""}
              onChange={(e) => {
                const country = e.target.value;
                set("default_country", country);
                // Auto-set default languages based on country
                const countryLangs = countryLanguageMap[country];
                if (countryLangs) {
                  set("content_languages", countryLangs.defaults.join(","));
                } else {
                  set("content_languages", "English");
                }
              }}
              className="cs-input"
            >
              <option value="">Select country...</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Language selection — appears after country is chosen */}
        {local.default_country && (
          <div className="mt-4">
            <label className="text-xs font-medium text-th-text-secondary block mb-2">
              Content Languages
              <span className="text-th-text-muted font-normal ml-1">(research & writing languages)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {getLanguageOptions(local.default_country).map((lang) => {
                const selected = (local.content_languages || "English").split(",").map((l) => l.trim());
                const isSelected = selected.includes(lang);
                const isEnglish = lang === "English";
                return (
                  <button
                    key={lang}
                    onClick={() => {
                      if (isEnglish) return; // English always included
                      const current = selected.filter(Boolean);
                      const updated = isSelected
                        ? current.filter((l) => l !== lang)
                        : [...current, lang];
                      set("content_languages", updated.join(","));
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-th-accent-soft text-th-accent ring-1 ring-th-accent/30"
                        : "bg-th-bg-secondary text-th-text-muted hover:text-th-text"
                    } ${isEnglish ? "opacity-80 cursor-default" : "cursor-pointer"}`}
                  >
                    {lang}
                    {isEnglish && <span className="ml-1 text-th-text-muted">(always)</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-th-text-muted mt-2">
              Selected: {(local.content_languages || "English").split(",").filter(Boolean).join(", ")}
            </p>
          </div>
        )}
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

/* ── Provider field definitions ── */
const providerFields: Record<string, { name: string; placeholder: string; type?: string }[]> = {
  gemini: [{ name: "API Key", placeholder: "AIzaSy..." }],
  huggingface: [{ name: "API Key", placeholder: "hf_..." }],
  you_search: [{ name: "API Key", placeholder: "Paste You.com API key" }],
  wordpress: [
    { name: "Site URL", placeholder: "https://articles.yoursite.com" },
    { name: "Username", placeholder: "admin" },
    { name: "App Password", placeholder: "xxxx xxxx xxxx xxxx", type: "password" },
  ],
  supabase: [
    { name: "Project URL", placeholder: "https://xxxxx.supabase.co" },
    { name: "Service Role Key", placeholder: "eyJhbGci...", type: "password" },
  ],
  google_ads: [
    { name: "Developer Token", placeholder: "XXXXXXXXXXXXXXXX" },
    { name: "Client ID", placeholder: "123456789.apps.googleusercontent.com" },
    { name: "Client Secret", placeholder: "GOCSPX-...", type: "password" },
    { name: "Refresh Token", placeholder: "1//0eXXXX...", type: "password" },
    { name: "Login Customer ID", placeholder: "1234567890" },
  ],
  dataforseo: [
    { name: "Login / Email", placeholder: "user@example.com" },
    { name: "Password", placeholder: "API password", type: "password" },
  ],
  serpapi: [{ name: "API Key", placeholder: "Paste SerpAPI key" }],
  youtube: [{ name: "API Key", placeholder: "AIzaSy..." }],
  google_indexing: [{ name: "Service Account JSON", placeholder: "Paste full JSON or file path" }],
  image_gen: [{ name: "API Key", placeholder: "hf_..." }],
};

/* ── Helpers to split/join pipe-delimited key values for multi-field providers ── */
function splitKeyValue(providerId: string, combined: string): string[] {
  const fields = providerFields[providerId] || [{ name: "Key", placeholder: "" }];
  const parts = combined.split("|");
  return fields.map((_, i) => parts[i] || "");
}

function formatKeyDisplay(providerId: string, combined: string): React.ReactNode {
  const fields = providerFields[providerId] || [{ name: "Key", placeholder: "" }];
  if (fields.length === 1) return <code className="text-xs text-th-text-secondary font-mono truncate">{combined}</code>;
  const parts = combined.split("|");
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 flex-1 min-w-0">
      {fields.map((f, i) => (
        <span key={i} className="text-xs text-th-text-secondary">
          <span className="text-th-text-muted">{f.name}:</span>{" "}
          <code className="font-mono">{f.type === "password" ? "••••" + (parts[i] || "").slice(-4) : (parts[i] || "—").length > 30 ? (parts[i] || "").slice(0, 20) + "..." + (parts[i] || "").slice(-6) : (parts[i] || "—")}</code>
        </span>
      ))}
    </div>
  );
}

function ApiKeysSection({ keys, onKeysChange }: { keys: ApiKeyEntry[]; onKeysChange: (k: ApiKeyEntry[]) => void }) {
  const [adding, setAdding] = useState<string | null>(null);
  // editing stores "provider:index" to identify which key is being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const [formLabel, setFormLabel] = useState("");
  // original key_value before edit (needed to tell the API which key to replace)
  const [editOriginalKey, setEditOriginalKey] = useState("");
  const [testing, setTesting] = useState<string | null>(null);

  const resetForm = () => {
    setFormFields({});
    setFormLabel("");
    setAdding(null);
    setEditing(null);
    setEditOriginalKey("");
  };

  const startAdding = (providerId: string) => {
    if (adding === providerId) { resetForm(); return; }
    resetForm();
    setAdding(providerId);
  };

  const startEditing = async (providerId: string, index: number) => {
    const editId = `${providerId}:${index}`;
    if (editing === editId) { resetForm(); return; }
    resetForm();

    // Fetch raw (unmasked) keys to pre-fill the form
    const res = await fetch("/api/keys?raw=true");
    const rawKeys: ApiKeyEntry[] = await res.json();
    const providerRawKeys = rawKeys.filter((k) => k.provider === providerId);
    const keyData = providerRawKeys[index];
    if (!keyData) return;

    const fields = providerFields[providerId] || [{ name: "Key", placeholder: "" }];
    const parts = keyData.key_value.split("|");
    const prefilled: Record<string, string> = {};
    fields.forEach((_, i) => { prefilled[i] = parts[i] || ""; });

    setFormFields(prefilled);
    setFormLabel(keyData.label || "");
    setEditOriginalKey(keyData.key_value);
    setEditing(editId);
  };

  const setField = (idx: number, value: string) => {
    setFormFields((prev) => ({ ...prev, [idx]: value }));
  };

  const reloadKeys = async () => {
    const res = await fetch("/api/keys");
    onKeysChange(await res.json());
  };

  const saveKey = async (providerId: string) => {
    const fields = providerFields[providerId] || [{ name: "Key", placeholder: "" }];
    const values = fields.map((_, i) => (formFields[i] || "").trim());
    if (!values[0]) return;
    const combined = values.join("|");

    if (editing && editOriginalKey) {
      // Update existing key
      await fetch("/api/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, old_key_value: editOriginalKey, new_key_value: combined, label: formLabel.trim() }),
      });
    } else {
      // Add new key
      await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, key_value: combined, label: formLabel.trim() }),
      });
    }
    await reloadKeys();
    resetForm();
  };

  const deleteKey = async (provider: string, index: number) => {
    // Need raw key to identify which one to delete
    const res = await fetch("/api/keys?raw=true");
    const rawKeys: ApiKeyEntry[] = await res.json();
    const providerRawKeys = rawKeys.filter((k) => k.provider === provider);
    const keyData = providerRawKeys[index];
    if (!keyData) return;

    await fetch("/api/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key_value: keyData.key_value }),
    });
    await reloadKeys();
    resetForm();
  };

  const testKey = async (provider: string, index: number) => {
    const testId = `${provider}:${index}`;
    setTesting(testId);
    try {
      // Need raw key for the health check
      const res = await fetch("/api/keys?raw=true");
      const rawKeys: ApiKeyEntry[] = await res.json();
      const providerRawKeys = rawKeys.filter((k) => k.provider === provider);
      const keyData = providerRawKeys[index];
      if (!keyData) return;

      await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key_value: keyData.key_value }),
      });
      await reloadKeys();
    } finally {
      setTesting(null);
    }
  };

  const statusColor = (s: string) => {
    if (s === "connected") return "bg-th-success";
    if (s === "error") return "bg-th-danger";
    return "bg-th-text-muted";
  };

  /** Renders the structured form fields for a provider (used for both add & edit) */
  const renderForm = (providerId: string, isEdit: boolean) => {
    const fields = providerFields[providerId] || [{ name: "Key", placeholder: "" }];
    const isMultiField = fields.length > 1;

    return (
      <div className="mb-3 p-4 rounded-lg bg-th-bg-secondary space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-th-text">{isEdit ? "Edit" : "Add"} {apiProviders.find((p) => p.id === providerId)?.name}</span>
        </div>
        {isMultiField ? (
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f, i) => (
              <div key={i} className={fields.length === 5 && i >= 4 ? "col-span-2" : ""}>
                <label className="text-xs font-medium text-th-text-secondary block mb-1">{f.name}</label>
                <input
                  value={formFields[i] || ""}
                  onChange={(e) => setField(i, e.target.value)}
                  placeholder={f.placeholder}
                  type={f.type || "text"}
                  className="cs-input text-xs font-mono w-full"
                />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-th-text-secondary block mb-1">{fields[0].name}</label>
            <input
              value={formFields[0] || ""}
              onChange={(e) => setField(0, e.target.value)}
              placeholder={fields[0].placeholder}
              type={fields[0].type || "text"}
              className="cs-input text-xs font-mono w-full"
            />
          </div>
        )}
        <div className="flex gap-2 items-center">
          <input
            value={formLabel}
            onChange={(e) => setFormLabel(e.target.value)}
            placeholder="Label (optional)"
            className="cs-input w-40 text-xs"
          />
          <button onClick={() => saveKey(providerId)} className="cs-btn cs-btn-primary text-xs py-1.5 px-4">
            {isEdit ? "Update" : "Save"}
          </button>
          <button onClick={resetForm} className="cs-btn cs-btn-ghost text-xs py-1.5 px-3">Cancel</button>
        </div>
      </div>
    );
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
                onClick={() => startAdding(provider.id)}
                className="cs-btn cs-btn-secondary text-xs py-1.5 px-3"
              >
                + Add Key
              </button>
            </div>

            {/* Add form */}
            {adding === provider.id && renderForm(provider.id, false)}

            {/* Existing keys */}
            {providerKeys.length === 0 && adding !== provider.id ? (
              <p className="text-xs text-th-text-muted italic">No keys configured</p>
            ) : (
              <div className="space-y-2">
                {providerKeys.map((k, i) => {
                  const editId = `${provider.id}:${i}`;
                  const isEditing = editing === editId;

                  if (isEditing) {
                    return <div key={i}>{renderForm(provider.id, true)}</div>;
                  }

                  return (
                    <div key={i} className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-th-bg-secondary">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${statusColor(k.status)}`} />
                      {formatKeyDisplay(provider.id, k.key_value)}
                      {k.label && <span className="text-xs text-th-text-muted shrink-0">{k.label}</span>}
                      <span className="text-xs capitalize text-th-text-muted shrink-0">{k.status}</span>
                      <button
                        onClick={() => startEditing(provider.id, i)}
                        className="cs-btn cs-btn-ghost text-xs py-1 px-2 shrink-0"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => testKey(provider.id, i)}
                        disabled={testing === editId}
                        className="cs-btn cs-btn-ghost text-xs py-1 px-2 shrink-0"
                      >
                        {testing === editId ? (
                          <span className="w-3 h-3 rounded-full border border-th-accent border-t-transparent animate-spin inline-block" />
                        ) : (
                          "Test"
                        )}
                      </button>
                      <button onClick={() => deleteKey(provider.id, i)} className="cs-btn cs-btn-ghost text-xs py-1 px-2 text-th-danger shrink-0">
                        Delete
                      </button>
                    </div>
                  );
                })}
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

/* ═══════════════════════════════════════ */
/* ── BRAND & AEO SECTION ── */
/* ═══════════════════════════════════════ */

interface AeoBrandConfig {
  brandName: string; aliases: string; website: string;
  industry: string; keywords: string; description: string; competitors: string;
}

const FMC_DEFAULTS: AeoBrandConfig = {
  brandName: "FindMyCollege",
  aliases: "FMC, findmycollege.com",
  website: "https://findmycollege.com",
  industry: "EdTech, College Admissions, Higher Education",
  keywords: "top MBA colleges India, best engineering colleges, NIRF ranking, college fees, admission process, college cutoffs, top universities India",
  description: "FindMyCollege is India's leading college discovery and comparison platform, helping students find the best colleges for MBA, Engineering, Medical, Law, and other programs based on rankings, fees, placements, and admission requirements.",
  competitors: "Shiksha, Collegedunia, Careers360, CollegeDekho, GetMyUni",
};

function BrandAeoSection() {
  const [cfg, setCfg] = useState<AeoBrandConfig>(FMC_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    fetch("/api/aeo/config")
      .then(r => r.json())
      .then((d: AeoBrandConfig) => {
        // Only override defaults if the user has actually saved something
        if (d.brandName?.trim()) setCfg(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/aeo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2500);
    } catch {
      setSaveMsg("Error saving");
    }
    setSaving(false);
  }

  if (!loaded) return <div className="flex items-center justify-center h-32"><div className="w-6 h-6 rounded-full border-2 border-th-accent border-t-transparent animate-spin" /></div>;

  const cfgField = (label: string, key: keyof AeoBrandConfig, placeholder: string, multiline?: boolean, hint?: string) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-th-text-secondary block">{label}</label>
      {hint && <p className="text-xs text-th-text-muted">{hint}</p>}
      {multiline ? (
        <textarea
          value={cfg[key]}
          onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          rows={3}
          className="cs-input w-full resize-y"
        />
      ) : (
        <input
          value={cfg[key]}
          onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          className="cs-input"
        />
      )}
    </div>
  );

  const isComplete = cfg.brandName.trim() && cfg.website.trim() && cfg.keywords.trim();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-th-text">Brand & AEO Settings</h3>
        <p className="text-sm text-th-text-muted mt-1">
          These details power the entire AEO & SRO tab — visibility scoring, battlecards, prompt tracking, and competitor analysis. Pre-filled with FindMyCollege defaults.
        </p>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Brand Name", ok: !!cfg.brandName.trim() },
          { label: "Website", ok: !!cfg.website.trim() },
          { label: "Keywords", ok: !!cfg.keywords.trim() },
          { label: "Competitors", ok: !!cfg.competitors.trim() },
          { label: "Description", ok: !!cfg.description.trim() },
        ].map(({ label, ok }) => (
          <span key={label} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${ok ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-th-card-alt border-th-border text-th-text-muted"}`}>
            <span>{ok ? "✓" : "○"}</span>{label}
          </span>
        ))}
      </div>

      {/* Identity */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-th-text-muted">Brand Identity</div>
        <div className="grid gap-4 sm:grid-cols-2">
          {cfgField("Brand / Company Name", "brandName", "FindMyCollege", false, "Used as the primary term in visibility scoring")}
          {cfgField("Brand Aliases (comma-separated)", "aliases", "FMC, findmycollege.com", false, "Alternative names, domain, abbreviations")}
          {cfgField("Website URL", "website", "https://findmycollege.com")}
          {cfgField("Industry / Vertical", "industry", "EdTech, College Admissions")}
        </div>
      </div>

      {/* Tracking */}
      <div>
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-th-text-muted">Tracking & Analysis</div>
        <div className="grid gap-4">
          {cfgField("Target Keywords (comma-separated)", "keywords", "top MBA colleges India, NIRF ranking, college fees…", false, "Keywords used to generate niche prompts and contextualize responses")}
          {cfgField("Competitors (comma-separated)", "competitors", "Shiksha, Collegedunia, Careers360…", false, "Used for battlecard generation and citation opportunity analysis")}
          {cfgField("Brand Description", "description", "Brief description of your product/service…", true, "Gives AI models context when assessing relevance of responses")}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2 border-t border-th-border">
        <button
          onClick={save}
          disabled={saving || !isComplete}
          className="cs-btn cs-btn-primary"
        >
          {saving ? "Saving…" : "Save Brand Settings"}
        </button>
        {!isComplete && <span className="text-xs text-th-text-muted">Fill in Brand Name, Website, and Keywords to save.</span>}
        {saveMsg && (
          <span className={`text-xs font-medium ${saveMsg === "Saved" ? "text-green-400" : "text-red-400"}`}>{saveMsg}</span>
        )}
      </div>

      {/* Usage note */}
      <div className="rounded-lg border border-th-border bg-th-card-alt px-4 py-3 text-xs text-th-text-muted leading-relaxed">
        <strong className="text-th-text">Where these settings are used:</strong>
        {" "}Visibility scores in Responses & Analytics (brand mention detection) · Battlecard generation (competitor comparison) · Niche Explorer & Fan-Out (context for prompt generation) · Drift alerts (score change detection between runs)
      </div>
    </div>
  );
}
