import { NextResponse } from "next/server";
import { OptionFlowDbUnavailable, getDaySeries, getRecentSessionDates } from "@/lib/data/option-flow-db";
import { OPTION_FLOW_SYMBOLS, sessionDateET } from "@/lib/agents/trading-agent/skills/option-flow-snapshot";

/**
 * GET /api/option-flow?symbol=SPY&date=2026-10-15
 * The day's logged snapshots for one symbol (raw rows, no labels; each carries data_feed and quote_lag_seconds), plus the recent session dates for the chooser.
 * `date` defaults to today in New York. Add &contracts=1 for the per-contract jsonb (about 30 KB per SPY row).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? OPTION_FLOW_SYMBOLS[0]).trim().toUpperCase();
  if (!OPTION_FLOW_SYMBOLS.includes(symbol)) {
    return NextResponse.json({ error: `Symbol ${symbol} is not in the logged list (${OPTION_FLOW_SYMBOLS.join(", ")}).` }, { status: 400 });
  }
  const date = searchParams.get("date") ?? sessionDateET(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  try {
    const [snapshots, sessions] = await Promise.all([
      getDaySeries(symbol, date, { includeContracts: searchParams.get("contracts") === "1" }),
      getRecentSessionDates(symbol, 20),
    ]);
    return NextResponse.json({ symbol, date, symbols: OPTION_FLOW_SYMBOLS, sessions, snapshots, serverTime: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: err instanceof OptionFlowDbUnavailable ? 503 : 500 });
  }
}
