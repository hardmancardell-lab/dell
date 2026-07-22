import type { MarketCandle } from "@/lib/data/market-data-types";

/**
 * Pure technical-indicator math over OHLCV candle data — zero runtime
 * dependencies beyond a type-only import, so this is safe for client
 * components to import directly (same client-safe pattern as
 * options-flow-skew.ts / top-traded-pairs.ts).
 *
 * Every function returns arrays the same length as the input candles,
 * index-aligned (result[i] corresponds to candles[i]), using `null` during
 * warm-up periods where the indicator isn't yet defined. Multi-line
 * indicators return a named object of such arrays. volumeProfile() is the
 * one exception — it's a single summary over the whole input window, not a
 * time series.
 *
 * Institutional microstructure indicators (CVD, Footprint/Cluster charts,
 * Liquidity Heatmaps, Iceberg detectors) are NOT here — they need Level 2
 * order-book depth or bid/ask-tagged tick data, which no free data source
 * provides (researched: Databento is the realistic paid option, ~$179/mo+).
 * See the Phase 5 plan notes.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * multiplier + prev;
    out[i] = prev;
  }
  return out;
}

function wma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const weightSum = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let acc = 0;
    for (let w = 0; w < period; w++) acc += values[i - period + 1 + w] * (w + 1);
    out[i] = acc / weightSum;
  }
  return out;
}

function stdDevWindow(values: number[], means: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = means[i];
    if (m === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - m) ** 2;
    out[i] = Math.sqrt(sumSq / period);
  }
  return out;
}

function rollingHigh(candles: MarketCandle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) max = Math.max(max, candles[j].high);
    out[i] = max;
  }
  return out;
}

function rollingLow(candles: MarketCandle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) min = Math.min(min, candles[j].low);
    out[i] = min;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export function hma(values: number[], period: number): (number | null)[] {
  const half = Math.max(1, Math.floor(period / 2));
  const wmaHalf = wma(values, half);
  const wmaFull = wma(values, period);
  const diff = values.map((_, i) => {
    const a = wmaHalf[i];
    const b = wmaFull[i];
    return a !== null && b !== null ? 2 * a - b : NaN;
  });
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const result = wma(diff, sqrtPeriod);
  // wma() on a run containing leading NaNs produces NaN outputs until the
  // window is entirely past those NaNs — normalize those to null.
  return result.map((v) => (v !== null && Number.isFinite(v) ? v : null));
}

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = sma(closes, period);
  const dev = stdDevWindow(closes, middle, period);
  const upper = middle.map((m, i) => (m !== null && dev[i] !== null ? m + stdDevMult * (dev[i] as number) : null));
  const lower = middle.map((m, i) => (m !== null && dev[i] !== null ? m - stdDevMult * (dev[i] as number) : null));
  return { upper, middle, lower };
}

export function atr(candles: MarketCandle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  if (candles.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function keltnerChannels(
  candles: MarketCandle[],
  emaPeriod = 20,
  atrPeriod = 10,
  mult = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = ema(
    candles.map((c) => c.close),
    emaPeriod
  );
  const atrVals = atr(candles, atrPeriod);
  const upper = middle.map((m, i) => (m !== null && atrVals[i] !== null ? m + mult * (atrVals[i] as number) : null));
  const lower = middle.map((m, i) => (m !== null && atrVals[i] !== null ? m - mult * (atrVals[i] as number) : null));
  return { upper, middle, lower };
}

/** Standard Wilder Parabolic SAR — rendered as dots (pointMarkersVisible), not a connected line. */
export function parabolicSar(candles: MarketCandle[], step = 0.02, max = 0.2): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < 2) return out;

  let isUpTrend = candles[1].close >= candles[0].close;
  let sarVal = isUpTrend ? candles[0].low : candles[0].high;
  let ep = isUpTrend ? candles[0].high : candles[0].low;
  let af = step;

  for (let i = 1; i < candles.length; i++) {
    let next = sarVal + af * (ep - sarVal);

    if (isUpTrend) {
      const prevLow1 = candles[i - 1].low;
      const prevLow2 = i >= 2 ? candles[i - 2].low : prevLow1;
      next = Math.min(next, prevLow1, prevLow2);
      if (candles[i].low < next) {
        isUpTrend = false;
        next = ep;
        ep = candles[i].low;
        af = step;
      } else if (candles[i].high > ep) {
        ep = candles[i].high;
        af = Math.min(af + step, max);
      }
    } else {
      const prevHigh1 = candles[i - 1].high;
      const prevHigh2 = i >= 2 ? candles[i - 2].high : prevHigh1;
      next = Math.max(next, prevHigh1, prevHigh2);
      if (candles[i].high > next) {
        isUpTrend = true;
        next = ep;
        ep = candles[i].high;
        af = step;
      } else if (candles[i].low < ep) {
        ep = candles[i].low;
        af = Math.min(af + step, max);
      }
    }

    sarVal = next;
    out[i] = sarVal;
  }
  return out;
}

