import { fetchMinuteBars } from "@/lib/data/market-data";
import {
  groupCandlesByEasternDay,
  highLowInWindow,
  priceAtOrNearWindowEnd,
  priceAtOrNearWindowStart,
} from "./bar-aggregation";
import { WINDOWS, buildTimeOfDayFrequency } from "./time-windows";

export interface PremarketGapDay {
  dateKey: string;
  priorClose: number;
  premarketLow: number | null;
  dropToPremarketLowPct: number | null;
  openPrice: number | null;
  dropToOpenPct: number | null;
}

export interface HodLodResult {
  ticker: string;
  lookbackDays: number;
  tradingDaysAnalyzed: number;
  dropThresholdPct: number;
  premarketDropDays: PremarketGapDay[]; // days where drop-to-premarket-low breached the threshold, sorted worst first
  gapDownAtOpenDays: PremarketGapDay[]; // days where drop-to-open breached the threshold, sorted worst first
  daysWithUsableHigh: number;
  daysWithUsableLow: number;
  pctHighBefore1030Et: number | null;
  pctLowBefore1030Et: number | null;
  avgIntradayRangePctOfClose: number | null;
  medianIntradayRangePctOfClose: number | null;
  highOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  lowOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  dataLimitations: string[];
}

const TEN_THIRTY_AM_MINUTES = 10 * 60 + 30;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Real premarket-gap-frequency and high-of-day/low-of-day timing stats over
 * an arbitrary lookback, computed from real minute bars (no synthetic data).
 * Minute bars route through market-data.ts, same as historical-composite.ts —
 * for equities that's Alpaca's free-tier IEX feed (single-exchange, thinnest
 * in premarket), so isolated premarket prints can occasionally look
 * disconnected from the full-tape price. Flagged in dataLimitations, same
 * caveat as historical-composite.ts.
 */
export async function getPremarketGapAndHodLodStats(
  ticker: string,
  lookbackDays: number = 365,
  dropThresholdPct: number = 4.5
): Promise<HodLodResult> {
  const dataLimitations: string[] = [
    "Minute bars come from Alpaca's free-tier IEX feed (single-exchange, not the consolidated tape) — thinnest in premarket, so isolated prints can occasionally look disconnected from the stock's real full-tape price on low-liquidity days.",
  ];

  const now = Date.now();
  const startMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  const bars = await fetchMinuteBars(ticker, startMs, now, 60 * 60 * 6);
  const days = groupCandlesByEasternDay(bars);

  const premarketDropDays: PremarketGapDay[] = [];
  const gapDownAtOpenDays: PremarketGapDay[] = [];

  for (let i = 1; i < days.length; i++) {
    const day = days[i];
    const priorDay = days[i - 1];
    const priorClose = priceAtOrNearWindowEnd(priorDay.bars, WINDOWS.REGULAR_SESSION);
    if (priorClose === null || priorClose === 0) continue;

    const pmWindow = highLowInWindow(day.bars, WINDOWS.PREMARKET);
    const openPrice = priceAtOrNearWindowStart(day.bars, WINDOWS.REGULAR_SESSION);

    const dropToPremarketLowPct =
      pmWindow.low !== null ? ((pmWindow.low - priorClose) / priorClose) * 100 : null;
    const dropToOpenPct = openPrice !== null ? ((openPrice - priorClose) / priorClose) * 100 : null;

    const row: PremarketGapDay = {
      dateKey: day.dateKey,
      priorClose,
      premarketLow: pmWindow.low,
      dropToPremarketLowPct,
      openPrice,
      dropToOpenPct,
    };

    if (dropToPremarketLowPct !== null && dropToPremarketLowPct <= -dropThresholdPct) {
      premarketDropDays.push(row);
    }
    if (dropToOpenPct !== null && dropToOpenPct <= -dropThresholdPct) {
      gapDownAtOpenDays.push(row);
    }
  }
  premarketDropDays.sort((a, b) => a.dropToPremarketLowPct! - b.dropToPremarketLowPct!);
  gapDownAtOpenDays.sort((a, b) => a.dropToOpenPct! - b.dropToOpenPct!);

  const highTimes: number[] = [];
  const lowTimes: number[] = [];
  const ranges: number[] = [];

  for (const day of days) {
    const session = highLowInWindow(day.bars, WINDOWS.REGULAR_SESSION);
    const closeP = priceAtOrNearWindowEnd(day.bars, WINDOWS.REGULAR_SESSION);
    if (session.highTime !== null) highTimes.push(session.highTime);
    if (session.lowTime !== null) lowTimes.push(session.lowTime);
    if (session.high !== null && session.low !== null && closeP) {
      ranges.push(((session.high - session.low) / closeP) * 100);
    }
  }

  if (days.length < 5) {
    dataLimitations.push(`Only ${days.length} trading day(s) found in the lookback window — treat every stat here as directional only.`);
  }

  return {
    ticker,
    lookbackDays,
    tradingDaysAnalyzed: days.length,
    dropThresholdPct,
    premarketDropDays,
    gapDownAtOpenDays,
    daysWithUsableHigh: highTimes.length,
    daysWithUsableLow: lowTimes.length,
    pctHighBefore1030Et:
      highTimes.length > 0 ? (highTimes.filter((t) => t < TEN_THIRTY_AM_MINUTES).length / highTimes.length) * 100 : null,
    pctLowBefore1030Et:
      lowTimes.length > 0 ? (lowTimes.filter((t) => t < TEN_THIRTY_AM_MINUTES).length / lowTimes.length) * 100 : null,
    avgIntradayRangePctOfClose: mean(ranges),
    medianIntradayRangePctOfClose: median(ranges),
    highOfDayTimeDistribution: buildTimeOfDayFrequency(highTimes, highTimes.length),
    lowOfDayTimeDistribution: buildTimeOfDayFrequency(lowTimes, lowTimes.length),
    dataLimitations,
  };
}
