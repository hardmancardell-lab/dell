import { NextResponse } from "next/server";
import { fetchFredSeries, latest } from "@/lib/data/fred";
import { getFedRateRegimeTimeline, classifyRegimeForDate } from "@/lib/agents/trading-agent/skills/macro-regime";

// Candidate FRED series for Japan's short-term policy/interbank rate — try
// several since the exact series ID isn't confirmed yet.
const JAPAN_RATE_CANDIDATES = ["IRSTCI01JPM156N", "INTDSRJPM193N", "IR3TIB01JPM156N", "JPNIR3M"];

export async function GET() {
  const results: Record<string, unknown> = {};

  for (const seriesId of JAPAN_RATE_CANDIDATES) {
    try {
      const obs = await fetchFredSeries(seriesId, 240);
      results[seriesId] = {
        ok: true,
        count: obs.length,
        first: obs[0],
        latest: latest(obs),
      };
    } catch (err) {
      results[seriesId] = { ok: false, error: err instanceof Error ? err.message : "unknown" };
    }
  }

  let usRegimeToday: unknown = null;
  try {
    const timeline = await getFedRateRegimeTimeline();
    const todayKey = new Date().toISOString().slice(0, 10);
    usRegimeToday = {
      regime: classifyRegimeForDate(todayKey, timeline),
      latestObs: timeline.observations[timeline.observations.length - 1],
      count: timeline.observations.length,
    };
  } catch (err) {
    usRegimeToday = { error: err instanceof Error ? err.message : "unknown" };
  }

  return NextResponse.json({ japanRateCandidates: results, usRegimeToday });
}
