import type { MarketCandle } from "../../../data/market-data-types";
import { toEasternParts, toUtcParts, WINDOWS, isWithin } from "./time-windows";

/**
 * Anchored volume profile from INTRADAY bars (the daily-bar version lives in volume-profile.ts).
 *
 * What it is: the traded volume of a chosen stretch of bars, laid out by price. The point of control (POC) is the busiest
 * price bin, the value area (VAL..VAH) is the band around it holding 70% of the volume, and high/low volume nodes (HVN/LVN)
 * are the peaks and troughs of the (lightly smoothed) histogram.
 *
 * Every approximation, so none is hidden:
 *  1. Volume allocation. A bar does not say where inside its low..high range its volume traded. By default each bar's volume
 *     is spread EVENLY across its low..high range (the same approximation volume-profile.ts already makes). Optionally
 *     "close-weighted": `closeWeight` (default 0.5) of the bar's volume goes to the bin holding the close and the rest is spread
 *     evenly. Neither is the true tick-by-tick distribution; a 5-minute bar spread across a few bins is a smeared version of it.
 *  2. Bins. Bin width = max(tick, range / binCount), rounded UP to a whole number of ticks. Bin edges sit on multiples of the
 *     width, so the same width gives the same grid on any day. Default binCount is 60, tick is 0.01 (0.0001 below $1).
 *  3. Value area. Standard Market Profile expansion: start at the POC bin; repeatedly compare the volume of the next TWO bins above
 *     with the next TWO below (one bin if only one is left on that side) and add the larger pair (ties go up); stop once the
 *     accumulated volume is at least 70% of the total. So coverage is >= 70%, the area is contiguous, and VAL / VAH are the lower
 *     edge of the lowest bin and the upper edge of the highest bin in it. The expansion uses the raw (unsmoothed) bins.
 *  4. Nodes. The raw histogram is smoothed with a Gaussian kernel (sigma 1 bin, truncated at 3 sigma, edge weights renormalised).
 *     Local maxima of the smoothed curve are candidate peaks (a flat top counts once, at its centre; the two end bins are never
 *     peaks, since nothing trades beyond the range). A peak is kept only if its topographic PROMINENCE (height above the higher of
 *     the two lowest points reached before meeting a taller peak or the edge) is at least `prominenceFraction` (default 15%) of the
 *     smoothed profile's maximum. Kept peaks are "peaks"; the peak whose basin holds the raw POC bin is the POC node and is left
 *     out of `hvns` (reported as `poc` instead). An LVN is the lowest point between each pair of neighbouring kept peaks, kept only
 *     if it sits at least the same fraction below the lower of the two. Band widths for shading are half-prominence widths.
 *  Deterministic: no randomness anywhere. Nothing here predicts anything; the module only describes where volume traded.
 */

export type VolumeAllocation = "uniform" | "close-weighted";
export type SessionCalendar = "et" | "utc";

export interface ProfileOptions {
  /** Target number of bins across the range. Default 60. */
  binCount?: number;
  /** Minimum price increment. Default 0.01 (0.0001 when the low is under 1). */
  tick?: number;
  /** Force an exact bin width (overrides binCount and tick rounding). */
  binWidth?: number;
  volumeAllocation?: VolumeAllocation;
  /** Share of a bar's volume placed on its close bin under "close-weighted". Default 0.5. */
  closeWeight?: number;
  /** Share of total volume the value area must cover. Default 0.7. */
  valueAreaFraction?: number;
  /** Gaussian smoothing sigma in bins. Default 1. 0 turns smoothing off. */
  smoothingSigmaBins?: number;
  /** Minimum peak prominence as a fraction of the smoothed maximum. Default 0.15. */
  prominenceFraction?: number;
}

export interface ProfileBin {
  priceLow: number;
  priceHigh: number;
  price: number; // midpoint
  volume: number;
}

export interface ProfileNode {
  price: number; // midpoint of the peak or trough bin
  binIndex: number;
  volume: number; // raw volume of that bin
  smoothedVolume: number;
  /** Peaks: prominence of the smoothed peak. Troughs: depth below the lower neighbouring peak. Same units as volume. */
  prominence: number;
  /** prominence / smoothed maximum */
  prominenceFraction: number;
  /** Half-prominence band for shading. */
  bandLow: number;
  bandHigh: number;
}

