import { getDailyBars } from "./daily-bars";
import { fetchMinuteBars } from "@/lib/data/market-data";
import { computeMomentum, computeVolumeDisplacement } from "./scan-signals";
import { computeMeanReversion } from "./mean-reversion";
import { groupCandlesByEasternDay, priceAtOrAfterMinute, priceAtOrNearWindowEnd } from "./bar-aggregation";
import { benjaminiHochberg, bootstrapCi, zTestPValue } from "./stats-tests";
import { computeWinLossMetrics, mean, median, stdDev } from "../stats";
import type { WinLossMetrics } from "../stats";
import type { DailyBar, EquityBacktestSignalType } from "../types";

/**
 * Tests a real, specific claim: does buying at the CLOSE of a signal day
 * (the last 3 minutes of the regular session, not the signal-detection
 * moment) and selling at a specific time the NEXT morning — premarket or
 * early regular-session — actually capture an edge, separate from (and
 * potentially larger than) what the existing N-trading-day-forward-to-close
 * horizons measure? Same signal detection as historical-backtest.ts (no
 * lookahead — only bars through the signal day itself), same full
 * BH-FDR/bootstrap/OOS/three-bars pipeline, applied to real minute bars
 * for the entry and every checkpoint.
 */

const EOD_ENTRY_WINDOW = { start: 957, end: 960 }; // 3:57pm-4:00pm ET — the last 3 minutes of the regular session
const MIN_LOOKBACK_BARS = 21;
const FDR_ALPHA = 0.05;
// A real, hard constraint confirmed live: requesting years of minute bars in
// one call times out on Alpaca's own backend (504) — this is exactly why
// opening-range-breakout.ts caps its own minute-bar fetch at
// ORB_LOOKBACK_MONTH_OPTIONS (max 6 months), never years. Signal detection
// still runs across the full requested lookbackYears using cheap daily bars;
// only signal days that also fall within this shorter minute-bar window can
// produce a real occurrence — older ones are counted in
// daysSkippedNoUsableBars, not silently dropped.
const MINUTE_BAR_LOOKBACK_MONTHS = 6;
const DAYS_PER_MONTH = 30.44;

export interface OvernightCheckpoint {
  label: string;
  minutesSinceMidnight: number; // ET, on the trading day AFTER the signal/entry day
}

// Covers both premarket exits and the two most commonly cited "before the
// late-morning chop" regular-session cutoffs — 10:30am ET and 11:30am ET
// (10:30am Central) — computed side by side rather than guessing which
// timezone convention a "sell by 10:30" rule means.
export const DEFAULT_OVERNIGHT_CHECKPOINTS: OvernightCheckpoint[] = [
  { label: "8:30am ET (premarket)", minutesSinceMidnight: 8 * 60 + 30 },
  { label: "8:45am ET (premarket)", minutesSinceMidnight: 8 * 60 + 45 },
  { label: "9:29am ET (last look before open)", minutesSinceMidnight: 9 * 60 + 29 },
  { label: "10:30am ET", minutesSinceMidnight: 10 * 60 + 30 },
  { label: "11:30am ET (10:30am CT)", minutesSinceMidnight: 11 * 60 + 30 },
];

const STRATEGY_DIRECTION: Record<EquityBacktestSignalType, "long" | "short"> = {
  volumeDisplacement: "long",
  momentum: "long",
  meanReversionOversold: "long",
  meanReversionOverbought: "short",
};

function signalFired(barsSoFar: DailyBar[], signalType: EquityBacktestSignalType): boolean {
  switch (signalType) {
    case "volumeDisplacement":
      return computeVolumeDisplacement(barsSoFar).triggered;
    case "momentum":
      return computeMomentum(barsSoFar).triggered;
    case "meanReversionOversold":
      return computeMeanReversion(barsSoFar).direction === "oversold";
    case "meanReversionOverbought":
      return computeMeanReversion(barsSoFar).direction === "overbought";
  }
}

