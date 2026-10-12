import type { ShareCountPoint, TtmSnapshot } from "@/lib/data/sec-financials";

/**
 * A company's valuation multiples over time: each past price paired with the
 * trailing earnings, sales, gross profit and free cash flow the market had
 * actually been shown by that date. Pure, so every row can be checked by hand.
 */

export interface PricePoint {
  /** The date the price is for, YYYY-MM-DD. */
  date: string;
  price: number;
}

export interface MultiplePoint {
  date: string;
  price: number;
  /** The quarter the trailing figures run to. */
  basedOnQuarter: string;
  marketCap: number | null;
  priceToSales: number | null;
  priceToGrossProfit: number | null;
  priceToEarnings: number | null;
  priceToFcf: number | null;
}

export type MultipleKey = "priceToSales" | "priceToGrossProfit" | "priceToEarnings" | "priceToFcf";

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const per = (cap: number, denom: number | null) => (finite(denom) && denom > 0 ? cap / denom : null);

/** The last item whose date is on or before `date`. */
function asOf<T>(items: T[], date: string, key: (t: T) => string): T | null {
  let best: T | null = null;
  for (const it of items) if (key(it) <= date && (best === null || key(it) >= key(best))) best = it;
  return best;
}

export function multipleHistory(snapshots: TtmSnapshot[], shares: ShareCountPoint[], prices: PricePoint[]): MultiplePoint[] {
  const out: MultiplePoint[] = [];
  for (const p of prices) {
    const snap = asOf(snapshots, p.date, (s) => s.firstFiled);
    const sh = asOf(shares, p.date, (s) => s.filed);
    if (!snap || !sh) continue;
    const cap = p.price * sh.value;
    const t = snap.ttm;
    const fcf = finite(t.operatingCashFlow) ? t.operatingCashFlow - (finite(t.capex) ? t.capex : 0) : null;
    out.push({
      date: p.date, price: p.price, basedOnQuarter: snap.periodEnd, marketCap: cap,
      priceToSales: per(cap, t.revenue), priceToGrossProfit: per(cap, t.grossProfit), priceToEarnings: per(cap, t.netIncome), priceToFcf: per(cap, fcf),
    });
  }
  return out;
}

export interface HistorySummary {
  key: MultipleKey;
  points: number;
  average: number | null;
  low: number | null;
  high: number | null;
  /** Share of past points at or below the current multiple, 0 to 100. */
  currentPercentile: number | null;
}

/** Average, range and where the current multiple ranks among the past points. */
export function summarize(history: MultiplePoint[], key: MultipleKey, current: number | null): HistorySummary {
  const vals = history.map((h) => h[key]).filter((v): v is number => finite(v));
  if (vals.length === 0) return { key, points: 0, average: null, low: null, high: null, currentPercentile: null };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    key, points: vals.length, average: avg, low: Math.min(...vals), high: Math.max(...vals),
    currentPercentile: finite(current) ? (vals.filter((v) => v <= current).length / vals.length) * 100 : null,
  };
}
