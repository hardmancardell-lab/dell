// Pure: US equity trading-session classification for the extended-hours toggle and shading. Eastern time, computed from
// the bar's own timestamp. Holidays and half days are not modelled (a bar is classed by clock time only).
import { easternClock } from "./meta";

export type EquitySession = "pre" | "regular" | "post" | "closed";

const PRE_START = 4 * 60; // 04:00 ET
const REGULAR_START = 9 * 60 + 30; // 09:30 ET
const REGULAR_END = 16 * 60; // 16:00 ET
const POST_END = 20 * 60; // 20:00 ET

/** Session of the bar that OPENS at `ms`. Weekends are "closed". */
export function equitySessionOf(ms: number): EquitySession {
  const { weekday, minutes } = easternClock(ms);
  if (weekday === 0 || weekday === 6) return "closed";
  if (minutes >= REGULAR_START && minutes < REGULAR_END) return "regular";
  if (minutes >= PRE_START && minutes < REGULAR_START) return "pre";
  if (minutes >= REGULAR_END && minutes < POST_END) return "post";
  return "closed";
}

export interface SessionCounts {
  pre: number;
  regular: number;
  post: number;
  closed: number;
}

export function countSessions(times: readonly number[]): SessionCounts {
  const out: SessionCounts = { pre: 0, regular: 0, post: 0, closed: 0 };
  for (const t of times) out[equitySessionOf(t)] += 1;
  return out;
}

/** True when any bar is outside regular hours (so a toggle has something to toggle). */
export function hasExtendedBars(times: readonly number[]): boolean {
  for (const t of times) {
    const s = equitySessionOf(t);
    if (s === "pre" || s === "post") return true;
  }
  return false;
}

/** Keeps bars by session. With `includeExtended` false only regular-session bars remain. Order is preserved. */
export function filterExtendedHours<T extends { datetime: number }>(bars: readonly T[], includeExtended: boolean): T[] {
  if (includeExtended) return bars.slice();
  return bars.filter((b) => equitySessionOf(b.datetime) === "regular");
}

export interface ShadeRange {
  /** Epoch ms of the first extended bar's open. */
  fromMs: number;
  /** Epoch ms of the last extended bar's open in the run. */
  toMs: number;
}

/** Runs of consecutive extended-session bars (pre or post), for shading. A run ends at the first regular, closed or missing-day bar. */
export function extendedShadeRanges<T extends { datetime: number }>(bars: readonly T[]): ShadeRange[] {
  const out: ShadeRange[] = [];
  let run: ShadeRange | null = null;
  for (const b of bars) {
    const s = equitySessionOf(b.datetime);
    if (s === "pre" || s === "post") {
      if (run) run.toMs = b.datetime;
      else run = { fromMs: b.datetime, toMs: b.datetime };
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return out;
}
