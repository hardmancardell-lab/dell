import { benjaminiHochberg, bootstrapCi, selectNonOverlapping, tTwoSidedP } from "@/lib/agents/trading-agent/skills/stats-tests";
import { mean, median, stdDev } from "@/lib/agents/trading-agent/stats";
import { calendarDaysBetween, firstIndexOnOrAfter } from "./returns";
import type { DatedEvent, EffectWord, EventGroupResult, EventStudyResult, EventTypeDef, GroupTest } from "./types";

/**
 * Event study of dated events against ordinary days. Pure.
 *
 * Measures (all are SIZES of moves, not directions):
 *   day0    mean |SAR| on the event day, SAR = abnormal return / its prediction-error SD
 *   car     mean |CAR(0,+2)| / (sd * sqrt(3)) over the event day and the next two
 *   volume  mean ln(volume / its own recent median) on the event day
 * Event days are compared with "ordinary days": every day not within day -1 to day +2 of any event in the dated list.
 *
 * Test: Welch two-sample t with the exact Student t distribution. The ordinary-day standard error uses batch means
 * (10-day blocks) because absolute moves cluster in time. Interval: seeded bootstrap of the event days' own mean
 * (divided by the ordinary-day mean for a ratio). Correction: Benjamini-Hochberg over every test in the table.
 */

export const MIN_HEADLINE_EVENTS = 20;
export const MIN_TYPE_EVENTS = 10;
export const THIN_BELOW = 15;
export const CAR_DAYS = 3;
export const BATCH_LEN = 10;
const BOOT_REPS = 2000;

export interface StudySeries {
  dates: string[];
  ar: (number | null)[];
  sd: (number | null)[];
  sar: (number | null)[];
  volLog: (number | null)[];
}

export interface MappedEvent {
  idx: number;
  type: string;
}

/**
 * Puts each event on a trading day (the first date on or after the event's date; dropped when that is more than 7
 * calendar days later, which means the data ends before the event). One event per day: when several share a day, the
 * type listed first in typeOrder wins.
 */
export function mapEvents(dates: string[], events: DatedEvent[], typeOrder: string[], maxLagDays = 7): MappedEvent[] {
  const best = new Map<number, string>();
  for (const e of events) {
    const idx = firstIndexOnOrAfter(dates, e.date);
    if (idx < 0 || calendarDaysBetween(e.date, dates[idx]) > maxLagDays) continue;
    const prev = best.get(idx);
    const rank = (t: string) => {
      const r = typeOrder.indexOf(t);
      return r < 0 ? typeOrder.length : r;
    };
    if (prev === undefined || rank(e.type) < rank(prev)) best.set(idx, e.type);
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([idx, type]) => ({ idx, type }));
}

/** Standard error of a mean from batch means (consecutive blocks), which stays honest when values cluster in time. */
export function batchMeansSe(values: number[], blockLen = BATCH_LEN): { se: number | null; blocks: number } {
  const n = values.length;
  const blocks = Math.floor(n / blockLen);
  if (blocks < 3) {
    const sd = stdDev(values);
    return { se: sd === null || n < 2 ? null : sd / Math.sqrt(n), blocks };
  }
  const bm: number[] = [];
  for (let b = 0; b < blocks; b++) bm.push(values.slice(b * blockLen, (b + 1) * blockLen).reduce((s, v) => s + v, 0) / blockLen);
  const sd = stdDev(bm);
  return { se: sd === null ? null : sd / Math.sqrt(blocks), blocks };
}

const EMPTY: GroupTest = {
  n: 0, nBase: 0, eventMean: null, eventMedian: null, baseMean: null, baseMedian: null,
  ratio: null, ratioLo: null, ratioHi: null, diff: null, diffLo: null, diffHi: null, baseSePct: null,
  t: null, df: null, p: null, pAdj: null, thin: true, enough: false,
};

export interface CompareOptions {
  /** "abs": a size measure (ratio reported). "diff": a signed log measure (difference reported). */
  mode: "abs" | "diff";
  minN: number;
  thinBelow: number;
  skipCi?: boolean;
}

