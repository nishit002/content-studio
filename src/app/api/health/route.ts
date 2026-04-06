import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getApiKeys, updateApiKeyStatus } from "@/lib/server/db";

export async function POST(req: NextRequest) {
  const sessionId = await getSession();
  const { provider, key_value } = await req.json();

  if (!provider || !key_value) {
    return NextResponse.json({ error: "provider and key_value required" }, { status: 400 });
  }

  try {
    const result = await testApiKey(provider, key_value);
    updateApiKeyStatus(sessionId, provider, key_value, result.ok ? "connected" : "error");
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    updateApiKeyStatus(sessionId, provider, key_value, "error");
    return NextResponse.json({ ok: false, error: msg });
  }
}

// GET: test all keys for a session
export async function GET() {
  const sessionId = await getSession();
  const keys = getApiKeys(sessionId);

  const results: Record<string, { total: number; healthy: number; errors: number }> = {};

  for (const key of keys) {
    if (!results[key.provider]) {
      results[key.provider] = { total: 0, healthy: 0, errors: 0 };
    }
    results[key.provider].total++;

    try {
      const result = await testApiKey(key.provider, key.key_value);
      updateApiKeyStatus(sessionId, key.provider, key.key_value, result.ok ? "connected" : "error");
      if (result.ok) results[key.provider].healthy++;
      else results[key.provider].errors++;
    } catch {
      updateApiKeyStatus(sessionId, key.provider, key.key_value, "error");
      results[key.provider].errors++;
    }
  }

  return NextResponse.json(results);
}

async function testApiKey(provider: string, key: string): Promise<{ ok: boolean; error?: string; latency?: number }> {
  const start = Date.now();

  switch (provider) {
    case "gemini": {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Say hello in one word." }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 10 },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
      }
      return { ok: true, latency: Date.now() - start };
    }

    case "huggingface": {
      const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "Qwen/Qwen3-235B-A22B",
          messages: [{ role: "user", content: "Say hello." }],
          max_tokens: 10,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
      }
      return { ok: true, latency: Date.now() - start };
    }

    case "you_search": {
      const res = await fetch(`https://api.you.com/v1/search?query=test&num_web_results=1`, {
        headers: { "X-API-Key": key },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true, latency: Date.now() - start };
    }

    case "wordpress": {
      // key format: "url|username|password"
      const [url, username, password] = key.split("|");
      if (!url || !username || !password) {
        return { ok: false, error: "Format: url|username|app_password" };
      }
      const res = await fetch(`${url}/wp-json/wp/v2/posts?per_page=1`, {
        headers: {
          Authorization: "Basic " + btoa(`${username}:${password}`),
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true, latency: Date.now() - start };
    }

    case "youtube": {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=id&q=test&maxResults=1&key=${key}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true, latency: Date.now() - start };
    }

    default:
      return { ok: false, error: `Unknown provider: ${provider}` };
  }
}
