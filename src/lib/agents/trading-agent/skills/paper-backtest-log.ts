import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDailyBars } from "./daily-bars";
import type { GexSignalResult, PaperBacktestLogEntry } from "../types";

// Same node:fs-on-project-root pattern as schwab-auth.ts's .schwab-tokens.json
// — this is the first accumulating dataset this app has had beyond that
// precedent (everything else is either localStorage or fetched fresh).
const LOG_FILE = path.join(process.cwd(), "gex-paper-backtest-log.json");

async function readLog(): Promise<PaperBacktestLogEntry[]> {
  try {
    const raw = await readFile(LOG_FILE, "utf-8");
    return JSON.parse(raw) as PaperBacktestLogEntry[];
  } catch {
    return [];
  }
}

async function writeLog(entries: PaperBacktestLogEntry[]): Promise<void> {
  await writeFile(LOG_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * Appends an already-computed live GEX signal to the log, deduped per
 * (underlying, expiration) so repeat visits within the same cycle don't
 * create duplicate rows. Takes a precomputed GexSignalResult (rather than
 * recomputing it) so callers that already fetched it for display don't pay
 * for a second live chain/quote fetch. Returns null if already logged or if
 * no contracts came back (nothing meaningful to log).
 */
export async function logSignal(signal: GexSignalResult): Promise<PaperBacktestLogEntry | null> {
  if (!signal.quadrant) return null;

  const entries = await readLog();
  const alreadyLogged = entries.some(
    (e) => e.underlying === signal.underlying && e.expirationDate === signal.nearExpiration
  );
  if (alreadyLogged) return null;

  const entry: PaperBacktestLogEntry = {
    underlying: signal.underlying,
    expirationDate: signal.nearExpiration,
    signalLabel: signal.quadrant,
    signalDate: signal.asOfDateKey,
    monRet: null,
    tueRet: null,
    wedRet: null,
    thuRet: null,
    friRet: null,
    weekRangePct: null,
    pinnedNearWall: null,
    gammaFlip: signal.gexRegime.gammaFlip,
    callWall: signal.gexRegime.callWall,
    putWall: signal.gexRegime.putWall,
    totalNetGex: signal.gexRegime.totalNetGex,
  };

  entries.push(entry);
  await writeLog(entries);
  return entry;
}

function mondayOfWeek(dateKey: string): Date {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function dateKeyOffset(monday: Date, offsetDays: number): string {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function pctReturn(from: number, to: number): number | null {
  return from === 0 ? null : ((to - from) / from) * 100;
}

const PINNED_NEAR_WALL_THRESHOLD_PCT = 2;

/**
 * For any logged entry whose expiration week has already passed and whose
 * returns are still null, fetches that week's real daily bars (already
 * working, real Alpaca data) and fills in mon_ret..fri_ret, week_range_pct,
 * pinned_near_wall — the exact columns options-signals-project/
 * backtest_engine.py expects.
 */
export async function backfillRealizedReturns(): Promise<void> {
  const entries = await readLog();
  let changed = false;
  const now = Date.now();

  for (const entry of entries) {
    if (entry.monRet !== null) continue;
    if (Date.parse(entry.expirationDate) >= now) continue;

    const monday = mondayOfWeek(entry.expirationDate);
    const weekDateKeys = [0, 1, 2, 3, 4].map((o) => dateKeyOffset(monday, o));

    try {
      const bars = await getDailyBars(entry.underlying, 20);
      const byDay = new Map(bars.map((b) => [b.dateKey, b]));
      const weekBars = weekDateKeys.map((k) => byDay.get(k)).filter((b) => b !== undefined);
      if (weekBars.length === 0) continue;

      const monOpen = weekBars[0].open;
      const monBar = byDay.get(weekDateKeys[0]);
      const tueBar = byDay.get(weekDateKeys[1]);
      const wedBar = byDay.get(weekDateKeys[2]);
      const thuBar = byDay.get(weekDateKeys[3]);
      const friBar = byDay.get(weekDateKeys[4]);

      entry.monRet = monBar ? pctReturn(monOpen, monBar.close) : null;
      entry.tueRet = tueBar ? pctReturn(monOpen, tueBar.close) : null;
      entry.wedRet = wedBar ? pctReturn(monOpen, wedBar.close) : null;
      entry.thuRet = thuBar ? pctReturn(monOpen, thuBar.close) : null;
      entry.friRet = friBar ? pctReturn(monOpen, friBar.close) : null;

      const weekHigh = Math.max(...weekBars.map((b) => b.high));
      const weekLow = Math.min(...weekBars.map((b) => b.low));
      entry.weekRangePct = monOpen !== 0 ? ((weekHigh - weekLow) / monOpen) * 100 : null;

      const closeAtExpiration = friBar?.close ?? weekBars[weekBars.length - 1].close;
      const nearestWall =
        Math.abs(entry.callWall - closeAtExpiration) <= Math.abs(entry.putWall - closeAtExpiration)
          ? entry.callWall
          : entry.putWall;
      entry.pinnedNearWall =
        closeAtExpiration !== 0
          ? (Math.abs(closeAtExpiration - nearestWall) / closeAtExpiration) * 100 <= PINNED_NEAR_WALL_THRESHOLD_PCT
          : null;

      changed = true;
    } catch {
      // Leave as null — will retry on the next call rather than failing the whole backfill.
    }
  }

  if (changed) await writeLog(entries);
}

export async function getLog(): Promise<PaperBacktestLogEntry[]> {
  await backfillRealizedReturns();
  return readLog();
}
