import { NextResponse } from "next/server";
import { runWitchingRangeContainmentStudy } from "@/lib/agents/trading-agent/skills/witching-day-range-containment";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "NVDA";
  const lowerBoundPct = Number(searchParams.get("lowerBoundPct") ?? "-5");
  const upperBoundPct = Number(searchParams.get("upperBoundPct") ?? "5");
  const lookbackYears = Number(searchParams.get("lookbackYears") ?? "3");
  const shortStrikePct = Number(searchParams.get("shortStrikePct") ?? "100");
  const lowerLongPct = Number(searchParams.get("lowerLongPct") ?? "95");
  const upperLongPct = Number(searchParams.get("upperLongPct") ?? "105");
  const shortContracts = Number(searchParams.get("shortContracts") ?? "2");

  try {
    const result = await runWitchingRangeContainmentStudy(
      ticker,
      lowerBoundPct,
      upperBoundPct,
      lookbackYears,
      shortStrikePct,
      lowerLongPct,
      upperLongPct,
      shortContracts
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
