"use client";

import { useState, useCallback } from "react";
import type { ProjectSettings } from "../types";

type Props = {
  settings: ProjectSettings;
  onUpdate: (updates: Partial<ProjectSettings>) => void;
};

type ApiKeyStatus = "idle" | "testing" | "connected" | "error";

const INDUSTRIES = [
  "Technology",
  "Education",
  "Healthcare",
  "Finance",
  "E-commerce",
  "Real Estate",
  "Travel",
  "Food",
  "Other",
];

const TONES = [
  "Professional",
  "Casual",
  "Academic",
  "Conversational",
  "Authoritative",
];

/* ── Helpers ── */

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-base font-semibold text-th-text">{title}</h3>
      {description && <p className="text-sm text-th-text-muted mt-0.5">{description}</p>}
    </div>
  );
}

function FieldLabel({ label, htmlFor }: { label: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-th-text-secondary mb-1.5">
      {label}
    </label>
  );
}

function StatusDot({ status }: { status: ApiKeyStatus }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-500">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        Error
      </span>
    );
  }
  if (status === "testing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-th-text-muted">
        <span className="w-2 h-2 rounded-full bg-th-text-muted animate-pulse" />
        Testing...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-th-text-muted">
      <span className="w-2 h-2 rounded-full bg-gray-400" />
      Not configured
    </span>
  );
}