/** Event values against ordinary-day values. The ordinary values must be in time order. */
export function compareValues(eventVals: number[], baseVals: number[], o: CompareOptions): GroupTest {
  const ev = eventVals.filter((v) => Number.isFinite(v));
  const bv = baseVals.filter((v) => Number.isFinite(v));
  const n = ev.length;
  const out: GroupTest = { ...EMPTY, n, nBase: bv.length, enough: n >= o.minN, thin: n < o.thinBelow };
  if (n === 0 || bv.length === 0) return out;
  const em = mean(ev) as number;
  const bm = mean(bv) as number;
  out.eventMean = em;
  out.eventMedian = median(ev);
  out.baseMean = bm;
  out.baseMedian = median(bv);
  out.diff = em - bm;
  if (o.mode === "abs" && bm > 0) out.ratio = em / bm;

  const seE = n >= 2 && stdDev(ev) !== null ? (stdDev(ev) as number) / Math.sqrt(n) : null;
  const { se: seB, blocks } = batchMeansSe(bv);
  if (seB !== null && bm !== 0) out.baseSePct = Math.abs(seB / bm) * 100;
  if (seE !== null && seB !== null && seE > 0 && n >= 2) {
    const v = seE * seE + seB * seB;
    const t = (em - bm) / Math.sqrt(v);
    const dfB = Math.max(1, blocks >= 3 ? blocks - 1 : bv.length - 1);
    const df = (v * v) / ((seE ** 4) / (n - 1) + (seB ** 4) / dfB);
    out.t = t;
    out.df = df;
    out.p = tTwoSidedP(t, df);
  }
  if (!o.skipCi && n >= 5) {
    const ci = bootstrapCi(ev, BOOT_REPS, 0.95, { blockLength: 1 });
    if (ci.lower !== null && ci.upper !== null) {
      out.diffLo = ci.lower - bm;
      out.diffHi = ci.upper - bm;
      if (o.mode === "abs" && bm > 0) {
        out.ratioLo = ci.lower / bm;
        out.ratioHi = ci.upper / bm;
      }
    }
  }
  return out;
}

export interface StudyOptions {
  minHeadline?: number;
  minType?: number;
  thinBelow?: number;
  /** Only the pooled group (used by the placebo runs). */
  pooledOnly?: boolean;
  skipCi?: boolean;
  /** Extra day indexes whose windows are also kept out of the ordinary-day set (the placebo runs pass the real event windows). */
  extraMaskIdx?: number[];
}

interface Baselines {
  base0: number[];
  baseCar: number[];
  baseVol: number[];
  baseAbsAr: number[];
  mask: Set<number>;
}

function buildBaselines(s: StudySeries, mapped: MappedEvent[], extraMaskIdx: number[] = []): Baselines {
  const N = s.dates.length;
  const mask = new Set<number>();
  for (const e of mapped) for (let k = -1; k <= CAR_DAYS - 1; k++) mask.add(e.idx + k);
  for (const idx of extraMaskIdx) for (let k = -1; k <= CAR_DAYS - 1; k++) mask.add(idx + k);
  const base0: number[] = [];
  const baseAbsAr: number[] = [];
  const baseVol: number[] = [];
  const candCar: number[] = [];
  for (let i = 0; i < N; i++) {
    if (mask.has(i)) continue;
    const sv = s.sar[i];
    if (sv !== null) {
      base0.push(Math.abs(sv));
      baseAbsAr.push(Math.abs(s.ar[i] as number) * 100);
    }
    if (s.volLog[i] !== null) baseVol.push(s.volLog[i] as number);
    if (!mask.has(i + 1) && !mask.has(i + 2) && carValue(s, i) !== null) candCar.push(i);
  }
  const keep = selectNonOverlapping(candCar, CAR_DAYS);
  const baseCar = keep.map((k) => carValue(s, candCar[k]) as number);
  return { base0, baseCar, baseVol, baseAbsAr, mask };
}

/** |CAR(0,+2)| in prediction-error SD units, or null when any piece is missing. */
function carValue(s: StudySeries, i: number): number | null {
  if (i + CAR_DAYS - 1 >= s.dates.length) return null;
  let sum = 0;
  for (let k = 0; k < CAR_DAYS; k++) {
    const a = s.ar[i + k];
    if (a === null) return null;
    sum += a;
  }
  const sd = s.sd[i];
  if (sd === null || !(sd > 0)) return null;
  return Math.abs(sum) / (sd * Math.sqrt(CAR_DAYS));
}

