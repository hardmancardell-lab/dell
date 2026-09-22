import { NextResponse } from "next/server";
import { runLowOfDayTimingStudy } from "@/lib/agents/trading-agent/skills/low-of-day-timing";

export const maxDuration = 60;

const DEFAULT_TICKERS = ["GOOGL"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam
    ? tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_TICKERS;

  try {
    const results = await runLowOfDayTimingStudy(tickers);
    return NextResponse.json({ tickers: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
