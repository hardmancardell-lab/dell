import { NextResponse } from "next/server";
import { parseBarAdjustment } from "@/lib/data/market-data-types";
import { getChartBars, getChartEvents } from "@/lib/agents/trading-agent/skills/chart-bars";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const timeframe = searchParams.get("timeframe");
  const centerDate = searchParams.get("centerDate") ?? undefined;
  // Default "split" (history back-adjusted for splits). "raw" shows prices as traded, "all" adds dividends. Anything else is ignored.
  const adjustment = parseBarAdjustment(searchParams.get("adjustment"));
  if (!ticker || !timeframe) {
    return NextResponse.json({ error: "Missing required 'ticker' and 'timeframe' query params." }, { status: 400 });
  }
  // ?events=1 returns the split and dividend markers for the same window instead of bars (kept on this route so no new public path is needed).
  if (searchParams.get("events") === "1") {
    return NextResponse.json(await getChartEvents(ticker, timeframe, centerDate));
  }
  try {
    const result = await getChartBars(ticker, timeframe, centerDate, adjustment);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
