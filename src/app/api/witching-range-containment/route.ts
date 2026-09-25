import { NextResponse } from "next/server";
import { runWitchingRangeContainmentStudy } from "@/lib/agents/trading-agent/skills/witching-day-range-containment";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "NVDA";
  const lowerBoundPct = Number(searchParams.get("lowerBoundPct") ?? "0");
  const upperBoundPct = Number(searchParams.get("upperBoundPct") ?? "15");
  const lookbackYears = Number(searchParams.get("lookbackYears") ?? "3");

  try {
    const result = await runWitchingRangeContainmentStudy(ticker, lowerBoundPct, upperBoundPct, lookbackYears);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
