import { NextResponse } from "next/server";
import { runOvernightCheckpointBacktest } from "@/lib/agents/trading-agent/skills/overnight-checkpoint-backtest";
import type { EquityBacktestSignalType } from "@/lib/agents/trading-agent/types";

export const maxDuration = 60;

const VALID_SIGNALS: EquityBacktestSignalType[] = ["volumeDisplacement", "momentum", "meanReversionOversold", "meanReversionOverbought"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const signal = searchParams.get("signal") as EquityBacktestSignalType | null;
  const years = Number(searchParams.get("years") ?? "3");

  if (!ticker) return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  if (!signal || !VALID_SIGNALS.includes(signal)) {
    return NextResponse.json({ error: `'signal' must be one of: ${VALID_SIGNALS.join(", ")}.` }, { status: 400 });
  }
  if (!Number.isFinite(years) || years <= 0 || years > 5) {
    return NextResponse.json({ error: "'years' must be a number between 1 and 5." }, { status: 400 });
  }

  try {
    const result = await runOvernightCheckpointBacktest(ticker, signal, years);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