export interface ValueArea {
  val: number;
  vah: number;
  lowBinIndex: number;
  highBinIndex: number;
  volume: number;
  /** volume / totalVolume, always >= the requested fraction when reachable */
  coverage: number;
}

export interface VolumeProfileResult {
  bins: ProfileBin[];
  totalVolume: number;
  low: number | null;
  high: number | null;
  binWidth: number | null;
  tick: number;
  smoothed: number[];
  poc: { price: number; binIndex: number; volume: number } | null;
  valueArea: ValueArea | null;
  /** Every prominent peak, including the one holding the POC. */
  peaks: ProfileNode[];
  /** Prominent peaks other than the POC node. */
  hvns: ProfileNode[];
  lvns: ProfileNode[];
  barCount: number;
  params: Required<Pick<ProfileOptions, "binCount" | "volumeAllocation" | "closeWeight" | "valueAreaFraction" | "smoothingSigmaBins" | "prominenceFraction">>;
  approximations: string[];
}

export const DEFAULT_PROFILE_OPTIONS = {
  binCount: 60,
  volumeAllocation: "uniform" as VolumeAllocation,
  closeWeight: 0.5,
  valueAreaFraction: 0.7,
  smoothingSigmaBins: 1,
  prominenceFraction: 0.15,
};

const EPS = 1e-9;

function defaultTick(low: number): number {
  return low < 1 ? 0.0001 : 0.01;
}

function cleanNumber(x: number): number {
  return Number(x.toPrecision(12));
}

function usable(c: MarketCandle): boolean {
  return (
    c != null &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    Number.isFinite(c.volume) &&
    c.volume >= 0 &&
    c.high >= c.low &&
    c.low > 0
  );
}

function gaussianSmooth(values: number[], sigma: number): number[] {
  if (sigma <= 0 || values.length < 3) return values.slice();
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel: number[] = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const out: number[] = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const w = kernel[k + radius];
      acc += values[j] * w;
      wsum += w;
    }
    out[i] = acc / wsum;
  }
  return out;
}

/** Centre index of each run of equal (within tolerance) values that is strictly higher than both neighbours; end bins excluded. */
function findLocalMaxima(s: number[], tol: number): number[] {
  const peaks: number[] = [];
  let a = 0;
  while (a < s.length) {
    let b = a;
    while (b + 1 < s.length && Math.abs(s[b + 1] - s[a]) <= tol) b++;
    if (a > 0 && b < s.length - 1 && s[a - 1] < s[a] - tol && s[b + 1] < s[a] - tol) peaks.push(Math.floor((a + b) / 2));
    a = b + 1;
  }
  return peaks;
}

/** scipy-style topographic prominence of the peak at index i. */
function prominenceOf(s: number[], i: number): { prominence: number; leftBase: number; rightBase: number } {
  const h = s[i];
  let leftMin = h;
  for (let j = i - 1; j >= 0 && s[j] <= h; j--) leftMin = Math.min(leftMin, s[j]);
  let rightMin = h;
  for (let j = i + 1; j < s.length && s[j] <= h; j++) rightMin = Math.min(rightMin, s[j]);
  return { prominence: h - Math.max(leftMin, rightMin), leftBase: leftMin, rightBase: rightMin };
}

function emptyProfile(tick: number, params: VolumeProfileResult["params"], barCount: number): VolumeProfileResult {
  return {
    bins: [],
    totalVolume: 0,
    low: null,
    high: null,
    binWidth: null,
    tick,
    smoothed: [],
    poc: null,
    valueArea: null,
    peaks: [],
    hvns: [],
    lvns: [],
    barCount,
    params,
    approximations: [],
  };
}

