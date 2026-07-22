import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/agents/trading-agent/skills/historical-backtest";
import type { EquityBacktestSignalType } from "@/lib/agents/trading-agent/types";

const VALID_SIGNALS: EquityBacktestSignalType[] = [
  "volumeDisplacement",
  "momentum",
  "meanReversionOversold",
  "meanReversionOverbought",
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const signal = searchParams.get("signal");
  const yearsParam = searchParams.get("years");

  if (!ticker || !signal) {
    return NextResponse.json({ error: "Missing required 'ticker' and 'signal' query params." }, { status: 400 });
  }
  if (!VALID_SIGNALS.includes(signal as EquityBacktestSignalType)) {
    return NextResponse.json({ error: `Invalid 'signal'. Must be one of: ${VALID_SIGNALS.join(", ")}.` }, { status: 400 });
  }

  const years = yearsParam ? Number(yearsParam) : 3;
  if (!Number.isFinite(years) || years <= 0 || years > 5) {
    return NextResponse.json({ error: "'years' must be a number between 1 and 5." }, { status: 400 });
  }

  try {
    const result = await runBacktest(ticker, signal as EquityBacktestSignalType, years);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
