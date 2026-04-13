import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { getSession } from "@/lib/server/session";
import { getApiKeys } from "@/lib/server/db";

const STATS_FILE = "/home/ubuntu/content-studio/data/key_stats.json";

interface KeyStat {
  provider: string;
  requests: number;
  errors: number;
  last_used: string;
}

export async function GET() {
  const sessionId = await getSession();
  const keys = getApiKeys(sessionId);

  // Load usage stats from pipeline-written file
  let stats: Record<string, KeyStat> = {};
  try {
    stats = JSON.parse(readFileSync(STATS_FILE, "utf8"));
  } catch {
    // file doesn't exist yet — that's fine
  }

  // Merge DB keys with usage stats
  const result = keys.map((k) => {
    const suffix = k.key_value.slice(-8);
    const usage = stats[suffix] || { requests: 0, errors: 0, last_used: "" };
    return {
      provider: k.provider,
      label: k.label,
      key_suffix: suffix,
      status: k.status,
      requests: usage.requests,
      errors: usage.errors,
      last_used: usage.last_used,
      updated_at: k.updated_at,
    };
  });

  return NextResponse.json(result);
}
