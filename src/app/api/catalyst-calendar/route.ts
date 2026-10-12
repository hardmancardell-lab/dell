import { NextResponse } from "next/server";
import { upcomingCatalysts, type CatalystCategory, type CatalystImpact } from "@/lib/agents/trading-agent/skills/catalyst-calendar";

const CATEGORIES: CatalystCategory[] = ["central-bank", "inflation", "jobs", "options-expiry", "election", "calendar-flow", "market-hours"];
const IMPACTS: CatalystImpact[] = ["low", "medium", "high"];
const SYMBOL = /^[A-Za-z0-9./-]{1,12}$/;

/**
 * Dated market catalysts, from a checked-in calendar (no outside call is made). Behind the same login as the other
 * studies.
 *
 *   GET /api/catalyst-calendar?days=30&symbol=GBP/JPY&minImpact=high&category=central-bank,inflation&from=2026-10-12
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;

  const days = sp.get("days") ? Number(sp.get("days")) : 30;
  if (!Number.isFinite(days) || days < 1 || days > 366) {
    return NextResponse.json({ error: "'days' must be a number from 1 to 366." }, { status: 400 });
  }
  const from = sp.get("from") ?? undefined;
  if (from !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from)))) {
    return NextResponse.json({ error: "'from' must be a date such as 2026-10-12." }, { status: 400 });
  }
  const symbol = sp.get("symbol")?.trim() || undefined;
  if (symbol !== undefined && !SYMBOL.test(symbol)) {
    return NextResponse.json({ error: "Provide a ticker such as SPY, a forex pair such as GBP/JPY or a crypto symbol such as BTC-USD." }, { status: 400 });
  }
  const minImpact = (sp.get("minImpact") ?? "low") as CatalystImpact;
  if (!IMPACTS.includes(minImpact)) return NextResponse.json({ error: "'minImpact' must be low, medium or high." }, { status: 400 });

  const categoryParam = sp.get("category");
  const categories = categoryParam ? (categoryParam.split(",").map((c) => c.trim()).filter(Boolean) as CatalystCategory[]) : undefined;
  if (categories && categories.some((c) => !CATEGORIES.includes(c))) {
    return NextResponse.json({ error: `'category' must be a comma-separated list of: ${CATEGORIES.join(", ")}.` }, { status: 400 });
  }

  return NextResponse.json(upcomingCatalysts({ from, days, symbol, minImpact, categories }));
}