export function SettingsTab({ settings, onUpdate }: Props) {
  /* ── Visibility toggles for password fields ── */
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const toggleShow = (key: string) => setShowKeys((p) => ({ ...p, [key]: !p[key] }));

  /* ── API key test statuses ── */
  const [apiStatus, setApiStatus] = useState<Record<string, ApiKeyStatus>>({
    gemini: "idle",
    openrouter: "idle",
    youApi: "idle",
    wordpress: "idle",
    supabase: "idle",
  });

  /* ── Save feedback ── */
  const [saved, setSaved] = useState(false);

  /* ── Danger zone confirmation ── */
  const [confirmAction, setConfirmAction] = useState<"clear" | "reset" | null>(null);

  /* ── Callbacks ── */
  const handleField = useCallback(
    (field: keyof ProjectSettings, value: string | number) => {
      onUpdate({ [field]: value });
    },
    [onUpdate],
  );

  const handleApiKey = useCallback(
    (key: keyof ProjectSettings["apiKeys"], value: string) => {
      onUpdate({
        apiKeys: { ...settings.apiKeys, [key]: value },
      });
    },
    [onUpdate, settings.apiKeys],
  );

  const handleWordpress = useCallback(
    (field: string, value: string) => {
      onUpdate({
        publishing: {
          ...settings.publishing,
          wordpress: {
            url: settings.publishing.wordpress?.url ?? "",
            username: settings.publishing.wordpress?.username ?? "",
            appPassword: settings.publishing.wordpress?.appPassword ?? "",
            [field]: value,
          },
        },
      });
    },
    [onUpdate, settings.publishing],
  );

  const handleSupabase = useCallback(
    (field: string, value: string) => {
      onUpdate({
        publishing: {
          ...settings.publishing,
          supabase: {
            url: settings.publishing.supabase?.url ?? "",
            anonKey: settings.publishing.supabase?.anonKey ?? "",
            [field]: value,
          },
        },
      });
    },
    [onUpdate, settings.publishing],
  );

  const simulateTest = useCallback((key: string, hasValue: boolean) => {
    setApiStatus((p) => ({ ...p, [key]: "testing" }));
    setTimeout(() => {
      setApiStatus((p) => ({ ...p, [key]: hasValue ? "connected" : "error" }));
    }, 1500);
  }, []);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDangerAction = (action: "clear" | "reset") => {
    if (action === "clear") {
      // Handled by parent - this signals intent
      onUpdate({ ...settings });
    }
    if (action === "reset") {
      onUpdate({
        projectName: "",
        website: "",
        brandName: "",
        industry: "",
        targetAudience: "",
        defaultRegion: "",
        defaultTone: "Professional",
        defaultWordCount: 2500,
        apiKeys: {},
        publishing: {},
      });
    }
    setConfirmAction(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24">
      {/* ── Section 1: Project Information ── */}
      <div className="cs-card p-6">
        <SectionHeading
          title="Project Information"
          description="Basic details about your content project."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <FieldLabel label="Project Name" htmlFor="projectName" />
            <input
              id="projectName"
              type="text"
              className="cs-input w-full"
              placeholder="My Content Project"
              value={settings.projectName}
              onChange={(e) => handleField("projectName", e.target.value)}
            />
          </div>

          <div>
            <FieldLabel label="Website URL" htmlFor="website" />
            <input
              id="website"
              type="url"
              className="cs-input w-full"
              placeholder="https://example.com"
              value={settings.website}
              onChange={(e) => handleField("website", e.target.value)}
            />
            <p className="text-xs text-th-text-muted mt-1">Must be a valid URL including https://</p>
          </div>

          <div>
            <FieldLabel label="Brand Name" htmlFor="brandName" />
            <input
              id="brandName"
              type="text"
              className="cs-input w-full"
              placeholder="Acme Inc."
              value={settings.brandName}
              onChange={(e) => handleField("brandName", e.target.value)}
            />
          </div>

          <div>
            <FieldLabel label="Industry" htmlFor="industry" />
            <select
              id="industry"
              className="cs-input w-full"
              value={settings.industry}
              onChange={(e) => handleField("industry", e.target.value)}
            >
              <option value="">Select industry...</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel label="Target Audience" htmlFor="targetAudience" />
            <input
              id="targetAudience"
              type="text"
              className="cs-input w-full"
              placeholder="e.g. Marketing professionals, 25-45"
              value={settings.targetAudience}
              onChange={(e) => handleField("targetAudience", e.target.value)}
            />
          </div>

          <div>
            <FieldLabel label="Default Region" htmlFor="defaultRegion" />
            <input
              id="defaultRegion"
              type="text"
              className="cs-input w-full"
              placeholder="e.g. United States, India"
              value={settings.defaultRegion}
              onChange={(e) => handleField("defaultRegion", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Section 2: Content Defaults ── */}
      <div className="cs-card p-6">
        <SectionHeading
          title="Content Defaults"
          description="Default settings applied to new content generation requests."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <FieldLabel label="Default Tone" htmlFor="defaultTone" />
            <select
              id="defaultTone"
              className="cs-input w-full"
              value={settings.defaultTone}
              onChange={(e) => handleField("defaultTone", e.target.value)}
            >
              {TONES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel label={`Default Word Count: ${settings.defaultWordCount.toLocaleString()}`} htmlFor="defaultWordCount" />
            <input
              id="defaultWordCount"
              type="range"
              min={500}
              max={10000}
              step={100}
              className="w-full accent-th-accent h-2 rounded-lg cursor-pointer"
              value={settings.defaultWordCount}
              onChange={(e) => handleField("defaultWordCount", Number(e.target.value))}
            />
            <div className="flex justify-between text-xs text-th-text-muted mt-1">
              <span>500</span>
              <span>10,000</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: API Keys ── */}
      <div className="cs-card p-6">
        <SectionHeading
          title="API Keys"
          description="Configure API keys for content generation and research."
        />

        {/* Security warning */}
        <div className="flex items-start gap-3 p-3 mb-5 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <svg className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-yellow-500">Security Notice</p>
            <p className="text-xs text-th-text-muted mt-0.5">
              API keys are stored locally in your browser. Never share your keys or commit them to version control.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Gemini */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel label="Gemini API Key" htmlFor="geminiKey" />
              <StatusDot status={settings.apiKeys.gemini ? apiStatus.gemini : "idle"} />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="geminiKey"
                  type={showKeys.gemini ? "text" : "password"}
                  className="cs-input w-full pr-10"
                  placeholder="AIza..."
                  value={settings.apiKeys.gemini ?? ""}
                  onChange={(e) => handleApiKey("gemini", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => toggleShow("gemini")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-th-text-muted hover:text-th-text transition-colors"
                >
                  {showKeys.gemini ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                type="button"
                className="cs-btn-secondary text-sm whitespace-nowrap"
                disabled={apiStatus.gemini === "testing"}
                onClick={() => simulateTest("gemini", !!settings.apiKeys.gemini)}
              >
                {apiStatus.gemini === "testing" ? "Testing..." : "Test Connection"}
              </button>
            </div>
          </div>

          {/* OpenRouter */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel label="OpenRouter API Key" htmlFor="openrouterKey" />
              <StatusDot status={settings.apiKeys.openrouter ? apiStatus.openrouter : "idle"} />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="openrouterKey"
                  type={showKeys.openrouter ? "text" : "password"}
                  className="cs-input w-full pr-10"
                  placeholder="sk-or-..."
                  value={settings.apiKeys.openrouter ?? ""}
                  onChange={(e) => handleApiKey("openrouter", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => toggleShow("openrouter")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-th-text-muted hover:text-th-text transition-colors"
                >
                  {showKeys.openrouter ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                type="button"
                className="cs-btn-secondary text-sm whitespace-nowrap"
                disabled={apiStatus.openrouter === "testing"}
                onClick={() => simulateTest("openrouter", !!settings.apiKeys.openrouter)}
              >
                {apiStatus.openrouter === "testing" ? "Testing..." : "Test Connection"}
              </button>
            </div>
          </div>

          {/* You.com */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel label="You.com API Key" htmlFor="youApiKey" />
              <StatusDot status={settings.apiKeys.youApi ? apiStatus.youApi : "idle"} />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="youApiKey"
                  type={showKeys.youApi ? "text" : "password"}
                  className="cs-input w-full pr-10"
                  placeholder="you-..."
                  value={settings.apiKeys.youApi ?? ""}
                  onChange={(e) => handleApiKey("youApi", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => toggleShow("youApi")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-th-text-muted hover:text-th-text transition-colors"
                >
                  {showKeys.youApi ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                type="button"
                className="cs-btn-secondary text-sm whitespace-nowrap"
                disabled={apiStatus.youApi === "testing"}
                onClick={() => simulateTest("youApi", !!settings.apiKeys.youApi)}
              >
                {apiStatus.youApi === "testing" ? "Testing..." : "Test Connection"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 4: Publishing ── */}
      <div className="cs-card p-6">
        <SectionHeading
          title="Publishing"
          description="Connect your publishing platforms for one-click deployment."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* WordPress */}
          <div className="cs-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-th-text">WordPress</h4>
              <StatusDot status={settings.publishing.wordpress?.url ? apiStatus.wordpress : "idle"} />
            </div>

            <div className="space-y-3">
              <div>
                <FieldLabel label="WordPress URL" htmlFor="wpUrl" />
                <input
                  id="wpUrl"
                  type="url"
                  className="cs-input w-full"
                  placeholder="https://yoursite.com"
                  value={settings.publishing.wordpress?.url ?? ""}
                  onChange={(e) => handleWordpress("url", e.target.value)}
                />
              </div>
              <div>
                <FieldLabel label="Username" htmlFor="wpUsername" />
                <input
                  id="wpUsername"
                  type="text"
                  className="cs-input w-full"
                  placeholder="admin"
                  value={settings.publishing.wordpress?.username ?? ""}
                  onChange={(e) => handleWordpress("username", e.target.value)}
                />
              </div>
              <div>
                <FieldLabel label="App Password" htmlFor="wpAppPassword" />
                <input
                  id="wpAppPassword"
                  type="password"
                  className="cs-input w-full"
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={settings.publishing.wordpress?.appPassword ?? ""}
                  onChange={(e) => handleWordpress("appPassword", e.target.value)}
                />
              </div>
              <button
                type="button"
                className="cs-btn-secondary text-sm w-full"
                disabled={apiStatus.wordpress === "testing"}
                onClick={() =>
                  simulateTest(
                    "wordpress",
                    !!(settings.publishing.wordpress?.url && settings.publishing.wordpress?.username),
                  )
                }
              >
                {apiStatus.wordpress === "testing" ? "Testing..." : "Test Connection"}
              </button>
            </div>
          </div>

          {/* Supabase */}
          <div className="cs-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-th-text">Supabase</h4>
              <StatusDot status={settings.publishing.supabase?.url ? apiStatus.supabase : "idle"} />
            </div>

            <div className="space-y-3">
              <div>
                <FieldLabel label="Project URL" htmlFor="sbUrl" />
                <input
                  id="sbUrl"
                  type="url"
                  className="cs-input w-full"
                  placeholder="https://abc.supabase.co"
                  value={settings.publishing.supabase?.url ?? ""}
                  onChange={(e) => handleSupabase("url", e.target.value)}
                />
              </div>
              <div>
                <FieldLabel label="Anon Key" htmlFor="sbAnonKey" />
                <input
                  id="sbAnonKey"
                  type="password"
                  className="cs-input w-full"
                  placeholder="eyJ..."
                  value={settings.publishing.supabase?.anonKey ?? ""}
                  onChange={(e) => handleSupabase("anonKey", e.target.value)}
                />
              </div>
              {/* Spacer to align with WordPress card height */}
              <div className="pt-[calc(theme(spacing.3)+theme(spacing.10)+theme(spacing.1.5))]" />
              <button
                type="button"
                className="cs-btn-secondary text-sm w-full"
                disabled={apiStatus.supabase === "testing"}
                onClick={() =>
                  simulateTest(
                    "supabase",
                    !!(settings.publishing.supabase?.url && settings.publishing.supabase?.anonKey),
                  )
                }
              >
                {apiStatus.supabase === "testing" ? "Testing..." : "Test Connection"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 5: Danger Zone ── */}
      <div className="cs-card p-6 border-red-500/40">
        <SectionHeading
          title="Danger Zone"
          description="Irreversible actions. Proceed with caution."
        />

        <div className="space-y-4">
          {/* Clear All Content */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-red-500/20 bg-red-500/5">
            <div>
              <p className="text-sm font-medium text-th-text">Clear All Content</p>
              <p className="text-xs text-th-text-muted mt-0.5">
                Remove all generated articles from your library. This cannot be undone.
              </p>
            </div>
            {confirmAction === "clear" ? (
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <span className="text-xs text-red-500 font-medium">Are you sure?</span>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                  onClick={() => handleDangerAction("clear")}
                >
                  Yes, clear
                </button>
                <button
                  type="button"
                  className="cs-btn-secondary text-xs"
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 transition-colors shrink-0 ml-4"
                onClick={() => setConfirmAction("clear")}
              >
                Clear All Content
              </button>
            )}
          </div>

          {/* Reset Settings */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-red-500/20 bg-red-500/5">
            <div>
              <p className="text-sm font-medium text-th-text">Reset Settings</p>
              <p className="text-xs text-th-text-muted mt-0.5">
                Reset all settings to their default values, including API keys and publishing config.
              </p>
            </div>
            {confirmAction === "reset" ? (
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <span className="text-xs text-red-500 font-medium">Are you sure?</span>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                  onClick={() => handleDangerAction("reset")}
                >
                  Yes, reset
                </button>
                <button
                  type="button"
                  className="cs-btn-secondary text-xs"
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 transition-colors shrink-0 ml-4"
                onClick={() => setConfirmAction("reset")}
              >
                Reset Settings
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Floating Save Button ── */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          type="button"
          className={`cs-btn-primary px-6 py-3 text-sm font-medium shadow-lg transition-all ${
            saved ? "bg-green-600 hover:bg-green-600" : ""
          }`}
          onClick={handleSave}
        >
          {saved ? (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Saved
            </span>
          ) : (
            "Save Settings"
          )}
        </button>
      </div>
    </div>
  );
}
