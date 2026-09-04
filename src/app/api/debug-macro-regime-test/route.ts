import { NextResponse } from "next/server";
import { getFedRateRegimeTimeline, classifyRegimeForDate } from "@/lib/agents/trading-agent/skills/macro-regime";

/** Temporary — verifies real FEDFUNDS classification against known Fed history. Remove once done. */
export async function GET() {
  try {
    const timeline = await getFedRateRegimeTimeline();
    const testDates = ["2019-06-15", "2022-09-15", "2024-01-15", "2026-08-26"];
    const results = testDates.map((d) => ({ date: d, regime: classifyRegimeForDate(d, timeline) }));
    return NextResponse.json({
      observationCount: timeline.observations.length,
      first: timeline.observations[0],
      last: timeline.observations[timeline.observations.length - 1],
      results,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