function evalGroup(id: string, label: string, idxs: number[], s: StudySeries, b: Baselines, o: CompareOptions & { skipCi?: boolean }): EventGroupResult {
  const sorted = [...idxs].sort((a, c) => a - c);
  const d0 = sorted.map((i) => s.sar[i]).filter((v): v is number => v !== null).map(Math.abs);
  const thinned = selectNonOverlapping(sorted, CAR_DAYS).map((k) => sorted[k]);
  const carVals = thinned.map((i) => carValue(s, i)).filter((v): v is number => v !== null);
  const volVals = sorted.map((i) => s.volLog[i]).filter((v): v is number => v !== null);
  const absAr = sorted.map((i) => s.ar[i]).filter((v): v is number => v !== null).map((v) => Math.abs(v) * 100);
  return {
    id,
    label,
    nEvents: sorted.length,
    day0: compareValues(d0, b.base0, { ...o, mode: "abs" }),
    car: compareValues(carVals, b.baseCar, { ...o, mode: "abs" }),
    volume: compareValues(volVals, b.baseVol, { ...o, mode: "diff" }),
    absArPctEvent: mean(absAr),
    absArPctBase: mean(b.baseAbsAr),
  };
}

/** Fills pAdj on every test with Benjamini-Hochberg over the whole table. Returns the family size. */
export function adjustFamily(groups: EventGroupResult[]): number {
  const tests: GroupTest[] = [];
  for (const g of groups) tests.push(g.day0, g.car, g.volume);
  const ps = tests.map((t) => (t.p === null ? NaN : t.p));
  const adj = benjaminiHochberg(ps);
  tests.forEach((t, i) => {
    t.pAdj = Number.isFinite(adj[i]) ? adj[i] : null;
  });
  return ps.filter((p) => Number.isFinite(p)).length;
}

export function classifyEffect(pooled: GroupTest): EffectWord {
  if (!pooled.enough || pooled.ratio === null) return "not-enough";
  if (pooled.pAdj !== null && pooled.pAdj < 0.05 && pooled.ratioLo !== null && pooled.ratioLo > 1) {
    return pooled.ratio >= 1.5 ? "clearly-larger" : "somewhat-larger";
  }
  if (pooled.pAdj !== null && pooled.pAdj < 0.05 && pooled.ratioHi !== null && pooled.ratioHi < 1) return "smaller";
  return "no-clear-difference";
}

export function runEventStudy(series: StudySeries, events: DatedEvent[], typeDefs: EventTypeDef[], opts: StudyOptions = {}): EventStudyResult {
  const minHeadline = opts.minHeadline ?? MIN_HEADLINE_EVENTS;
  const minType = opts.minType ?? MIN_TYPE_EVENTS;
  const thinBelow = opts.thinBelow ?? THIN_BELOW;
  const mapped = mapEvents(series.dates, events, typeDefs.map((t) => t.id));
  const b = buildBaselines(series, mapped, opts.extraMaskIdx);
  const base = { skipCi: opts.skipCi };
  const pooled = evalGroup("all", "Any dated filing", mapped.map((m) => m.idx), series, b, { mode: "abs", minN: minHeadline, thinBelow: Math.max(thinBelow, minHeadline), ...base });
  const groups: EventGroupResult[] = [];
  if (!opts.pooledOnly) {
    for (const def of typeDefs) {
      const idxs = mapped.filter((m) => m.type === def.id).map((m) => m.idx);
      groups.push(evalGroup(def.id, def.label, idxs, series, b, { mode: "abs", minN: minType, thinBelow, ...base }));
    }
  }
  const testsInFamily = adjustFamily([pooled, ...groups]);
  return {
    groups,
    pooled,
    effect: classifyEffect(pooled.day0),
    ratioCannotRuleOut: pooled.day0.ratioHi,
    testsInFamily,
    minHeadlineEvents: minHeadline,
    minTypeEvents: minType,
  };
}
