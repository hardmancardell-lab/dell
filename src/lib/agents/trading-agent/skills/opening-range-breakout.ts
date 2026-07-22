import { fetchMinuteBars } from "@/lib/data/market-data";
import {
  computeDayContext,
  groupCandlesByEasternDay,
  highLowInWindow,
  priceAtOrAfterMinute,
  priceAtOrNearWindowEnd,
  type WindowHighLow,
} from "./bar-aggregation";
import { WINDOWS, formatMinutesAsClock, openingRangeWindow, toEasternParts } from "./time-windows";
import { benjaminiHochberg, bootstrapCi, zTestPValue } from "./stats-tests";
import { computeWinLossMetrics, mean, median, stdDev } from "../stats";
import type {
  DayContextFields,
  OrbDirection,
  OrbHorizonLabel,
  OrbHorizonResult,
  OrbTickerResult,
  OrbTodaySnapshot,
  OrbTradeLogRow,
} from "../types";
import type { SchwabCandle } from "@/lib/data/schwab";

/**
 * Opening Range Breakout — the opening range is the high/low of the first N
 * minutes after the open; a breakout fires the first time price closes
 * beyond that range afterward. Reported returns are STRATEGY returns
 * (positive = profitable for that direction), not raw price change — a
 * "short" occurrence's return is the inverse of the raw price move, since a
 * falling price is what makes a short profitable. Same BH-FDR/bootstrap/
 * time-split/three-bars pipeline as historical-backtest.ts and
 * calendar-effects.ts, run across 6 (direction × horizon) buckets.
 */

const HORIZON_LABELS: OrbHorizonLabel[] = ["30minAfterBreakout", "60minAfterBreakout", "holdToEod"];
const DIRECTIONS: OrbDirection[] = ["long", "short"];
const FDR_ALPHA = 0.05;
const DAYS_PER_MONTH = 30.44;

interface DayOccurrence {
  dateKey: string;
  direction: OrbDirection;
  entryPrice: number;
  breakoutMinute: number;
  forwardPrices: (number | null)[]; // indexed same as HORIZON_LABELS
  dayContext: DayContextFields;
}

function detectBreakout(
  bars: SchwabCandle[],
  orRange: WindowHighLow,
  rangeWindowEnd: number
): { direction: OrbDirection | null; breakoutMinute: number | null; entryPrice: number | null } {
  for (const b of bars) {
    const { minutesSinceMidnight } = toEasternParts(b.datetime);
    if (minutesSinceMidnight < rangeWindowEnd) continue; // still within/before the opening range itself
    if (orRange.high !== null && b.close > orRange.high) {
      return { direction: "long", breakoutMinute: minutesSinceMidnight, entryPrice: b.close };
    }
    if (orRange.low !== null && b.close < orRange.low) {
      return { direction: "short", breakoutMinute: minutesSinceMidnight, entryPrice: b.close };
    }
  }
  return { direction: null, breakoutMinute: null, entryPrice: null };
}

function strategyReturnPct(direction: OrbDirection, entryPrice: number, futurePrice: number): number {
  const rawChangePct = ((futurePrice - entryPrice) / entryPrice) * 100;
  return direction === "long" ? rawChangePct : -rawChangePct;
}

