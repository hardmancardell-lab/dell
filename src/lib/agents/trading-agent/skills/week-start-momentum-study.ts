import { getDailyBars } from "./daily-bars";
import { mean, correlation, computeWinLossMetrics } from "../stats";
import { bootstrapCi } from "./stats-tests";
import type { DailyBar } from "../types";
import type { WinLossMetrics } from "../stats";

const HISTORY_DAYS = 2200; // comfortably covers ~6 years of real trading weeks

function mondayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

export interface WeekStartBucket extends WinLossMetrics {
  label: string;
  minReturnPct: number | null; // inclusive lower bound, null = no lower bound
  maxReturnPct: number | null; // exclusive upper bound, null = no upper bound
  sampleSize: number;
  bootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
}

export interface WeekStartMomentumResult {
  ticker: string;
  weeksFound: number;
  correlationMondayVsRestOfWeek: number | null;
  buckets: WeekStartBucket[];
  currentWeek: {
    mondayDateKey: string | null;
    firstDayReturnPct: number | null; // the real move so far this week, as of the most recent real bar
    matchingBucketLabel: string | null;
  };
  error?: string;
}

// Fixed, disclosed thresholds — not curve-fit to any particular ticker's
// own distribution, so the same buckets apply identically across the basket.
const BUCKET_DEFS: { label: string; min: number | null; max: number | null }[] = [
  { label: "Strong down (≤ -1.0%)", min: null, max: -1.0 },
  { label: "Down (-1.0% to -0.3%)", min: -1.0, max: -0.3 },
  { label: "Flat (-0.3% to +0.3%)", min: -0.3, max: 0.3 },
  { label: "Up (+0.3% to +1.0%)", min: 0.3, max: 1.0 },
  { label: "Strong up (≥ +1.0%)", min: 1.0, max: null },
];

interface WeekPair {
  mondayDateKey: string;
  firstDayReturnPct: number; // the real move on the week's first trading day (Monday, or the first real trading day if Monday was a holiday)
  restOfWeekReturnPct: number | null; // null when the week isn't finished yet (e.g. the current week)
}

async function studyOneTicker(ticker: string): Promise<WeekStartMomentumResult> {
  const bars = await getDailyBars(ticker, HISTORY_DAYS);
  if (bars.length < 10) {
    throw new Error("Not enough daily bars returned for this ticker.");
  }

  const weeks = new Map<string, DailyBar[]>();
  for (const b of bars) {
    const wk = mondayOf(b.dateKey);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push(b);
  }

  const sortedWeekKeys = [...weeks.keys()].sort();
  const pairs: WeekPair[] = [];

  for (let i = 0; i < sortedWeekKeys.length; i++) {
    const wk = sortedWeekKeys[i];
    const weekBars = weeks.get(wk)!.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    if (weekBars.length === 0) continue;

    const firstDay = weekBars[0];
    const firstDayIndexInBars = bars.findIndex((b) => b.dateKey === firstDay.dateKey);
    if (firstDayIndexInBars <= 0) continue; // need a real prior close to compute the first day's own return
    const priorClose = bars[firstDayIndexInBars - 1].close;
    if (priorClose <= 0) continue;
    const firstDayReturnPct = ((firstDay.close - priorClose) / priorClose) * 100;

    const lastDay = weekBars[weekBars.length - 1];
    const isCurrentWeek = i === sortedWeekKeys.length - 1;
    // A week needs at least 3 real trading days beyond the first to call
    // "rest of week" finished — a 1-2 day week (e.g. only Mon-Tue so far, or
    // a holiday-shortened week that never got a real Fri) is excluded from
    // the historical buckets rather than treated as a complete week.
    const restOfWeekReturnPct =
      !isCurrentWeek && weekBars.length >= 4 && firstDay.close > 0
        ? ((lastDay.close - firstDay.close) / firstDay.close) * 100
        : null;

    pairs.push({ mondayDateKey: wk, firstDayReturnPct, restOfWeekReturnPct });
  }

  const completedPairs = pairs.filter((p) => p.restOfWeekReturnPct !== null) as (WeekPair & { restOfWeekReturnPct: number })[];

  const corr = correlation(
    completedPairs.map((p) => p.firstDayReturnPct),
    completedPairs.map((p) => p.restOfWeekReturnPct)
  );

  const buckets: WeekStartBucket[] = BUCKET_DEFS.map((def) => {
    const matching = completedPairs.filter((p) => {
      const v = p.firstDayReturnPct;
      const aboveMin = def.min === null || v >= def.min;
      const belowMax = def.max === null || v < def.max;
      return aboveMin && belowMax;
    });
    const values = matching.map((p) => p.restOfWeekReturnPct);
    const boot = bootstrapCi(values);
    return {
      label: def.label,
      minReturnPct: def.min,
      maxReturnPct: def.max,
      sampleSize: values.length,
      bootstrapCi: { lower: boot.lower, upper: boot.upper, ciExcludesZero: boot.ciExcludesZero },
      ...computeWinLossMetrics(values),
    };
  });

  const current = pairs[pairs.length - 1] ?? null;
  const matchingBucket = current
    ? BUCKET_DEFS.find((def) => {
        const v = current.firstDayReturnPct;
        const aboveMin = def.min === null || v >= def.min;
        const belowMax = def.max === null || v < def.max;
        return aboveMin && belowMax;
      })
    : null;

  return {
    ticker,
    weeksFound: completedPairs.length,
    correlationMondayVsRestOfWeek: corr,
    buckets,
    currentWeek: {
      mondayDateKey: current?.mondayDateKey ?? null,
      firstDayReturnPct: current?.firstDayReturnPct ?? null,
      matchingBucketLabel: matchingBucket?.label ?? null,
    },
  };
}

/**
 * Real conditional study: given how a ticker's week actually started (its
 * first real trading day's return, bucketed into fixed ranges), how has the
 * REST of that week (first-day close through the week's last real trading
 * day) historically turned out? Tests the "strong start begets strong
 * finish" (momentum) vs. "strong start gets faded" (mean reversion)
 * question directly against real weekly bars, and reports which bucket
 * today's own week-start move actually falls into.
 */
export async function runWeekStartMomentumStudy(tickers: string[]): Promise<WeekStartMomentumResult[]> {
  return Promise.all(
    tickers.map(async (ticker) => {
      try {
        return await studyOneTicker(ticker);
      } catch (err) {
        return {
          ticker,
          weeksFound: 0,
          correlationMondayVsRestOfWeek: null,
          buckets: [],
          currentWeek: { mondayDateKey: null, firstDayReturnPct: null, matchingBucketLabel: null },
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    })
  );
}

export const WEEK_START_STUDY_DATA_LIMITATIONS: string[] = [
  "\"First trading day\" is Monday for the vast majority of weeks, but shifts to Tuesday on a Monday-holiday week — this is handled directly (whichever real trading day is first in that week's data), not assumed to always be Monday.",
  "Bucket thresholds (±0.3%, ±1.0%) are fixed and disclosed, not fit to any individual ticker's own return distribution — the same boundaries apply identically across every ticker in a comparison.",
  "The current week (if still in progress) is never included in the historical buckets — only used to show which bucket today's real move falls into, for context.",
  "Bootstrap 95% CIs require at least 5 real data points to ever report significant (ciExcludesZero) — same guard applied across this app's other event studies, since a percentile bootstrap on a handful of points is unreliable.",
  "A holiday-shortened week (fewer than 4 real trading days) is excluded from the historical buckets entirely, rather than counted as a normal week with a shorter 'rest of week.'",
];
