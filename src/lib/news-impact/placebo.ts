import { mulberry32 } from "@/lib/agents/trading-agent/skills/stats-tests";
import { mapEvents, runEventStudy, type StudySeries } from "./event-study";
import type { DatedEvent } from "./types";

/**
 * Placebo and power checks for the event study. Pure and seeded.
 *
 *  - Random days: the same number of fake events as the real pooled set, on days that are not real event windows.
 *  - Shifted real dates: every real event date moved by one random offset (keeps clustering such as earnings seasons).
 * The same pipeline is run on the fake events. With no real effect the unadjusted test should fire about 5% of the time.
 *
 * powerTest does the opposite: it multiplies the abnormal moves on fake event days by a known factor and reports how
 * often the pipeline notices, so the report can say how large an effect the study can and cannot detect.
 */

export type PlaceboKind = "random" | "shifted";

export interface PlaceboRates {
  kind: PlaceboKind;
  runs: number;
  /** Runs that produced a test at all. */
  valid: number;
  nEventsPerRun: number;
  /** Share of valid runs with an unadjusted p below 0.05, per measure. */
  falsePass: { day0: number | null; car: number | null; volume: number | null };
}

function realMaskedIdx(series: StudySeries, realEvents: DatedEvent[]): { real: number[]; blocked: Set<number> } {
  const real = mapEvents(series.dates, realEvents, []).map((m) => m.idx);
  const blocked = new Set<number>();
  for (const i of real) for (let k = -1; k <= 2; k++) blocked.add(i + k);
  return { real, blocked };
}

function drawRandom(rand: () => number, candidates: number[], k: number): number[] {
  const pool = candidates.slice();
  const out: number[] = [];
  const m = Math.min(k, pool.length);
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out.sort((a, b) => a - b);
}

function drawShifted(rand: () => number, real: number[], N: number, blocked: Set<number>): number[] {
  for (let tries = 0; tries < 30; tries++) {
    const shift = 15 + Math.floor(rand() * Math.max(1, N - 30));
    const moved = real.map((i) => (i + shift) % N).filter((i) => !blocked.has(i));
    if (moved.length >= Math.max(10, Math.floor(real.length * 0.6))) return moved.sort((a, b) => a - b);
  }
  return [];
}

function toEvents(series: StudySeries, idxs: number[]): DatedEvent[] {
  return idxs.map((i) => ({ date: series.dates[i], type: "x", label: "placebo" }));
}

export function placeboTest(series: StudySeries, realEvents: DatedEvent[], opts: { runs?: number; seed?: number; kind: PlaceboKind }): PlaceboRates {
  const runs = opts.runs ?? 200;
  const rand = mulberry32(opts.seed ?? 20261018);
  const { real, blocked } = realMaskedIdx(series, realEvents);
  const N = series.dates.length;
  const candidates: number[] = [];
  for (let i = 0; i < N; i++) if (series.sar[i] !== null && !blocked.has(i)) candidates.push(i);

  let valid = 0;
  const hit = { day0: 0, car: 0, volume: 0, d0i: 0 };
  const have = { day0: 0, car: 0, volume: 0 };
  let nPer = 0;
  for (let r = 0; r < runs; r++) {
    const idxs = opts.kind === "random" ? drawRandom(rand, candidates, real.length) : drawShifted(rand, real, N, blocked);
    if (idxs.length < 10) continue;
    nPer = idxs.length;
    const res = runEventStudy(series, toEvents(series, idxs), [], { pooledOnly: true, skipCi: true, extraMaskIdx: real, minHeadline: 10 });
    const p = res.pooled;
    valid++;
    if (p.day0.p !== null) {
      have.day0++;
      if (p.day0.p < 0.05) hit.day0++;
    }
    if (p.car.p !== null) {
      have.car++;
      if (p.car.p < 0.05) hit.car++;
    }
    if (p.volume.p !== null) {
      have.volume++;
      if (p.volume.p < 0.05) hit.volume++;
    }
  }
  return {
    kind: opts.kind,
    runs,
    valid,
    nEventsPerRun: nPer,
    falsePass: {
      day0: have.day0 ? hit.day0 / have.day0 : null,
      car: have.car ? hit.car / have.car : null,
      volume: have.volume ? hit.volume / have.volume : null,
    },
  };
}

export interface PowerRow {
  factor: number;
  runs: number;
  /** Share of runs where the unadjusted day-0 test fired (p < 0.05) and the effect was in the right direction. */
  detectDay0: number | null;
}

/** How often a known multiplicative effect (on |abnormal move|, event day and the next two) is detected, with n events like the real set. */
export function powerTest(series: StudySeries, realEvents: DatedEvent[], factors: number[], opts: { runs?: number; seed?: number } = {}): PowerRow[] {
  const runs = opts.runs ?? 100;
  const { real, blocked } = realMaskedIdx(series, realEvents);
  const N = series.dates.length;
  const candidates: number[] = [];
  for (let i = 0; i < N; i++) if (series.sar[i] !== null && !blocked.has(i)) candidates.push(i);
  const out: PowerRow[] = [];
  for (const f of factors) {
    const rand = mulberry32((opts.seed ?? 777) + Math.round(f * 1000));
    let det = 0;
    let valid = 0;
    for (let r = 0; r < runs; r++) {
      const idxs = drawRandom(rand, candidates, real.length);
      if (idxs.length < 10) continue;
      const sar = series.sar.slice();
      const ar = series.ar.slice();
      for (const i of idxs) {
        for (let k = 0; k < 3; k++) {
          if (i + k < N && sar[i + k] !== null) {
            sar[i + k] = (sar[i + k] as number) * f;
            ar[i + k] = (ar[i + k] as number) * f;
          }
        }
      }
      const res = runEventStudy({ ...series, sar, ar }, toEvents(series, idxs), [], { pooledOnly: true, skipCi: true, extraMaskIdx: real, minHeadline: 10 });
      const p = res.pooled.day0;
      if (p.p === null) continue;
      valid++;
      if (p.p < 0.05 && p.diff !== null && p.diff > 0) det++;
    }
    out.push({ factor: f, runs: valid, detectDay0: valid ? det / valid : null });
  }
  return out;
}