export async function runOrbBacktest(
  ticker: string,
  openingRangeMinutes: 5 | 15 | 30,
  lookbackMonths: number
): Promise<OrbTickerResult> {
  const symbol = ticker.trim().toUpperCase();
  const now = Date.now();
  const lookbackDays = Math.round(lookbackMonths * DAYS_PER_MONTH);
  const startMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  const candles = await fetchMinuteBars(symbol, startMs, now, 60 * 30); // 30 min cache, same convention as daily-bars.ts
  if (candles.length === 0) {
    throw new Error(`No minute bar data returned for ${symbol} — check the ticker is valid.`);
  }
  const days = groupCandlesByEasternDay(candles);
  const rangeWindow = openingRangeWindow(openingRangeMinutes);

  const dataLimitations: string[] = [
    "Reported returns are strategy returns for that direction (positive = profitable), not raw price change — a short occurrence's return is the inverse of the raw price move.",
    "Entry is modeled at the breakout bar's close with no slippage or intrabar-fill assumption — a real fill would typically be worse.",
    "Days where the opening range window has no available bars (early close, holiday, feed gap) are skipped and counted separately rather than fabricated — no US market holiday calendar is integrated in this app.",
    "Significance uses a z-test approximation, not an exact Student's t-test (see stats-tests.ts).",
    "Minute-bar depth on this provider's free tier is unverified beyond what's been live-tested — see ALPACA_INTEGRATION_NOTES.md.",
  ];

  let daysSkippedNoOpeningRangeBars = 0;
  const occurrences: DayOccurrence[] = [];
  let todaySnapshot: OrbTodaySnapshot | null = null;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const orRange = highLowInWindow(day.bars, rangeWindow);
    const dayContext = computeDayContext(day, i > 0 ? days[i - 1] : null);
    const isLastDay = i === days.length - 1;

    if (orRange.high === null || orRange.low === null) {
      daysSkippedNoOpeningRangeBars++;
      if (isLastDay) {
        todaySnapshot = {
          dateKey: day.dateKey,
          openingRangeHigh: null,
          openingRangeLow: null,
          breakoutDirection: null,
          breakoutTimeClock: null,
        };
      }
      continue;
    }

    const breakout = detectBreakout(day.bars, orRange, rangeWindow.end);

    if (isLastDay) {
      todaySnapshot = {
        dateKey: day.dateKey,
        openingRangeHigh: orRange.high,
        openingRangeLow: orRange.low,
        breakoutDirection: breakout.direction ?? "none-yet",
        breakoutTimeClock: breakout.breakoutMinute !== null ? formatMinutesAsClock(breakout.breakoutMinute) : null,
      };
    }

    if (breakout.direction === null || breakout.breakoutMinute === null || breakout.entryPrice === null) continue;

    const forwardPrices: (number | null)[] = [
      priceAtOrAfterMinute(day.bars, breakout.breakoutMinute + 30),
      priceAtOrAfterMinute(day.bars, breakout.breakoutMinute + 60),
      priceAtOrNearWindowEnd(day.bars, WINDOWS.REGULAR_SESSION),
    ];

    occurrences.push({
      dateKey: day.dateKey,
      direction: breakout.direction,
      entryPrice: breakout.entryPrice,
      breakoutMinute: breakout.breakoutMinute,
      forwardPrices,
      dayContext,
    });
  }

  const buckets: number[][] = [];
  const bucketMeta: { direction: OrbDirection; horizonLabel: OrbHorizonLabel }[] = [];
  for (const direction of DIRECTIONS) {
    const directionOccurrences = occurrences.filter((o) => o.direction === direction);
    for (let h = 0; h < HORIZON_LABELS.length; h++) {
      const values = directionOccurrences
        .map((o) => (o.forwardPrices[h] !== null ? strategyReturnPct(direction, o.entryPrice, o.forwardPrices[h] as number) : null))
        .filter((v): v is number => v !== null);
      buckets.push(values);
      bucketMeta.push({ direction, horizonLabel: HORIZON_LABELS[h] });
    }
  }

  const rawPValues: (number | null)[] = buckets.map((values) => {
    const m = mean(values);
    const sd = stdDev(values);
    return m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  });
  const validIndices = rawPValues.map((p, i) => (p !== null ? i : -1)).filter((i): i is number => i >= 0);
  const adjustedValid = benjaminiHochberg(validIndices.map((i) => rawPValues[i] as number));
  const fdrByIndex = new Map<number, number>();
  validIndices.forEach((i, k) => fdrByIndex.set(i, adjustedValid[k]));

  const horizons: OrbHorizonResult[] = buckets.map((values, i) => {
    const splitIndex = Math.floor(values.length * 0.75);
    const trainValues = values.slice(0, splitIndex);
    const testValues = values.slice(splitIndex);

    const pValue = rawPValues[i];
    const pValueFdrAdjusted = fdrByIndex.get(i) ?? null;
    const significantAfterFdr = pValueFdrAdjusted !== null && pValueFdrAdjusted < FDR_ALPHA;
    const boot = bootstrapCi(values);
    const trainMean = mean(trainValues);
    const testMean = mean(testValues);
    const sameSignOutOfSample =
      trainMean !== null && testMean !== null ? Math.sign(trainMean) === Math.sign(testMean) : null;
    const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
    const winLoss = computeWinLossMetrics(values);

    return {
      direction: bucketMeta[i].direction,
      horizonLabel: bucketMeta[i].horizonLabel,
      sampleSize: values.length,
      meanReturnPct: mean(values),
      medianReturnPct: median(values),
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

  const longOccurrences = occurrences.filter((o) => o.direction === "long").length;
  const shortOccurrences = occurrences.filter((o) => o.direction === "short").length;
  if (Math.min(longOccurrences, shortOccurrences) < 30) {
    dataLimitations.push(
      `Fewer than 30 occurrences for at least one direction (${longOccurrences} long, ${shortOccurrences} short) over ${lookbackMonths} month(s) — treat results as directional only, not statistically reliable (n<30).`
    );
  }
  if (daysSkippedNoOpeningRangeBars > 0) {
    dataLimitations.push(`${daysSkippedNoOpeningRangeBars} trading day(s) had no bars in the opening-range window and were skipped.`);
  }

  const tradeLog: OrbTradeLogRow[] = occurrences.map((o) => {
    const returnPct30min = o.forwardPrices[0] !== null ? strategyReturnPct(o.direction, o.entryPrice, o.forwardPrices[0]) : null;
    const returnPct60min = o.forwardPrices[1] !== null ? strategyReturnPct(o.direction, o.entryPrice, o.forwardPrices[1]) : null;
    const returnPctEod = o.forwardPrices[2] !== null ? strategyReturnPct(o.direction, o.entryPrice, o.forwardPrices[2]) : null;
    return {
      dateKey: o.dateKey,
      direction: o.direction,
      entryPrice: o.entryPrice,
      breakoutTimeClock: formatMinutesAsClock(o.breakoutMinute),
      returnPct30min,
      returnPct60min,
      returnPctEod,
      isWin: returnPctEod !== null ? returnPctEod > 0 : null,
      ...o.dayContext,
    };
  });

  return {
    ticker: symbol,
    openingRangeMinutes,
    lookbackMonths,
    tradingDaysScanned: days.length,
    daysSkippedNoOpeningRangeBars,
    longOccurrences,
    shortOccurrences,
    todaySnapshot,
    horizons,
    tradeLog,
    dataLimitations,
  };
}
