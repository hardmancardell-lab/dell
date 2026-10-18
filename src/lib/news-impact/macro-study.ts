import { benjaminiHochberg } from "@/lib/agents/trading-agent/skills/stats-tests";
import { mean } from "@/lib/agents/trading-agent/stats";
import { compareValues, mapEvents, MIN_TYPE_EVENTS, THIN_BELOW } from "./event-study";
import { trailingSd } from "./market-model";
import type { DatedEvent, EventTypeDef, GroupTest } from "./types";

/**
 * Scheduled macro days (FOMC decisions, CPI releases, jobs reports) against ordinary days. Pure.
 *
 * Measure: |return| divided by the asset's own trailing 60-day return SD (ending 6 days back, the purge gap), so a quiet
 * month and a wild one are comparable. The raw percent move is shown beside it for readability. Same Welch t, bootstrap
 * interval and Benjamini-Hochberg correction as the company event study (the pooled row on its own, the three kinds as a family).
 */

export const MACRO_KINDS: EventTypeDef[] = [
  { id: "fomc", label: "Fed rate decisions (FOMC)" },
  { id: "cpi", label: "Inflation reports (CPI)" },
  { id: "jobs", label: "Jobs reports" },
];

export interface MacroGroupResult {
  id: string;
  label: string;
  nEvents: number;
  test: GroupTest;
  /** Mean absolute return in percent on macro days and on ordinary days (readable units). */
  absRetPctEvent: number | null;
  absRetPctBase: number | null;
}

export interface MacroStudyResult {
  groups: MacroGroupResult[];
  pooled: MacroGroupResult;
  testsInFamily: number;
}

export function runMacroStudy(dates: string[], ret: number[], events: DatedEvent[], kinds: EventTypeDef[] = MACRO_KINDS, opts: { skipCi?: boolean; pooledOnly?: boolean } = {}): MacroStudyResult {
  const tsd = trailingSd(ret);
  const z: (number | null)[] = ret.map((r, i) => (tsd[i] !== null ? Math.abs(r) / (tsd[i] as number) : null));
  const mapped = mapEvents(dates, events, kinds.map((k) => k.id), 4);
  const eventIdx = new Set(mapped.map((m) => m.idx));
  const baseZ: number[] = [];
  const baseRaw: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (eventIdx.has(i) || z[i] === null) continue;
    baseZ.push(z[i] as number);
    baseRaw.push(Math.abs(ret[i]) * 100);
  }
  const group = (id: string, label: string, idxs: number[]): MacroGroupResult => {
    const zs = idxs.map((i) => z[i]).filter((v): v is number => v !== null);
    const raw = idxs.filter((i) => z[i] !== null).map((i) => Math.abs(ret[i]) * 100);
    return {
      id,
      label,
      nEvents: zs.length,
      test: compareValues(zs, baseZ, { mode: "abs", minN: MIN_TYPE_EVENTS, thinBelow: THIN_BELOW, skipCi: opts.skipCi }),
      absRetPctEvent: mean(raw),
      absRetPctBase: mean(baseRaw),
    };
  };
  const pooled = group("all", "Any scheduled macro day", mapped.map((m) => m.idx));
  const groups = opts.pooledOnly ? [] : kinds.map((k) => group(k.id, k.label, mapped.filter((m) => m.type === k.id).map((m) => m.idx)));
  // Two families: the single pooled headline test (nothing to correct for) and the three kinds (Benjamini-Hochberg).
  pooled.test.pAdj = pooled.test.p;
  const adj = benjaminiHochberg(groups.map((g) => (g.test.p === null ? NaN : g.test.p)));
  groups.forEach((g, i) => {
    g.test.pAdj = Number.isFinite(adj[i]) ? adj[i] : null;
  });
  return { groups, pooled, testsInFamily: [pooled, ...groups].filter((g) => g.test.p !== null).length };
}