export function buildProfile(candles: MarketCandle[], opts: ProfileOptions = {}): VolumeProfileResult {
  const params = {
    binCount: Math.max(1, Math.floor(opts.binCount ?? DEFAULT_PROFILE_OPTIONS.binCount)),
    volumeAllocation: opts.volumeAllocation ?? DEFAULT_PROFILE_OPTIONS.volumeAllocation,
    closeWeight: Math.min(1, Math.max(0, opts.closeWeight ?? DEFAULT_PROFILE_OPTIONS.closeWeight)),
    valueAreaFraction: Math.min(1, Math.max(0.01, opts.valueAreaFraction ?? DEFAULT_PROFILE_OPTIONS.valueAreaFraction)),
    smoothingSigmaBins: Math.max(0, opts.smoothingSigmaBins ?? DEFAULT_PROFILE_OPTIONS.smoothingSigmaBins),
    prominenceFraction: Math.min(1, Math.max(0, opts.prominenceFraction ?? DEFAULT_PROFILE_OPTIONS.prominenceFraction)),
  };
  const good = (candles ?? []).filter(usable);
  if (good.length === 0) return emptyProfile(opts.tick ?? 0.01, params, 0);

  const low = Math.min(...good.map((c) => c.low));
  const high = Math.max(...good.map((c) => c.high));
  const tick = opts.tick && opts.tick > 0 ? opts.tick : defaultTick(low);

  let width: number;
  if (opts.binWidth && opts.binWidth > 0) {
    width = opts.binWidth;
  } else {
    const raw = (high - low) / params.binCount;
    width = cleanNumber(Math.max(1, Math.ceil(raw / tick - EPS)) * tick);
  }
  const start = cleanNumber(Math.floor(low / width + EPS) * width);
  const nBins = Math.max(1, Math.ceil((high - start) / width - EPS));
  const volumes: number[] = new Array(nBins).fill(0);
  const edge = (i: number) => start + i * width;
  const clampIdx = (x: number) => Math.min(nBins - 1, Math.max(0, Math.floor((x - start) / width + EPS)));

  let totalVolume = 0;
  for (const c of good) {
    if (c.volume === 0) continue;
    totalVolume += c.volume;
    let spread = c.volume;
    if (params.volumeAllocation === "close-weighted" && params.closeWeight > 0) {
      const toClose = c.volume * params.closeWeight;
      volumes[clampIdx(c.close)] += toClose;
      spread = c.volume - toClose;
    }
    const range = c.high - c.low;
    if (range <= EPS * Math.max(1, c.high)) {
      volumes[clampIdx(c.close)] += spread;
      continue;
    }
    const first = clampIdx(c.low);
    const last = Math.max(first, Math.min(nBins - 1, Math.floor((c.high - start) / width - EPS)));
    const overlaps: number[] = [];
    let overlapSum = 0;
    for (let i = first; i <= last; i++) {
      const o = Math.max(0, Math.min(c.high, edge(i + 1)) - Math.max(c.low, edge(i)));
      overlaps.push(o);
      overlapSum += o;
    }
    if (overlapSum <= 0) {
      volumes[clampIdx(c.close)] += spread;
      continue;
    }
    for (let i = first; i <= last; i++) volumes[i] += (spread * overlaps[i - first]) / overlapSum;
  }

  const bins: ProfileBin[] = volumes.map((v, i) => ({
    priceLow: cleanNumber(edge(i)),
    priceHigh: cleanNumber(edge(i + 1)),
    price: cleanNumber(edge(i) + width / 2),
    volume: v,
  }));

  const approximations = [
    params.volumeAllocation === "uniform"
      ? "Each bar's volume is spread evenly across its low-to-high range; the true distribution inside a bar is unknown."
      : `Each bar's volume is split: ${Math.round(params.closeWeight * 100)}% on the bin holding its close, the rest spread evenly across its range.`,
    `Bins are ${width} wide (at least one tick of ${tick}); the profile is a histogram on that grid, not tick-by-tick.`,
  ];

  if (totalVolume <= 0) {
    return { ...emptyProfile(tick, params, good.length), bins, low, high, binWidth: width, smoothed: volumes.slice(), approximations };
  }

  // POC: highest raw bin; ties go to the bin nearest the middle of the range, then the lower one.
  const mid = (nBins - 1) / 2;
  let pocIdx = 0;
  for (let i = 1; i < nBins; i++) {
    if (volumes[i] > volumes[pocIdx] + EPS * totalVolume || (Math.abs(volumes[i] - volumes[pocIdx]) <= EPS * totalVolume && Math.abs(i - mid) < Math.abs(pocIdx - mid))) pocIdx = i;
  }

  // Value area.
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = volumes[pocIdx];
  const target = params.valueAreaFraction * totalVolume;
  while (acc < target - EPS * totalVolume && (lo > 0 || hi < nBins - 1)) {
    const canUp = hi < nBins - 1;
    const canDown = lo > 0;
    const up = (canUp ? volumes[hi + 1] : 0) + (hi + 2 < nBins ? volumes[hi + 2] : 0);
    const down = (canDown ? volumes[lo - 1] : 0) + (lo - 2 >= 0 ? volumes[lo - 2] : 0);
    if (canUp && (!canDown || up >= down)) {
      acc += up;
      hi = Math.min(nBins - 1, hi + 2);
    } else {
      acc += down;
      lo = Math.max(0, lo - 2);
    }
  }
  const valueArea: ValueArea = {
    val: bins[lo].priceLow,
    vah: bins[hi].priceHigh,
    lowBinIndex: lo,
    highBinIndex: hi,
    volume: acc,
    coverage: acc / totalVolume,
  };

  // Nodes on the smoothed curve.
  const smoothed = gaussianSmooth(volumes, params.smoothingSigmaBins);
  const smoothMax = Math.max(...smoothed);
  const tol = EPS * smoothMax;
  const minProm = params.prominenceFraction * smoothMax;
  const keptIdx = findLocalMaxima(smoothed, tol)
    .map((i) => ({ i, ...prominenceOf(smoothed, i) }))
    .filter((p) => p.prominence >= minProm - tol && p.prominence > 0);

  // Troughs between neighbouring kept peaks.
  const troughs: { idx: number; left: number; right: number; depth: number }[] = [];
  for (let k = 0; k + 1 < keptIdx.length; k++) {
    const a = keptIdx[k].i;
    const b = keptIdx[k + 1].i;
    let m = a + 1;
    for (let j = a + 1; j < b; j++) if (smoothed[j] < smoothed[m] - tol) m = j;
    let m2 = m;
    while (m2 + 1 < b && Math.abs(smoothed[m2 + 1] - smoothed[m]) <= tol) m2++;
    const idx = Math.floor((m + m2) / 2);
    const depth = Math.min(smoothed[a], smoothed[b]) - smoothed[idx];
    troughs.push({ idx, left: a, right: b, depth });
  }

  const bandAround = (i: number, level: number, kind: "peak" | "trough", bounds: [number, number]): [number, number] => {
    let l = i;
    let r = i;
    const inside = (j: number) => (kind === "peak" ? smoothed[j] >= level - tol : smoothed[j] <= level + tol);
    while (l - 1 >= bounds[0] && inside(l - 1)) l--;
    while (r + 1 <= bounds[1] && inside(r + 1)) r++;
    return [bins[l].priceLow, bins[r].priceHigh];
  };

  const validTroughs = troughs.filter((t) => t.depth >= minProm - tol && t.depth > 0);
  const peaks: ProfileNode[] = keptIdx.map((p, k) => {
    const leftBound = k === 0 ? 0 : troughs[k - 1].idx;
    const rightBound = k === keptIdx.length - 1 ? nBins - 1 : troughs[k].idx;
    const level = smoothed[p.i] - p.prominence / 2;
    const [bandLow, bandHigh] = bandAround(p.i, level, "peak", [leftBound, rightBound]);
    return {
      price: bins[p.i].price,
      binIndex: p.i,
      volume: volumes[p.i],
      smoothedVolume: smoothed[p.i],
      prominence: p.prominence,
      prominenceFraction: p.prominence / smoothMax,
      bandLow,
      bandHigh,
    };
  });

  const lvns: ProfileNode[] = validTroughs.map((t) => {
    const level = smoothed[t.idx] + t.depth / 2;
    const [bandLow, bandHigh] = bandAround(t.idx, level, "trough", [t.left, t.right]);
    return {
      price: bins[t.idx].price,
      binIndex: t.idx,
      volume: volumes[t.idx],
      smoothedVolume: smoothed[t.idx],
      prominence: t.depth,
      prominenceFraction: t.depth / smoothMax,
      bandLow,
      bandHigh,
    };
  });

  // The peak whose basin (bounded by the troughs between kept peaks) holds the raw POC bin is the POC node.
  let pocPeakIdx = -1;
  for (let k = 0; k < keptIdx.length; k++) {
    const leftBound = k === 0 ? 0 : troughs[k - 1].idx;
    const rightBound = k === keptIdx.length - 1 ? nBins - 1 : troughs[k].idx;
    if (pocIdx >= leftBound && pocIdx <= rightBound) {
      pocPeakIdx = k;
      break;
    }
  }
  const hvns = peaks.filter((_, k) => k !== pocPeakIdx);

  return {
    bins,
    totalVolume,
    low,
    high,
    binWidth: width,
    tick,
    smoothed,
    poc: { price: bins[pocIdx].price, binIndex: pocIdx, volume: volumes[pocIdx] },
    valueArea,
    peaks,
    hvns,
    lvns,
    barCount: good.length,
    params,
    approximations: [
      ...approximations,
      `Nodes come from the profile smoothed with a ${params.smoothingSigmaBins}-bin Gaussian; a peak or trough counts only if it stands ${Math.round(params.prominenceFraction * 100)}% of the tallest smoothed peak above or below its surroundings.`,
    ],
  };
}

