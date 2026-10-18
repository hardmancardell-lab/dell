import { mulberry32, seedFromValues } from "@/lib/agents/trading-agent/skills/stats-tests";
import { correlation } from "@/lib/agents/trading-agent/stats";
import type { NewsItem } from "@/lib/news/news-core";

/**
 * Forward headline-count logger: pure helpers. No network, no database, no env.
 *
 * Why it exists: there is no archive of headlines, so "does a busier news day come with a bigger move" cannot be tested
 * on the past. This counts headlines per symbol per Eastern publication date from today on, so the question can be
 * answered properly after a few months. Only counts, outlet names and short hashes are stored; no headline text and no
 * link, so the log is not a copy of anyone's articles.
 */

/** Yahoo's per-symbol feed returns about this many items; when a run hits it, the oldest day in it may be cut short. */
export const YAHOO_FEED_CAP = 20;

/** Symbols the logger counts every day. Same idea as OPTION_FLOW_SYMBOLS: one constant, edit it here. */
export const HEADLINE_LOG_SYMBOLS: { symbol: string; assetClass: "equity" | "crypto" | "forex" | "future" | "commodity" }[] = [
  { symbol: "SPY", assetClass: "equity" },
  { symbol: "QQQ", assetClass: "equity" },
  { symbol: "NVDA", assetClass: "equity" },
  { symbol: "DELL", assetClass: "equity" },
  { symbol: "GLD", assetClass: "equity" },
  { symbol: "AAPL", assetClass: "equity" },
  { symbol: "BTC-USD", assetClass: "crypto" },
];

/** One kept headline: `${kind}${opinion}|${source}` with kind n (news) or f (filing) and opinion o or - . */
export type SeenMap = Record<string, string>;

export interface DayCounts {
  /** Eastern calendar date the headlines were published on (YYYY-MM-DD). */
  countDate: string;
  seen: SeenMap;
  feedCapped: boolean;
  headlineCount: number;
  filingCount: number;
  opinionCount: number;
  sourceCounts: Record<string, number>;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** Normalized title -> 12 hex characters (two FNV-1a passes). Case, punctuation and spacing do not change it. */
export function headlineHash(title: string): string {
  const norm = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let h1 = 2166136261 >>> 0;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  h2 >>>= 0;
  for (let i = 0; i < norm.length; i++) {
    const c = norm.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0").slice(0, 4);
}

function etDate(iso: string, dateOnly: boolean): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return dateOnly ? new Date(ms).toISOString().slice(0, 10) : ET_DATE.format(new Date(ms));
}

/** Derived counts from a seen map. */
export function recount(seen: SeenMap): Pick<DayCounts, "headlineCount" | "filingCount" | "opinionCount" | "sourceCounts"> {
  let headlineCount = 0;
  let filingCount = 0;
  let opinionCount = 0;
  const sourceCounts: Record<string, number> = {};
  for (const v of Object.values(seen)) {
    const kind = v[0];
    const opinion = v[1] === "o";
    const source = v.slice(3) || "unknown";
    if (kind === "f") {
      filingCount++;
      continue;
    }
    headlineCount++;
    if (opinion) opinionCount++;
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }
  return { headlineCount, filingCount, opinionCount, sourceCounts };
}

/**
 * Groups one fetch of a symbol's items into per-day counts. Items without a usable time are skipped (they cannot be
 * placed on a day). The same story from several outlets counts once (same normalized title).
 */
export function dailyHeadlineStats(items: NewsItem[], feedCap: number = YAHOO_FEED_CAP): DayCounts[] {
  const byDay = new Map<string, SeenMap>();
  for (const it of items) {
    if (!it.publishedAt) continue;
    const day = etDate(it.publishedAt, it.timeKind === "date");
    if (!day) continue;
    const key = it.kind === "filing" ? `f:${headlineHash(`${it.title} ${it.url}`)}` : headlineHash(it.title);
    const seen = byDay.get(day) ?? {};
    if (!(key in seen)) seen[key] = `${it.kind === "filing" ? "f" : "n"}${it.opinion ? "o" : "-"}|${it.source}`;
    byDay.set(day, seen);
  }
  const yahoo = items.filter((i) => i.provider === "Yahoo Finance feed" && i.publishedAt);
  let oldestYahooDay: string | null = null;
  for (const i of yahoo) {
    const d = etDate(i.publishedAt as string, false);
    if (d && (oldestYahooDay === null || d < oldestYahooDay)) oldestYahooDay = d;
  }
  const capHit = yahoo.length >= feedCap;
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([countDate, seen]) => ({ countDate, seen, feedCapped: capHit && countDate === oldestYahooDay, ...recount(seen) }));
}

/** Adds a new capture to a stored day. Already-counted headlines are not counted again. */
export function mergeDayCounts(existing: Pick<DayCounts, "countDate" | "seen" | "feedCapped"> | null, incoming: Pick<DayCounts, "countDate" | "seen" | "feedCapped">): DayCounts {
  const seen: SeenMap = { ...incoming.seen, ...(existing?.seen ?? {}) };
  return {
    countDate: incoming.countDate,
    seen,
    feedCapped: Boolean(existing?.feedCapped) || incoming.feedCapped,
    ...recount(seen),
  };
}

// ------------------------------------------------------------------------------------------ later evaluation

export const MIN_DAYS_FOR_EVALUATION = 60;

export interface CountsVsMoves {
  status: "ok" | "not-enough";
  n: number;
  /** Spearman rank correlation between the day's headline count and the day's absolute standardized move. */
  rho: number | null;
  lo: number | null;
  hi: number | null;
}

function ranks(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

function spearman(x: number[], y: number[]): number | null {
  return correlation(ranks(x), ranks(y));
}

/**
 * The pre-registered later test: Spearman correlation of daily headline count with the day's |standardized abnormal
 * move|, with a seeded circular block bootstrap interval (block 5). One test per symbol; correct across symbols with
 * Benjamini-Hochberg when several are read together. Needs at least 60 days.
 */
export function evaluateCountsVsMoves(dates: string[], counts: (number | null)[], absSar: (number | null)[]): CountsVsMoves {
  const x: number[] = [];
  const y: number[] = [];
  const n0 = Math.min(dates.length, counts.length, absSar.length);
  for (let i = 0; i < n0; i++) {
    const c = counts[i];
    const s = absSar[i];
    if (c !== null && s !== null && Number.isFinite(c) && Number.isFinite(s)) {
      x.push(c);
      y.push(s);
    }
  }
  const n = x.length;
  if (n < MIN_DAYS_FOR_EVALUATION) return { status: "not-enough", n, rho: null, lo: null, hi: null };
  const rho = spearman(x, y);
  if (rho === null) return { status: "not-enough", n, rho: null, lo: null, hi: null };
  const rand = mulberry32(seedFromValues(y));
  const reps: number[] = [];
  for (let b = 0; b < 1000; b++) {
    const ix: number[] = [];
    const iy: number[] = [];
    while (ix.length < n) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < 5 && ix.length < n; k++) {
        ix.push(x[(start + k) % n]);
        iy.push(y[(start + k) % n]);
      }
    }
    const r = spearman(ix, iy);
    if (r !== null) reps.push(r);
  }
  reps.sort((a, b) => a - b);
  return { status: "ok", n, rho, lo: reps[Math.floor(0.025 * reps.length)], hi: reps[Math.min(reps.length - 1, Math.floor(0.975 * reps.length))] };
}
