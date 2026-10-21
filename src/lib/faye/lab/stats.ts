/** Small pure helpers for the Test console chart and table. */
import type { EvalRun } from "./types";

/** Wilson score interval for a pass rate (95%). With few questions the range is wide, and the chart says so. */
export function wilson(passed: number, total: number, z = 1.96): { rate: number; low: number; high: number } {
  if (!Number.isFinite(passed) || !Number.isFinite(total) || total <= 0) return { rate: 0, low: 0, high: 0 };
  const p = Math.min(1, Math.max(0, passed / total));
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface SeriesPoint {
  id: string;
  at: string | null;
  passed: number;
  total: number;
  rate: number;
  low: number;
  high: number;
}

/** The last `limit` runs of one suite, oldest first, with their intervals. Runs with no questions are skipped. */
export function seriesFor(runs: readonly EvalRun[], suite: string, limit = 10): SeriesPoint[] {
  return runs
    .filter((r) => r.suite === suite && r.total > 0)
    .slice()
    .sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0))
    .slice(0, limit)
    .reverse()
    .map((r) => {
      const w = wilson(r.passed, r.total);
      return { id: r.id, at: r.finishedAt ?? r.createdAt, passed: r.passed, total: r.total, rate: w.rate, low: w.low, high: w.high };
    });
}

export function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 20" in UTC (the same text on the server and in the browser). */
export function shortDate(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "14:01" in UTC. */
export function shortTime(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
