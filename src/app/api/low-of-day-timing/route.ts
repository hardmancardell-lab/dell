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
  const dayOfWeekParam = searchParams.get("dayOfWeek");
  const filterDayOfWeek = dayOfWeekParam !== null && dayOfWeekParam !== "" ? Number(dayOfWeekParam) : null;

  try {
    const results = await runLowOfDayTimingStudy(tickers, filterDayOfWeek);
    return NextResponse.json({ tickers: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
