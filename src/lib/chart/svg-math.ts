// Pure helpers shared by the hand-built SVG charts. Every function here must terminate and return finite output for
// empty, single-point, all-equal and NaN / Infinity input: a chart must never hang the tab or draw NaN coordinates.

/** Keeps finite numbers only (drops null, undefined, NaN, +-Infinity). */
export function finiteNumbers(values: readonly (number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  return out;
}

/** Round step size (1, 2 or 5 times a power of ten) for about `target` ticks over `range`. Always finite and positive. */
export function niceStep(range: number, target: number): number {
  const r = Number.isFinite(range) && range > 0 ? range : 1;
  const t = Number.isFinite(target) && target > 0 ? target : 5;
  const raw = r / t;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

/** Tick values from min to max (inclusive of nice bounds inside the range). Non-finite input gives []. Capped at 200 ticks. */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  const step = niceStep(max - min, target);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6 && out.length < 200; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Histogram {
  /** Left edge of the first bucket. */
  e0: number;
  /** Right edge of the last bucket (always greater than e0, even when every value is equal). */
  e1: number;
  /** Bucket width. */
  w: number;
  /** Trades per bucket; every count is an integer >= 0 and they sum to the number of finite inputs. */
  counts: number[];
  /** Number of finite values bucketed. */
  n: number;
}

/**
 * Buckets the finite values of `data`. Returns null with fewer than `minN` finite values. Bars built from `counts` start at
 * zero by construction (a count is never negative and the baseline is a count of 0).
 */
export function histogram(data: readonly number[], minN = 5): Histogram | null {
  const xs = finiteNumbers(data);
  if (xs.length < minN || xs.length === 0) return null;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of xs) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const k = Math.max(6, Math.min(14, Math.round(Math.sqrt(xs.length))));
  const w = niceStep(mx - mn, k);
  const e0 = Math.floor(mn / w) * w;
  // When every value is equal the range has zero width: keep at least one bucket so no x position is NaN.
  const e1 = Math.max(Math.ceil(mx / w) * w, e0 + w);
  const nb = Math.max(1, Math.round((e1 - e0) / w));
  const counts = new Array<number>(nb).fill(0);
  for (const v of xs) counts[Math.max(0, Math.min(nb - 1, Math.floor((v - e0) / w + 1e-9)))]++;
  return { e0, e1, w, counts, n: xs.length };
}

/** "+1.2%" style with a sign. Null, undefined and non-finite give "N/A". */
export function fmtPct(v: number | null | undefined, d = 2): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}%` : "N/A";
}

/**
 * Like fmtPct but never wider than about 8 characters: 12345 becomes "+12.3k%", 2500000 "+2.5M%". For labels inside a
 * fixed-width margin, where a long number would be clipped by the SVG viewport.
 */
export function fmtPctCompact(v: number | null | undefined, d = 2): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const a = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M%`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}k%`;
  return `${sign}${a.toFixed(d)}%`;
}

/** "$1.5B", "$250M", "$40K", "$900", "-$3.2B". Money axis and end labels: small amounts keep their size instead of rounding to "$0M". */
export function fmtMoneyCompact(v: number): string {
  if (!Number.isFinite(v)) return "N/A";
  const a = Math.abs(v);
  const s =
    a >= 1e12 ? `${(a / 1e12).toFixed(1)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, "")}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K` : `${Math.round(a)}`;
  return `${v < 0 ? "-" : ""}$${s}`;
}

/** Bar length as a percent of the track: zero stays zero (never a sliver), non-finite or negative is zero, the largest value fills the track. */
export function barPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(100, (value / max) * 100);
}

/** Maps a value to a y pixel on a zero-based vertical scale: value 0 sits at `bottom`, `max` at `top`. */
export function zeroBasedY(value: number, max: number, top: number, bottom: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return bottom;
  return bottom - (Math.max(0, value) / max) * (bottom - top);
}