// ------------------------------------------------------------------------------------------------ levels

export type LevelType = "POC" | "VAH" | "VAL" | "HVN" | "LVN";

export interface ProfileLevel {
  type: LevelType;
  price: number;
  /** Shaded band for HVN/LVN, or the value-area edges for POC. Null for plain lines. */
  bandLow: number | null;
  bandHigh: number | null;
}

/** Flat list of POC, VAH, VAL, HVN and LVN levels, highest price first. */
export function listLevels(profile: VolumeProfileResult): ProfileLevel[] {
  const out: ProfileLevel[] = [];
  if (profile.poc) out.push({ type: "POC", price: profile.poc.price, bandLow: null, bandHigh: null });
  if (profile.valueArea) {
    out.push({ type: "VAH", price: profile.valueArea.vah, bandLow: null, bandHigh: null });
    out.push({ type: "VAL", price: profile.valueArea.val, bandLow: null, bandHigh: null });
  }
  for (const n of profile.hvns) out.push({ type: "HVN", price: n.price, bandLow: n.bandLow, bandHigh: n.bandHigh });
  for (const n of profile.lvns) out.push({ type: "LVN", price: n.price, bandLow: n.bandLow, bandHigh: n.bandHigh });
  return out.sort((a, b) => b.price - a.price);
}