/**
 * Tenkan/Kijun/Span A/Span B/Chikou. Simplification flagged in the Phase 5
 * plan: Span A/B are the "leading span" values at their calculation index,
 * not forward-displaced onto future dates (would need synthetic whitespace
 * time points beyond the fetched candle range). Chikou IS properly
 * backward-displaced since that only requires shifting within the existing
 * array bounds.
 */
export function ichimoku(
  candles: MarketCandle[],
  conversionPeriod = 9,
  basePeriod = 26,
  spanBPeriod = 52,
  displacement = 26
): {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  spanA: (number | null)[];
  spanB: (number | null)[];
  chikou: (number | null)[];
} {
  const highConv = rollingHigh(candles, conversionPeriod);
  const lowConv = rollingLow(candles, conversionPeriod);
  const tenkan = highConv.map((h, i) => (h !== null && lowConv[i] !== null ? (h + (lowConv[i] as number)) / 2 : null));

  const highBase = rollingHigh(candles, basePeriod);
  const lowBase = rollingLow(candles, basePeriod);
  const kijun = highBase.map((h, i) => (h !== null && lowBase[i] !== null ? (h + (lowBase[i] as number)) / 2 : null));

  const spanA = tenkan.map((t, i) => (t !== null && kijun[i] !== null ? (t + (kijun[i] as number)) / 2 : null));

  const highSpanB = rollingHigh(candles, spanBPeriod);
  const lowSpanB = rollingLow(candles, spanBPeriod);
  const spanB = highSpanB.map((h, i) => (h !== null && lowSpanB[i] !== null ? (h + (lowSpanB[i] as number)) / 2 : null));

  const chikou: (number | null)[] = candles.map((_, i) =>
    i + displacement < candles.length ? candles[i + displacement].close : null
  );

  return { tenkan, kijun, spanA, spanB, chikou };
}

function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Session-anchored (resets each UTC calendar day) VWAP with std-dev bands. */
export function vwapWithBands(
  candles: MarketCandle[],
  stdDevMult = 2
): { vwap: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const vwap: (number | null)[] = new Array(candles.length).fill(null);
  const upper: (number | null)[] = new Array(candles.length).fill(null);
  const lower: (number | null)[] = new Array(candles.length).fill(null);

  let cumPV = 0;
  let cumPV2 = 0;
  let cumVol = 0;
  let currentDay: string | null = null;

  for (let i = 0; i < candles.length; i++) {
    const day = utcDateKey(candles[i].datetime);
    if (day !== currentDay) {
      currentDay = day;
      cumPV = 0;
      cumPV2 = 0;
      cumVol = 0;
    }
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumPV2 += typicalPrice * typicalPrice * c.volume;
    cumVol += c.volume;

    if (cumVol > 0) {
      const v = cumPV / cumVol;
      const variance = Math.max(cumPV2 / cumVol - v * v, 0);
      const dev = Math.sqrt(variance);
      vwap[i] = v;
      upper[i] = v + stdDevMult * dev;
      lower[i] = v - stdDevMult * dev;
    }
  }

  return { vwap, upper, lower };
}

export interface VolumeProfileBin {
  priceLow: number;
  priceHigh: number;
  volume: number;
}

export interface VolumeProfileResult {
  poc: number | null;
  vah: number | null;
  val: number | null;
  bins: VolumeProfileBin[];
}

/**
 * Approximated from OHLCV bars, not true tick-level volume-at-price: each
 * candle's volume is distributed across the price bins its [low, high]
 * range overlaps, proportional to overlap width. Value area uses a
 * simplified "highest-volume bins until ~70% of total volume" selection,
 * not the contiguous expansion-from-POC method some professional platforms
 * use. Flagged in the Phase 5 plan as a deliberate simplification.
 */
