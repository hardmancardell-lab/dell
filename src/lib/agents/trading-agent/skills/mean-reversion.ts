import { mean, stdDev } from "../stats";
import { toEasternParts } from "./time-windows";
import type { DailyBar, MeanReversionSignal } from "../types";

export const MEAN_REVERSION_LOOKBACK_DAYS = 20;
export const MEAN_REVERSION_Z_THRESHOLD = 2;

/**
 * Swaps in a live quote price for "today" before scoring, so the alert path
 * (alert-conditions.ts's mean_reversion case) evaluates the CURRENT intraday
 * price against the rolling window, not whatever getDailyBars last returned
 * for today — which lags behind the live tape for two independent reasons:
 * daily-bars.ts caches its fetch for 30 minutes (fetchQuote's own cache is
 * 30 seconds), and some providers don't emit a bar for the current day at
 * all until the session closes. Either way, without this swap the z-score
 * only ever reflects a completed or stale "today" close — which reads as
 * the signal only ever firing end-of-day, even though it's checked more
 * often, because the input it's fed doesn't move until the bar does.
 *
 * If the last bar in `bars` is already dated today (ET), its close is
 * replaced with the live price. If getDailyBars hasn't produced a bar for
 * today yet, a synthetic one is appended. Either way the rolling
 * mean/stddev window (computeMeanReversion's own `bars.slice(0, -1)`) is
 * still built purely from prior, fully-completed days — only the "today"
 * comparison point changes.
 */
export function withLiveTodayClose(bars: DailyBar[], livePrice: number): DailyBar[] {
  if (bars.length === 0 || !Number.isFinite(livePrice) || livePrice <= 0) return bars;

  const todayDateKey = toEasternParts(Date.now()).dateKey;
  const last = bars[bars.length - 1];

  if (last.dateKey === todayDateKey) {
    return [...bars.slice(0, -1), { ...last, close: livePrice, high: Math.max(last.high, livePrice), low: Math.min(last.low, livePrice) }];
  }

  return [...bars, { dateKey: todayDateKey, open: livePrice, high: livePrice, low: livePrice, close: livePrice, volume: 0 }];
}

/**
 * Rolling z-score of today's close vs. a trailing lookback-day mean/stddev
 * of closes. Same asset-class-agnostic treatment as Volume Displacement/
 * Momentum (scan-signals.ts) — pure price math, no equity-specific
 * assumption, so it's wired into the same shared watchlist scan.
 *
 * z <= -threshold: "oversold" (price well below its recent mean — a
 * reversion-up candidate). z >= +threshold: "overbought" (well above —
 * reversion-down candidate). This flags a statistical deviation, not a
 * prediction — see historical-backtest.ts for whether reversion actually
 * followed historically.
 */
export function computeMeanReversion(
  bars: DailyBar[],
  lookbackDays: number = MEAN_REVERSION_LOOKBACK_DAYS,
  zThreshold: number = MEAN_REVERSION_Z_THRESHOLD
): MeanReversionSignal {
  if (bars.length < 2) {
    return {
      triggered: false,
      direction: null,
      zScore: null,
      price: bars[bars.length - 1]?.close ?? 0,
      rollingMean: null,
      rollingStdDev: null,
      lookbackDays,
      threshold: zThreshold,
    };
  }

  const today = bars[bars.length - 1];
  // Uses up to lookbackDays prior closes, but degrades gracefully with fewer
  // (stdDev()/mean() from stats.ts already return null below 2 values) —
  // same graceful-degradation convention computeVolumeDisplacement already
  // uses, rather than an all-or-nothing cutoff requiring the full window.
  const window = bars.slice(0, -1).slice(-lookbackDays).map((b) => b.close);
  const rollingMean = mean(window);
  const rollingStdDev = stdDev(window);
  const zScore =
    rollingMean !== null && rollingStdDev !== null && rollingStdDev > 0
      ? (today.close - rollingMean) / rollingStdDev
      : null;

  const direction: MeanReversionSignal["direction"] =
    zScore === null ? null : zScore <= -zThreshold ? "oversold" : zScore >= zThreshold ? "overbought" : null;

  return {
    triggered: direction !== null,
    direction,
    zScore,
    price: today.close,
    rollingMean,
    rollingStdDev,
    lookbackDays,
    threshold: zThreshold,
  };
}
