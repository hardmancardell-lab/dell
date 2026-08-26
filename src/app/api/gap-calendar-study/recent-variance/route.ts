import { NextResponse } from "next/server";
import { getRecentDayVarianceStudy } from "@/lib/agents/trading-agent/skills/gap-calendar-study";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });

  const dayCount = Number(searchParams.get("dayCount") ?? "21");
  const flatThresholdPct = Number(searchParams.get("flatThresholdPct") ?? "0.1");

  try {
    const result = await getRecentDayVarianceStudy(ticker, dayCount, flatThresholdPct);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