export function volumeProfile(candles: MarketCandle[], numBins = 24): VolumeProfileResult {
  if (candles.length === 0) return { poc: null, vah: null, val: null, bins: [] };

  const minPrice = Math.min(...candles.map((c) => c.low));
  const maxPrice = Math.max(...candles.map((c) => c.high));
  if (maxPrice <= minPrice) return { poc: null, vah: null, val: null, bins: [] };

  const binSize = (maxPrice - minPrice) / numBins;
  const bins: VolumeProfileBin[] = Array.from({ length: numBins }, (_, b) => ({
    priceLow: minPrice + b * binSize,
    priceHigh: minPrice + (b + 1) * binSize,
    volume: 0,
  }));

  for (const c of candles) {
    const range = c.high - c.low;
    for (const bin of bins) {
      if (range <= 0) {
        if (c.close >= bin.priceLow && c.close < bin.priceHigh) bin.volume += c.volume;
        continue;
      }
      const overlap = Math.min(c.high, bin.priceHigh) - Math.max(c.low, bin.priceLow);
      if (overlap > 0) bin.volume += c.volume * (overlap / range);
    }
  }

  const totalVolume = bins.reduce((sum, b) => sum + b.volume, 0);
  const pocBin = bins.reduce((best, b) => (b.volume > best.volume ? b : best), bins[0]);
  const poc = (pocBin.priceLow + pocBin.priceHigh) / 2;

  const sortedByVolume = [...bins].sort((a, b) => b.volume - a.volume);
  let acc = 0;
  const valueAreaBins: VolumeProfileBin[] = [];
  for (const bin of sortedByVolume) {
    if (acc >= totalVolume * 0.7 && valueAreaBins.length > 0) break;
    valueAreaBins.push(bin);
    acc += bin.volume;
  }
  const vah = Math.max(...valueAreaBins.map((b) => b.priceHigh));
  const val = Math.min(...valueAreaBins.map((b) => b.priceLow));

  return { poc, vah, val, bins };
}

// ---------------------------------------------------------------------------
// Oscillators
// ---------------------------------------------------------------------------

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function stochastic(
  candles: MarketCandle[],
  kPeriod = 14,
  dPeriod = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const highs = rollingHigh(candles, kPeriod);
  const lows = rollingLow(candles, kPeriod);
  const k = candles.map((c, i) => {
    const h = highs[i];
    const l = lows[i];
    if (h === null || l === null || h === l) return null;
    return (100 * (c.close - l)) / (h - l);
  });
  const firstValidK = k.findIndex((v) => v !== null);
  let d: (number | null)[] = new Array(candles.length).fill(null);
  if (firstValidK !== -1) {
    const validK = k.slice(firstValidK).map((v) => v as number);
    const dOnValid = sma(validK, dPeriod);
    d = new Array(firstValidK).fill(null).concat(dOnValid);
  }
  return { k, d };
}

export function cci(candles: MarketCandle[], period = 20): (number | null)[] {
  const typicalPrices = candles.map((c) => (c.high + c.low + c.close) / 3);
  const smaTp = sma(typicalPrices, period);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const m = smaTp[i];
    if (m === null) continue;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(typicalPrices[j] - m);
    meanDev /= period;
    out[i] = meanDev === 0 ? 0 : (typicalPrices[i] - m) / (0.015 * meanDev);
  }
  return out;
}

export function roc(closes: number[], period = 12): (number | null)[] {
  return closes.map((c, i) => (i >= period && closes[i - period] !== 0 ? ((c - closes[i - period]) / closes[i - period]) * 100 : null));
}

export function williamsR(candles: MarketCandle[], period = 14): (number | null)[] {
  const highs = rollingHigh(candles, period);
  const lows = rollingLow(candles, period);
  return candles.map((c, i) => {
    const h = highs[i];
    const l = lows[i];
    if (h === null || l === null || h === l) return null;
    return (-100 * (h - c.close)) / (h - l);
  });
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((f, i) => (f !== null && emaSlow[i] !== null ? f - (emaSlow[i] as number) : null));

  const firstValid = macdLine.findIndex((v) => v !== null);
  let signal: (number | null)[] = new Array(closes.length).fill(null);
  if (firstValid !== -1) {
    const validMacd = macdLine.slice(firstValid).map((v) => v as number);
    const signalOnValid = ema(validMacd, signalPeriod);
    signal = new Array(firstValid).fill(null).concat(signalOnValid);
  }

  const histogram = macdLine.map((m, i) => (m !== null && signal[i] !== null ? m - (signal[i] as number) : null));
  return { macd: macdLine, signal, histogram };
}

export function obv(candles: MarketCandle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    if (candles[i].close > prevClose) out[i] = out[i - 1] + candles[i].volume;
    else if (candles[i].close < prevClose) out[i] = out[i - 1] - candles[i].volume;
    else out[i] = out[i - 1];
  }
  return out;
}

export function cmf(candles: MarketCandle[], period = 20): (number | null)[] {
  const mfv = candles.map((c) => {
    const range = c.high - c.low;
    const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    return mfm * c.volume;
  });
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let sumMfv = 0;
    let sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMfv += mfv[j];
      sumVol += candles[j].volume;
    }
    out[i] = sumVol === 0 ? 0 : sumMfv / sumVol;
  }
  return out;
}
