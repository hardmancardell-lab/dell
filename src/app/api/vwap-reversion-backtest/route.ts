import { NextResponse } from "next/server";
import { runVwapReversionBacktest } from "@/lib/agents/trading-agent/skills/vwap-reversion-backtest";
import type { VwapBacktestSignalType } from "@/lib/agents/trading-agent/types";

const VALID_SIGNALS: VwapBacktestSignalType[] = ["vwapMeanReversionOversold", "vwapMeanReversionOverbought"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const signal = searchParams.get("signal");
  const daysParam = searchParams.get("days");

  if (!ticker || !signal) {
    return NextResponse.json({ error: "Missing required 'ticker' and 'signal' query params." }, { status: 400 });
  }
  if (!VALID_SIGNALS.includes(signal as VwapBacktestSignalType)) {
    return NextResponse.json({ error: `Invalid 'signal'. Must be one of: ${VALID_SIGNALS.join(", ")}.` }, { status: 400 });
  }

  const days = daysParam ? Number(daysParam) : 90;
  if (!Number.isFinite(days) || days < 5 || days > 180) {
    return NextResponse.json({ error: "'days' must be a number between 5 and 180." }, { status: 400 });
  }

  try {
    const result = await runVwapReversionBacktest(ticker, signal as VwapBacktestSignalType, days);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