// ------------------------------------------------------------------------------------------------ anchoring

const CRYPTO_ID = /^[A-Z0-9]{2,10}-USD$/;

/** Same test as coinbase.ts isCryptoSymbol, kept here so this module stays free of runtime imports (a test checks they agree). */
export function calendarForSymbol(symbol: string): SessionCalendar {
  return CRYPTO_ID.test(symbol.trim().toUpperCase()) ? "utc" : "et";
}

export type AnchorSpec =
  | { kind: "session"; date?: string }
  | { kind: "previousSession"; date?: string }
  | { kind: "fromTimestamp"; timestampMs: number }
  | { kind: "fromDate"; date: string }
  | { kind: "multiDay"; sessions: number; date?: string };

export interface AnchorOptions {
  /** "et": regular session 9:30-16:00 Eastern, DST-safe. "utc": calendar days in UTC (crypto). Default "et". */
  calendar?: SessionCalendar;
  /** Equities only: keep premarket/after-hours bars too. Default false (regular session only). */
  includeExtendedHours?: boolean;
}

export interface AnchorInfo {
  kind: AnchorSpec["kind"];
  label: string;
  calendar: SessionCalendar;
  /** Session dates (ET dates, or UTC dates for crypto) the profile covers, oldest first. */
  sessions: string[];
  startMs: number | null;
  endMs: number | null;
}

