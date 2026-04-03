import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getAeoBrandConfig, getAeoRuns } from "@/lib/server/db";

export interface CompetitorStat {
  name: string;
  sovPct: number;           // % of all runs where this competitor appeared
  appearanceCount: number;  // raw count of runs they appeared in
  totalRuns: number;
  byProvider: Record<string, { appearances: number; total: number; pct: number }>;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  promptsAppearing: string[];   // unique prompt texts where they appeared
  gapPrompts: string[];         // prompts where competitor appeared but brand did NOT
}

export interface CompetitorIntelligenceResponse {
  brandSov: number;             // your brand SOV%
  brandAppearances: number;
  totalRuns: number;
  competitors: CompetitorStat[];
  allPrompts: string[];         // all unique prompt texts tracked
  promptMatrix: Array<{         // per-prompt who appeared
    promptText: string;
    brandMentioned: boolean;
    competitorsPresent: string[];
    providers: string[];
  }>;
}

export async function GET() {
  const sessionId = await getSession();
  const config = getAeoBrandConfig(sessionId);
  const runs = getAeoRuns(sessionId, 1000);

  if (!runs.length) {
    return NextResponse.json({ error: "No run data yet. Run prompts from Prompt Hub first." }, { status: 404 });
  }

  const totalRuns = runs.length;
  const brandAppearances = runs.filter(r => r.brandMentioned).length;
  const brandSov = Math.round((brandAppearances / totalRuns) * 100);

  // All unique providers seen
  const allProviders = [...new Set(runs.map(r => r.provider))];

  // Build competitor list from brand config + any competitors found in run data
  const configCompetitors = config.competitors
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  // Also collect any competitor names found in actual run data (normalised)
  const runCompetitors = new Set<string>();
  for (const run of runs) {
    for (const c of run.competitors) {
      const norm = c.trim().toLowerCase();
      if (norm) runCompetitors.add(norm);
    }
  }

  // Merge: config competitors first, then any additional found in runs
  const allCompetitorNames = [
    ...configCompetitors,
    ...[...runCompetitors].filter(c => !configCompetitors.includes(c)),
  ].slice(0, 10); // cap at 10

  // Build per-competitor stats
  const competitors: CompetitorStat[] = allCompetitorNames.map(name => {
    // Runs where this competitor appeared (case-insensitive match)
    const appearedRuns = runs.filter(r =>
      r.competitors.some(c => c.trim().toLowerCase() === name)
    );

    const sovPct = Math.round((appearedRuns.length / totalRuns) * 100);

    // By provider
    const byProvider: Record<string, { appearances: number; total: number; pct: number }> = {};
    for (const provider of allProviders) {
      const providerRuns = runs.filter(r => r.provider === provider);
      const providerAppearances = appearedRuns.filter(r => r.provider === provider).length;
      byProvider[provider] = {
        appearances: providerAppearances,
        total: providerRuns.length,
        pct: providerRuns.length > 0 ? Math.round((providerAppearances / providerRuns.length) * 100) : 0,
      };
    }

    // Sentiment from runs where competitor appeared
    const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
    for (const r of appearedRuns) {
      const s = r.sentiment as keyof typeof sentimentBreakdown;
      if (s in sentimentBreakdown) sentimentBreakdown[s]++;
    }

    // Unique prompts where competitor appeared
    const promptsAppearing = [...new Set(appearedRuns.map(r => r.promptText))];

    // Gap prompts: competitor appeared but brand did NOT
    const gapRuns = appearedRuns.filter(r => !r.brandMentioned);
    const gapPrompts = [...new Set(gapRuns.map(r => r.promptText))];

    return {
      name,
      sovPct,
      appearanceCount: appearedRuns.length,
      totalRuns,
      byProvider,
      sentimentBreakdown,
      promptsAppearing,
      gapPrompts,
    };
  });

  // Sort by SOV descending
  competitors.sort((a, b) => b.sovPct - a.sovPct);

  // All unique prompts
  const allPrompts = [...new Set(runs.map(r => r.promptText))];

  // Prompt matrix — most recent run per prompt×provider combo, aggregated per prompt
  const promptMap = new Map<string, { brandMentioned: boolean; competitorsPresent: Set<string>; providers: Set<string> }>();
  for (const run of runs) {
    const existing = promptMap.get(run.promptText);
    if (!existing) {
      promptMap.set(run.promptText, {
        brandMentioned: run.brandMentioned,
        competitorsPresent: new Set(run.competitors.map(c => c.trim().toLowerCase())),
        providers: new Set([run.provider]),
      });
    } else {
      if (run.brandMentioned) existing.brandMentioned = true;
      for (const c of run.competitors) existing.competitorsPresent.add(c.trim().toLowerCase());
      existing.providers.add(run.provider);
    }
  }

  const promptMatrix = [...promptMap.entries()].map(([promptText, data]) => ({
    promptText,
    brandMentioned: data.brandMentioned,
    competitorsPresent: [...data.competitorsPresent],
    providers: [...data.providers],
  }));

  const response: CompetitorIntelligenceResponse = {
    brandSov,
    brandAppearances,
    totalRuns,
    competitors,
    allPrompts,
    promptMatrix,
  };

  return NextResponse.json(response);
}
