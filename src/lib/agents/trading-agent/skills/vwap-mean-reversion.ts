import type { MarketCandle } from "@/lib/data/market-data-types";
import { vwapWithBands } from "./technical-indicators";
import type { VwapMeanReversionSignal } from "../types";

export const VWAP_REVERSION_STD_DEV_MULT = 2;

/**
 * Intraday analog of computeMeanReversion (mean-reversion.ts), which scores
 * a daily close against a rolling SMA of prior closes. This scores the
 * latest intraday bar against today's own session-anchored VWAP, using
 * vwapWithBands' already-computed +/-stdDevMult bands as the
 * oversold/overbought threshold — same +/-2 convention as the daily signal.
 *
 * Pass only today's REGULAR-SESSION bars (WINDOWS.REGULAR_SESSION) — vwap
 * resets on UTC-day boundaries already, but mixing in thin premarket/
 * afterhours volume would distort the bands right where the signal reads
 * them.
 */
export function computeVwapMeanReversion(
  sessionBars: MarketCandle[],
  stdDevMult: number = VWAP_REVERSION_STD_DEV_MULT
): VwapMeanReversionSignal {
  if (sessionBars.length === 0) {
    return {
      triggered: false,
      direction: null,
      price: 0,
      vwap: null,
      upperBand: null,
      lowerBand: null,
      deviationPct: null,
      stdDevMult,
    };
  }

  const { vwap, upper, lower } = vwapWithBands(sessionBars, stdDevMult);
  const i = sessionBars.length - 1;
  const price = sessionBars[i].close;
  const v = vwap[i];
  const u = upper[i];
  const l = lower[i];

  if (v === null || u === null || l === null) {
    return { triggered: false, direction: null, price, vwap: v, upperBand: u, lowerBand: l, deviationPct: null, stdDevMult };
  }

  const direction: VwapMeanReversionSignal["direction"] = price <= l ? "oversold" : price >= u ? "overbought" : null;
  const deviationPct = v !== 0 ? ((price - v) / v) * 100 : null;

  return {
    triggered: direction !== null,
    direction,
    price,
    vwap: v,
    upperBand: u,
    lowerBand: l,
    deviationPct,
    stdDevMult,
  };
}
