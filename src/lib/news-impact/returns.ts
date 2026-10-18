import type { PriceBar } from "./types";

/**
 * Aligned daily log returns. Pure.
 *
 * The asset and its factors are joined on date. A return is taken between consecutive SHARED dates for every series, so
 * a crypto coin traded on weekends and a US index that is not still get returns over the same horizon. That removes the
 * weekend-versus-weekday mismatch at the cost of dropping weekend days from crypto. It does not remove timing
 * differences inside a day (closing times differ), which is a stated limit.
 */

export interface AlignedReturns {
  /** The date each return ends on (one per return). */
  dates: string[];
  /** Asset log returns. */
  ret: number[];
  /** One array of log returns per factor, same length as ret. */
  factorRet: number[][];
  /** Asset volume on the return's end date. */
  volume: number[];
  /** Close on the return's end date. */
  close: number[];
}

/** Sorts by date, drops duplicates (keeps the last) and bars with a bad close. */
export function cleanBars(bars: PriceBar[]): PriceBar[] {
  const byDate = new Map<string, PriceBar>();
  for (const b of bars) {
    if (!b || typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) continue;
    if (!(typeof b.close === "number" && Number.isFinite(b.close) && b.close > 0)) continue;
    byDate.set(b.date, { date: b.date, close: b.close, volume: Number.isFinite(b.volume) && b.volume > 0 ? b.volume : 0 });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function alignReturns(asset: PriceBar[], factors: PriceBar[][]): AlignedReturns {
  const a = cleanBars(asset);
  const fs = factors.map(cleanBars);
  const fMaps = fs.map((f) => new Map(f.map((b) => [b.date, b])));
  const shared = a.filter((b) => fMaps.every((m) => m.has(b.date)));
  const out: AlignedReturns = { dates: [], ret: [], factorRet: factors.map(() => []), volume: [], close: [] };
  for (let i = 1; i < shared.length; i++) {
    const prev = shared[i - 1];
    const cur = shared[i];
    out.dates.push(cur.date);
    out.ret.push(Math.log(cur.close / prev.close));
    fMaps.forEach((m, k) => out.factorRet[k].push(Math.log(m.get(cur.date)!.close / m.get(prev.date)!.close)));
    out.volume.push(cur.volume);
    out.close.push(cur.close);
  }
  return out;
}

/** Index of the first date >= target, or -1 when every date is earlier. Dates are ascending YYYY-MM-DD strings. */
export function firstIndexOnOrAfter(dates: string[], target: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo < dates.length ? lo : -1;
}

/** Calendar days between two YYYY-MM-DD strings (b minus a). */
export function calendarDaysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
