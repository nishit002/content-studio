import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getWritingRules, setWritingRules } from "@/lib/server/db";

const VALID_RULE_TYPES = ["banned_phrases", "ai_replacements", "table_banned_values", "quality_thresholds"];

export async function GET(req: NextRequest) {
  const sessionId = await getSession();
  const ruleType = req.nextUrl.searchParams.get("type");

  if (ruleType) {
    if (!VALID_RULE_TYPES.includes(ruleType)) {
      return NextResponse.json({ error: `Invalid rule type. Valid: ${VALID_RULE_TYPES.join(", ")}` }, { status: 400 });
    }
    const rules = getWritingRules(sessionId, ruleType);
    return NextResponse.json({ type: ruleType, rules: rules ?? {} });
  }

  // Return all rule types
  const all: Record<string, unknown> = {};
  for (const type of VALID_RULE_TYPES) {
    all[type] = getWritingRules(sessionId, type);
  }
  return NextResponse.json(all);
}

export async function PUT(req: NextRequest) {
  const sessionId = await getSession();
  const { type, rules } = await req.json();

  if (!type || !VALID_RULE_TYPES.includes(type)) {
    return NextResponse.json({ error: `Invalid rule type. Valid: ${VALID_RULE_TYPES.join(", ")}` }, { status: 400 });
  }

  if (rules === undefined || rules === null) {
    return NextResponse.json({ error: "rules field required" }, { status: 400 });
  }

  setWritingRules(sessionId, type, rules);
  return NextResponse.json({ ok: true, type });
}
