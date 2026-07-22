import { mean, stdDev } from "../stats";
import type { DailyBar, MeanReversionSignal } from "../types";

export const MEAN_REVERSION_LOOKBACK_DAYS = 20;
export const MEAN_REVERSION_Z_THRESHOLD = 2;

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
