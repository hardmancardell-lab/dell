import { NextResponse } from "next/server";
import { runPostBigDayStudy } from "@/lib/agents/trading-agent/skills/post-big-day-study";

export const maxDuration = 60;

const DEFAULT_TICKERS = ["INTC"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam
    ? tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_TICKERS;
  const thresholdParam = searchParams.get("threshold");
  const parsedThreshold = thresholdParam ? Number(thresholdParam) : undefined;
  const threshold = parsedThreshold !== undefined && Number.isFinite(parsedThreshold) ? parsedThreshold : undefined;

  try {
    const results = await runPostBigDayStudy(tickers, threshold);
    return NextResponse.json({ tickers: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
