import type { DailyBar } from "../types";

/**
 * Volume Profile from daily OHLCV bars — a real, standard technique for
 * when only daily bars are available (no tick/intrabar data): each day's
 * real volume is distributed evenly across that day's own [low, high]
 * range rather than dumped on a single price (the close), which is the
 * disclosed approximation every charting platform without tick data makes.
 * Point of Control = the price level with the most distributed volume;
 * high-volume nodes are the levels professionals treat as real
 * support/resistance because real size has traded there before.
 */

export interface VolumeProfileBin {
  priceLow: number;
  priceHigh: number;
  priceMid: number;
  volume: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  pointOfControlPrice: number | null;
  highVolumeNodePrices: number[]; // sorted ascending
}

const DEFAULT_BIN_COUNT = 40;
// A bin counts as a "high-volume node" once it holds at least this fraction
// of the single busiest bin's volume — a real, disclosed threshold (not
// tuned/curve-fit), consistent with how practitioners define HVNs relative
// to the Point of Control rather than an absolute volume level.
const HVN_RELATIVE_THRESHOLD = 0.6;

export function computeVolumeProfile(bars: DailyBar[], binCount = DEFAULT_BIN_COUNT): VolumeProfile {
  if (bars.length === 0) return { bins: [], pointOfControlPrice: null, highVolumeNodePrices: [] };

  const rangeLow = Math.min(...bars.map((b) => b.low));
  const rangeHigh = Math.max(...bars.map((b) => b.high));
  if (rangeHigh <= rangeLow) return { bins: [], pointOfControlPrice: null, highVolumeNodePrices: [] };

  const binWidth = (rangeHigh - rangeLow) / binCount;
  const bins: VolumeProfileBin[] = Array.from({ length: binCount }, (_, i) => ({
    priceLow: rangeLow + i * binWidth,
    priceHigh: rangeLow + (i + 1) * binWidth,
    priceMid: rangeLow + (i + 0.5) * binWidth,
    volume: 0,
  }));

  for (const bar of bars) {
    const barRange = bar.high - bar.low;
    if (barRange <= 0) {
      // No real intrabar range (halted/thin day) — the whole day's volume
      // goes to whichever single bin contains the close.
      const idx = Math.min(binCount - 1, Math.max(0, Math.floor((bar.close - rangeLow) / binWidth)));
      bins[idx].volume += bar.volume;
      continue;
    }
    // Distribute this day's volume across every bin its [low, high] overlaps,
    // weighted by the fraction of the day's range that bin covers.
    const firstIdx = Math.max(0, Math.floor((bar.low - rangeLow) / binWidth));
    const lastIdx = Math.min(binCount - 1, Math.floor((bar.high - rangeLow) / binWidth));
    for (let i = firstIdx; i <= lastIdx; i++) {
      const overlapLow = Math.max(bar.low, bins[i].priceLow);
      const overlapHigh = Math.min(bar.high, bins[i].priceHigh);
      const overlapFraction = Math.max(0, overlapHigh - overlapLow) / barRange;
      bins[i].volume += bar.volume * overlapFraction;
    }
  }

  const maxVolume = Math.max(...bins.map((b) => b.volume));
  if (maxVolume <= 0) return { bins, pointOfControlPrice: null, highVolumeNodePrices: [] };

  const pointOfControl = bins.reduce((best, b) => (b.volume > best.volume ? b : best));
  const highVolumeNodePrices = bins
    .filter((b) => b.volume >= maxVolume * HVN_RELATIVE_THRESHOLD)
    .map((b) => b.priceMid)
    .sort((a, b) => a - b);

  return { bins, pointOfControlPrice: pointOfControl.priceMid, highVolumeNodePrices };
}

/** Nearest high-volume node below (long) or above (short) a reference price — the real, objective "nearest liquidity zone" a stop should reference, not a guessed percentage. Null if no node exists on the required side. */
export function findNearestLiquidityZone(profile: VolumeProfile, referencePrice: number, direction: "long" | "short"): number | null {
  const candidates = direction === "long"
    ? profile.highVolumeNodePrices.filter((p) => p < referencePrice)
    : profile.highVolumeNodePrices.filter((p) => p > referencePrice);
  if (candidates.length === 0) return null;
  return direction === "long" ? Math.max(...candidates) : Math.min(...candidates);
}
