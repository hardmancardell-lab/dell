import { NextResponse } from "next/server";
import { runPegReversionBacktest, DEFAULT_PEG_DEVIATION_THRESHOLD_PCT } from "@/lib/agents/trading-agent/skills/peg-reversion";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pair = searchParams.get("pair");
    if (!pair) {
      return NextResponse.json({ error: "Query param 'pair' is required, e.g. ?pair=USD/HKD." }, { status: 400 });
    }
    const lookbackYears = Number(searchParams.get("lookbackYears") ?? "3");
    const thresholdParam = searchParams.get("thresholdPct");
    const deviationThresholdPct = thresholdParam !== null ? Number(thresholdParam) : DEFAULT_PEG_DEVIATION_THRESHOLD_PCT;

    const result = await runPegReversionBacktest(pair, lookbackYears, deviationThresholdPct);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
