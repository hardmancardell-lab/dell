import { fetchFredSeries } from "@/lib/data/fred";
import type { FredObservation } from "@/lib/data/fred";

export type FedRateRegime = "hiking" | "cutting" | "holding";

// A single-month wiggle in FEDFUNDS isn't a "regime" — the Fed holds rates
// flat for long stretches between real moves. Comparing against ~6 months
// back and requiring a real move (not basis-point noise) is the standard
// way commentary distinguishes an actual hiking/cutting cycle from noise.
const REGIME_THRESHOLD_PCT = 0.2;
const LOOKBACK_MONTHS = 6;
const HISTORY_MONTHS = 240; // 20 years — enough for any realistic backtest lookback plus the comparison window

export interface RegimeTimeline {
  observations: FredObservation[]; // FEDFUNDS, ascending by date, nulls filtered
}

export async function getFedRateRegimeTimeline(): Promise<RegimeTimeline> {
  const raw = await fetchFredSeries("FEDFUNDS", HISTORY_MONTHS);
  return { observations: raw.filter((o) => o.value !== null) };
}

/**
 * The regime active on a given calendar date, from the FEDFUNDS trend over
 * the trailing ~6 months as of that date — not simply the latest observation
 * available today, so a day from two years ago is classified using what the
 * regime actually was back then. Returns null when there isn't enough
 * history before the date to compare against (too close to the start of
 * the fetched series).
 */
export function classifyRegimeForDate(dateKey: string, timeline: RegimeTimeline): FedRateRegime | null {
  const upToDate = timeline.observations.filter((o) => o.date <= dateKey);
  if (upToDate.length <= LOOKBACK_MONTHS) return null;

  const current = upToDate[upToDate.length - 1].value as number;
  const prior = upToDate[upToDate.length - 1 - LOOKBACK_MONTHS].value as number;
  const delta = current - prior;

  if (delta >= REGIME_THRESHOLD_PCT) return "hiking";
  if (delta <= -REGIME_THRESHOLD_PCT) return "cutting";
  return "holding";
}
