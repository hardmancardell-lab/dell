import type { SchwabCandle } from "@/lib/data/schwab";
import { formatMinutesAsClock, isWithin, toEasternParts, WINDOWS, type EasternTimeParts } from "./time-windows";
import type { DayContextFields } from "../types";

export interface DayBars {
  dateKey: string;
  bars: SchwabCandle[]; // ascending by datetime
}

export function groupCandlesByEasternDay(candles: SchwabCandle[]): DayBars[] {
  const map = new Map<string, SchwabCandle[]>();
  for (const c of candles) {
    const { dateKey } = toEasternParts(c.datetime);
    if (!map.has(dateKey)) map.set(dateKey, []);
    map.get(dateKey)!.push(c);
  }
  return Array.from(map.entries())
    .map(([dateKey, bars]) => ({ dateKey, bars: bars.sort((a, b) => a.datetime - b.datetime) }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function sumVolumeInWindow(bars: SchwabCandle[], window: { start: number; end: number }): number {
  return bars.reduce((sum, b) => {
    const { minutesSinceMidnight } = toEasternParts(b.datetime);
    return isWithin(minutesSinceMidnight, window) ? sum + b.volume : sum;
  }, 0);
}

/** Opening price of the first bar found within the window. */
export function priceAtOrNearWindowStart(
  bars: SchwabCandle[],
  window: { start: number; end: number }
): number | null {
  for (const b of bars) {
    const { minutesSinceMidnight } = toEasternParts(b.datetime);
    if (isWithin(minutesSinceMidnight, window)) return b.open;
  }
  return null;
}

/** Closing price of the last bar found within the window. */
export function priceAtOrNearWindowEnd(
  bars: SchwabCandle[],
  window: { start: number; end: number }
): number | null {
  let last: number | null = null;
  for (const b of bars) {
    const { minutesSinceMidnight } = toEasternParts(b.datetime);
    if (isWithin(minutesSinceMidnight, window)) last = b.close;
  }
  return last;
}

/** Close price of the first bar at or after a given minute-of-day — used for ORB's post-breakout horizon checkpoints. */
export function priceAtOrAfterMinute(bars: SchwabCandle[], minute: number): number | null {
  for (const b of bars) {
    const { minutesSinceMidnight } = toEasternParts(b.datetime);
    if (minutesSinceMidnight >= minute) return b.close;
  }
  return null;
}

export interface WindowHighLow {
  high: number | null;
  low: number | null;
  highTime: number | null; // minutesSinceMidnight
  lowTime: number | null;
}

export function highLowInWindow(
  bars: SchwabCandle[],
  window: { start: number; end: number }
): WindowHighLow {
  let high = -Infinity;
  let low = Infinity;
  let highTime: number | null = null;
  let lowTime: number | null = null;

  for (const b of bars) {
    const { minutesSinceMidnight }: EasternTimeParts = toEasternParts(b.datetime);
    if (!isWithin(minutesSinceMidnight, window)) continue;
    if (b.high > high) {
      high = b.high;
      highTime = minutesSinceMidnight;
    }
    if (b.low < low) {
      low = b.low;
      lowTime = minutesSinceMidnight;
    }
  }

  return {
    high: high === -Infinity ? null : high,
    low: low === Infinity ? null : low,
    highTime,
    lowTime,
  };
}

/**
 * Overnight gap % (prior session's regular-hours close -> this session's
 * regular-hours open) plus this day's full-session high/low and the clock
 * time each occurred. Pass null for priorDay on the first day in a series —
 * there's nothing to gap from.
 */
export function computeDayContext(day: DayBars, priorDay: DayBars | null): DayContextFields {
  const session = highLowInWindow(day.bars, WINDOWS.REGULAR_SESSION);
  const todayOpen = priceAtOrNearWindowStart(day.bars, WINDOWS.REGULAR_SESSION);
  const priorClose = priorDay ? priceAtOrNearWindowEnd(priorDay.bars, WINDOWS.REGULAR_SESSION) : null;
  const overnightGapPct =
    priorClose !== null && priorClose !== 0 && todayOpen !== null
      ? ((todayOpen - priorClose) / priorClose) * 100
      : null;

  return {
    overnightGapPct,
    dayHigh: session.high,
    dayLow: session.low,
    dayHighTimeClock: session.highTime !== null ? formatMinutesAsClock(session.highTime) : null,
    dayLowTimeClock: session.lowTime !== null ? formatMinutesAsClock(session.lowTime) : null,
  };
}