export interface OvernightCheckpointResult extends WinLossMetrics {
  label: string;
  minutesSinceMidnight: number;
  sampleSize: number;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  // Real dispersion of the move itself — not the same thing as
  // largestLossPct/maxDrawdownPct (the single worst realized outcome).
  // stdDevPct answers "how much does this checkpoint's return typically
  // vary," which is the real input a stop/position-size decision needs,
  // not just the single worst historical print.
  stdDevPct: number | null;
  pValue: number | null;
  pValueFdrAdjusted: number | null;
  significantAfterFdr: boolean;
  bootstrapCiLower: number | null;
  bootstrapCiUpper: number | null;
  ciExcludesZero: boolean;
  trainMeanReturnPct: number | null;
  testMeanReturnPct: number | null;
  sameSignOutOfSample: boolean | null;
  passesAllThreeBars: boolean;
}

export interface OvernightCheckpointBacktestResult {
  ticker: string;
  signalType: EquityBacktestSignalType;
  lookbackYears: number;
  signalDaysFound: number;
  daysSkippedNoUsableBars: number;
  checkpoints: OvernightCheckpointResult[];
  dataLimitations: string[];
}

export async function runOvernightCheckpointBacktest(
  ticker: string,
  signalType: EquityBacktestSignalType,
  lookbackYears: number,
  checkpoints: OvernightCheckpoint[] = DEFAULT_OVERNIGHT_CHECKPOINTS
): Promise<OvernightCheckpointBacktestResult> {
  const symbol = ticker.trim().toUpperCase();
  const lookbackCalendarDays = Math.round(lookbackYears * 365.25) + 30;
  const now = Date.now();
  const minuteLookbackDays = Math.round(MINUTE_BAR_LOOKBACK_MONTHS * DAYS_PER_MONTH);
  const minuteStartMs = now - minuteLookbackDays * 24 * 60 * 60 * 1000;

  const [dailyBars, minuteCandles] = await Promise.all([
    getDailyBars(symbol, lookbackCalendarDays),
    fetchMinuteBars(symbol, minuteStartMs, now, 60 * 30),
  ]);
  if (minuteCandles.length === 0) {
    throw new Error(`No minute bar data returned for ${symbol} — check the ticker is valid.`);
  }

  const minuteDays = groupCandlesByEasternDay(minuteCandles);
  const minuteDayIndexByDateKey = new Map(minuteDays.map((d, i) => [d.dateKey, i]));
  const direction = STRATEGY_DIRECTION[signalType];

  const dataLimitations: string[] = [
    "Entry is modeled at the last available minute bar's close within the 3:57pm-4:00pm ET window (the real last 3 minutes of the regular session) — not necessarily exactly 4:00:00pm if the feed's last print that day came slightly earlier.",
    "Each checkpoint exits at the first available minute bar at or after that clock time the next trading day — a real fill would typically be modestly worse (spread/slippage), especially in the thinner premarket checkpoints.",
    "Premarket minute-bar depth comes from Alpaca's free-tier IEX feed (single-exchange, not the consolidated tape) — the thinnest and least representative part of the session on this provider; isolated premarket prints can look disconnected from the instrument's real full-tape price.",
    "Significance uses a z-test approximation, not an exact Student's t-test (see stats-tests.ts).",
    `Minute bars are only fetched for the trailing ${MINUTE_BAR_LOOKBACK_MONTHS} months regardless of lookbackYears — requesting years of minute bars in one call times out on the data provider's own backend (confirmed live). Signal detection still runs across the full ${lookbackYears}-year window using daily bars; only signal days within the last ${MINUTE_BAR_LOOKBACK_MONTHS} months can produce a real occurrence here — older ones are counted in daysSkippedNoUsableBars.`,
  ];

  interface Occurrence {
    dateKey: string;
    entryPrice: number;
    checkpointPrices: (number | null)[];
  }
  const occurrences: Occurrence[] = [];
  let daysSkippedNoUsableBars = 0;

  for (let i = MIN_LOOKBACK_BARS; i < dailyBars.length; i++) {
    const barsSoFar = dailyBars.slice(0, i + 1);
    if (!signalFired(barsSoFar, signalType)) continue;

    const dateKey = dailyBars[i].dateKey;
    const minuteIdx = minuteDayIndexByDateKey.get(dateKey);
    if (minuteIdx === undefined || minuteIdx + 1 >= minuteDays.length) {
      daysSkippedNoUsableBars++;
      continue;
    }

    const entryPrice = priceAtOrNearWindowEnd(minuteDays[minuteIdx].bars, EOD_ENTRY_WINDOW);
    if (entryPrice === null) {
      daysSkippedNoUsableBars++;
      continue;
    }

    const nextDayBars = minuteDays[minuteIdx + 1].bars;
    const checkpointPrices = checkpoints.map((c) => priceAtOrAfterMinute(nextDayBars, c.minutesSinceMidnight));

    occurrences.push({ dateKey, entryPrice, checkpointPrices });
  }

  if (occurrences.length === 0) {
    return {
      ticker: symbol,
      signalType,
      lookbackYears,
      signalDaysFound: 0,
      daysSkippedNoUsableBars,
      checkpoints: [],
      dataLimitations: [...dataLimitations, "No signal days with usable EOD-entry and next-day bars found in this window."],
    };
  }

  const returnsByCheckpoint: (number | null)[][] = checkpoints.map((_, c) =>
    occurrences.map((o) => {
      const exitPrice = o.checkpointPrices[c];
      if (exitPrice === null) return null;
      const rawPct = ((exitPrice - o.entryPrice) / o.entryPrice) * 100;
      return direction === "long" ? rawPct : -rawPct;
    })
  );

  const rawPValues: (number | null)[] = returnsByCheckpoint.map((values) => {
    const clean = values.filter((v): v is number => v !== null);
    const m = mean(clean);
    const sd = stdDev(clean);
    return m !== null && sd !== null ? zTestPValue(m, sd, clean.length) : null;
  });
  const validIndices = rawPValues.map((p, i) => (p !== null ? i : -1)).filter((i): i is number => i >= 0);
  const adjustedValid = benjaminiHochberg(validIndices.map((i) => rawPValues[i] as number));
  const fdrByIndex = new Map<number, number>();
  validIndices.forEach((i, k) => fdrByIndex.set(i, adjustedValid[k]));

  const results: OvernightCheckpointResult[] = checkpoints.map((c, i) => {
    const values = returnsByCheckpoint[i].filter((v): v is number => v !== null);
    const splitIndex = Math.floor(values.length * 0.75);
    const trainValues = values.slice(0, splitIndex);
    const testValues = values.slice(splitIndex);

    const pValue = rawPValues[i];
    const pValueFdrAdjusted = fdrByIndex.get(i) ?? null;
    const significantAfterFdr = pValueFdrAdjusted !== null && pValueFdrAdjusted < FDR_ALPHA;
    const boot = bootstrapCi(values);
    const trainMean = mean(trainValues);
    const testMean = mean(testValues);
    const sameSignOutOfSample = trainMean !== null && testMean !== null ? Math.sign(trainMean) === Math.sign(testMean) : null;
    const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
    const winLoss = computeWinLossMetrics(values);

    return {
      label: c.label,
      minutesSinceMidnight: c.minutesSinceMidnight,
      sampleSize: values.length,
      meanReturnPct: mean(values),
      medianReturnPct: median(values),
      stdDevPct: stdDev(values),
      pValue,
      pValueFdrAdjusted,
      significantAfterFdr,
      bootstrapCiLower: boot.lower,
      bootstrapCiUpper: boot.upper,
      ciExcludesZero: boot.ciExcludesZero,
      trainMeanReturnPct: trainMean,
      testMeanReturnPct: testMean,
      sameSignOutOfSample,
      passesAllThreeBars,
      ...winLoss,
    };
  });

  if (occurrences.length < 30) {
    dataLimitations.push(`Only ${occurrences.length} real signal-day occurrence(s) found for ${symbol} over ${lookbackYears} year(s) — treat results as directional only, not statistically reliable (n<30).`);
  }
  if (daysSkippedNoUsableBars > 0) {
    dataLimitations.push(`${daysSkippedNoUsableBars} signal day(s) skipped — no usable EOD-close or next-trading-day bars available (edge of history, data gap, or the signal fired on the very last day in range).`);
  }

  return {
    ticker: symbol,
    signalType,
    lookbackYears,
    signalDaysFound: occurrences.length,
    daysSkippedNoUsableBars,
    checkpoints: results,
    dataLimitations,
  };
}
