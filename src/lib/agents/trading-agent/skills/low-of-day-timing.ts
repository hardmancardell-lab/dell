import { fetchMinuteBars } from "@/lib/data/market-data";
import type { MarketCandle } from "@/lib/data/market-data-types";
import { groupCandlesByEasternDay, highLowInWindow } from "./bar-aggregation";
import { WINDOWS, buildTimeOfDayFrequency, formatMinutesAsClock } from "./time-windows";

const MINUTE_BAR_LOOKBACK_MONTHS = 3; // same real Alpaca free-tier depth limit disclosed elsewhere in this app
const LATE_LOW_CUTOFF_MINUTES = WINDOWS.FIRST_HOUR.end; // 10:30am ET

async function fetchMinuteBarsChunked(ticker: string, startMs: number, endMs: number, chunkDays = 30): Promise<MarketCandle[]> {
  const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
  const windows: { s: number; e: number }[] = [];
  for (let s = startMs; s < endMs; s += chunkMs) windows.push({ s, e: Math.min(s + chunkMs, endMs) });
  const chunks = await Promise.all(windows.map((w) => fetchMinuteBars(ticker, w.s, w.e, 60 * 60 * 6)));
  const byTimestamp = new Map<number, MarketCandle>();
  for (const c of chunks.flat()) byTimestamp.set(c.datetime, c);
  return Array.from(byTimestamp.values()).sort((a, b) => a.datetime - b.datetime);
}

export interface LowOfDayTimingResult {
  ticker: string;
  lateLowCutoffClock: string; // "10:30am"
  daysAnalyzed: number;
  pctLowBeforeCutoff: number | null;
  pctLowAtOrAfterCutoff: number | null;
  overallLowOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  // The actual question asked: among the days where the low did NOT come
  // before the cutoff, when does it usually happen instead?
  lateLowDays: {
    count: number;
    timeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
    mostCommonBucket: string | null;
    medianLowClock: string | null;
  };
  dataLimitations: string[];
  error?: string;
}

async function studyOneTicker(ticker: string): Promise<LowOfDayTimingResult> {
  const now = Date.now();
  const startMs = now - MINUTE_BAR_LOOKBACK_MONTHS * 30.44 * 24 * 60 * 60 * 1000;
  const minuteBars = await fetchMinuteBarsChunked(ticker, startMs, now);
  const days = groupCandlesByEasternDay(minuteBars);

  const allLowTimes: number[] = [];
  const lateLowTimes: number[] = [];

  for (const day of days) {
    const session = highLowInWindow(day.bars, WINDOWS.REGULAR_SESSION);
    if (session.lowTime === null) continue;
    allLowTimes.push(session.lowTime);
    if (session.lowTime >= LATE_LOW_CUTOFF_MINUTES) lateLowTimes.push(session.lowTime);
  }

  const overallLowOfDayTimeDistribution = buildTimeOfDayFrequency(allLowTimes, allLowTimes.length);
  const lateLowDistribution = buildTimeOfDayFrequency(lateLowTimes, lateLowTimes.length);
  const sortedLateLows = [...lateLowTimes].sort((a, b) => a - b);
  const medianLateLow = sortedLateLows.length > 0 ? sortedLateLows[Math.floor(sortedLateLows.length / 2)] : null;

  const dataLimitations: string[] = [
    `Real minute bars only reliably reach back about ${MINUTE_BAR_LOOKBACK_MONTHS} months on this app's data provider — this is a recent-pattern check over that window, not a multi-year backtest.`,
    "\"Low of day\" is the real regular-session (9:30am-4:00pm ET) low print — premarket/after-hours lows are excluded, matching this app's other HOD/LOD studies.",
    `The "late low" subset (at or after ${formatMinutesAsClock(LATE_LOW_CUTOFF_MINUTES)}) is exactly the population asked about — it excludes every day where the low actually did come before that cutoff, so its own sample size is meaningfully smaller than the total days analyzed.`,
  ];

  return {
    ticker,
    lateLowCutoffClock: formatMinutesAsClock(LATE_LOW_CUTOFF_MINUTES),
    daysAnalyzed: allLowTimes.length,
    pctLowBeforeCutoff: allLowTimes.length > 0 ? ((allLowTimes.length - lateLowTimes.length) / allLowTimes.length) * 100 : null,
    pctLowAtOrAfterCutoff: allLowTimes.length > 0 ? (lateLowTimes.length / allLowTimes.length) * 100 : null,
    overallLowOfDayTimeDistribution,
    lateLowDays: {
      count: lateLowTimes.length,
      timeDistribution: lateLowDistribution,
      mostCommonBucket: lateLowDistribution.length === 0 ? null : lateLowDistribution.reduce((a, b) => (b.count > a.count ? b : a)).bucketLabel,
      medianLowClock: medianLateLow !== null ? formatMinutesAsClock(medianLateLow) : null,
    },
    dataLimitations,
  };
}

/**
 * Real conditional calendar-effects check: on the real trading days where
 * the session low did NOT form before a cutoff time (10:30am ET by
 * default), when does it actually tend to happen instead? Reports the full
 * unconditioned low-of-day distribution for context, then isolates just the
 * late-low subset and shows its own real timing distribution, most common
 * 30-minute bucket, and median clock time.
 */
export async function runLowOfDayTimingStudy(tickers: string[]): Promise<LowOfDayTimingResult[]> {
  return Promise.all(
    tickers.map(async (ticker) => {
      try {
        return await studyOneTicker(ticker);
      } catch (err) {
        return {
          ticker,
          lateLowCutoffClock: formatMinutesAsClock(LATE_LOW_CUTOFF_MINUTES),
          daysAnalyzed: 0,
          pctLowBeforeCutoff: null,
          pctLowAtOrAfterCutoff: null,
          overallLowOfDayTimeDistribution: [],
          lateLowDays: { count: 0, timeDistribution: [], mostCommonBucket: null, medianLowClock: null },
          dataLimitations: [],
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    })
  );
}
