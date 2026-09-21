import { NextResponse } from "next/server";
import { runWeekStartMomentumStudy, WEEK_START_STUDY_DATA_LIMITATIONS } from "@/lib/agents/trading-agent/skills/week-start-momentum-study";

export const maxDuration = 60;

const DEFAULT_TICKERS = ["SMH", "SOXX", "QQQ", "XLK"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam
    ? tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_TICKERS;

  try {
    const results = await runWeekStartMomentumStudy(tickers);
    return NextResponse.json({ tickers: results, dataLimitations: WEEK_START_STUDY_DATA_LIMITATIONS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