export interface AnchoredSelection {
  candles: MarketCandle[];
  anchor: AnchorInfo;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(s: string): boolean {
  return DATE_KEY.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

function dayOf(c: MarketCandle, calendar: SessionCalendar, includeExtended: boolean): string | null {
  if (calendar === "utc") return toUtcParts(c.datetime).dateKey;
  const p = toEasternParts(c.datetime);
  if (!includeExtended && !isWithin(p.minutesSinceMidnight, WINDOWS.REGULAR_SESSION)) return null;
  return p.dateKey;
}

/** Groups bars by session date (regular hours only for ET unless asked otherwise). Bars are sorted by time first. */
export function groupBySession(candles: MarketCandle[], opts: AnchorOptions = {}): Map<string, MarketCandle[]> {
  const calendar = opts.calendar ?? "et";
  const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
  const out = new Map<string, MarketCandle[]>();
  for (const c of sorted) {
    const d = dayOf(c, calendar, opts.includeExtendedHours ?? false);
    if (d === null) continue;
    const arr = out.get(d);
    if (arr) arr.push(c);
    else out.set(d, [c]);
  }
  return out;
}

function info(kind: AnchorSpec["kind"], label: string, calendar: SessionCalendar, dates: string[], bars: MarketCandle[]): AnchorInfo {
  return {
    kind,
    label,
    calendar,
    sessions: dates,
    startMs: bars.length ? bars[0].datetime : null,
    endMs: bars.length ? bars[bars.length - 1].datetime : null,
  };
}

/**
 * Picks the bars an anchor refers to. With no explicit date, "latest" means the newest session present in the data,
 * so "session" is today's session while it is running and the last completed one afterwards.
 */
export function selectAnchoredCandles(candles: MarketCandle[], anchor: AnchorSpec, opts: AnchorOptions = {}): AnchoredSelection {
  const calendar = opts.calendar ?? "et";
  const unit = calendar === "utc" ? "UTC day" : "session";
  const sessions = groupBySession(candles, opts);
  const dates = [...sessions.keys()].sort();
  const flat = (ds: string[]) => ds.flatMap((d) => sessions.get(d) ?? []);
  const none = (kind: AnchorSpec["kind"], label: string): AnchoredSelection => ({ candles: [], anchor: info(kind, label, calendar, [], []) });

  switch (anchor.kind) {
    case "session": {
      const d = anchor.date ?? dates[dates.length - 1];
      if (!d || !sessions.has(d)) return none("session", `No ${unit} data for ${d ?? "the requested date"}`);
      const bars = sessions.get(d) as MarketCandle[];
      return { candles: bars, anchor: info("session", `${unit === "session" ? "Session" : "UTC day"} ${d}`, calendar, [d], bars) };
    }
    case "previousSession": {
      const ref = anchor.date ?? dates[dates.length - 1];
      if (!ref) return none("previousSession", `No ${unit} data`);
      const prev = [...dates].reverse().find((d) => d < ref);
      if (!prev) return none("previousSession", `No ${unit} before ${ref}`);
      const bars = sessions.get(prev) as MarketCandle[];
      return { candles: bars, anchor: info("previousSession", `Previous ${unit}: ${prev}`, calendar, [prev], bars) };
    }
    case "fromTimestamp": {
      const bars: MarketCandle[] = [];
      const ds = new Set<string>();
      for (const d of dates) {
        for (const c of sessions.get(d) as MarketCandle[]) {
          if (c.datetime >= anchor.timestampMs) {
            bars.push(c);
            ds.add(d);
          }
        }
      }
      if (bars.length === 0) return none("fromTimestamp", "No bars at or after that time");
      return { candles: bars, anchor: info("fromTimestamp", `From ${new Date(anchor.timestampMs).toISOString()} to the latest bar`, calendar, [...ds].sort(), bars) };
    }
    case "fromDate": {
      const ds = dates.filter((d) => d >= anchor.date);
      if (ds.length === 0) return none("fromDate", `No ${unit} on or after ${anchor.date}`);
      const bars = flat(ds);
      return { candles: bars, anchor: info("fromDate", `From the open of ${ds[0]}${ds[0] !== anchor.date ? ` (first ${unit} on or after ${anchor.date})` : ""}`, calendar, ds, bars) };
    }
    case "multiDay": {
      const n = Math.max(1, Math.floor(anchor.sessions));
      const upTo = anchor.date ? dates.filter((d) => d <= (anchor.date as string)) : dates;
      const ds = upTo.slice(-n);
      if (ds.length === 0) return none("multiDay", `No ${unit}s`);
      const bars = flat(ds);
      return { candles: bars, anchor: info("multiDay", `Last ${ds.length} ${unit}${ds.length === 1 ? "" : "s"}: ${ds[0]} to ${ds[ds.length - 1]}`, calendar, ds, bars) };
    }
  }
}

export interface AnchoredProfileResult extends VolumeProfileResult {
  anchor: AnchorInfo;
  candles: MarketCandle[];
}

/** Select the anchored bars, then build the profile from them only. */
export function buildAnchoredProfile(candles: MarketCandle[], anchor: AnchorSpec, opts: ProfileOptions & AnchorOptions = {}): AnchoredProfileResult {
  const sel = selectAnchoredCandles(candles, anchor, opts);
  return { ...buildProfile(sel.candles, opts), anchor: sel.anchor, candles: sel.candles };
}
