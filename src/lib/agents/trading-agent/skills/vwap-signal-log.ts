import type { MarketCandle } from "@/lib/data/market-data-types";
import { bootstrapCi } from "./stats-tests";
import { mean } from "../stats";
import {
  DEFAULT_BAND_PARAMS,
  SMALL_SAMPLE_TRADES,
  findBandTrades,
  scanLiveSession,
  type BandParams,
  type BandSide,
  type BandTrade,
  type ExitReason,
  type VolumeClass,
} from "./vwap-band-engine";
import { modalLength, rawSessions, type StudyAssetKind } from "./vwap-band-study";

/**
 * Forward-test log for the VWAP-band idea. Each time the scan runs it records band touches it sees, notes how
 * late it saw them, and later fills in how they ended. Research and paper only: it places no orders.
 *
 * The point of the log is honesty about timing. A touch found within a couple of bars of happening is "live";
 * one found after the fact is "backfill" and is kept apart, because a backtest-style look at old bars is not a
 * forward test.
 */

const BAR_MS = 5 * 60 * 1000;
/** A touch counts as seen live when the scan ran within this long of the entry bar closing. */
export const LIVE_LAG_MINUTES = 10;
/** The newest bar must be this recent for the last short session to count as "still running". */
const LIVE_FEED_MAX_AGE_MS = 15 * 60 * 1000;

export type SignalSource = "live" | "backfill";
export type SignalStatus = "open" | "closed";

export interface SignalRecord {
  symbol: string;
  assetKind: StudyAssetKind;
  sessionDate: string;
  entryTimeMs: number;
  side: BandSide;
  k: number;
  stopK: number;
  entryPrice: number;
  vwap: number;
  sigma: number;
  bandPct: number;
  volumeZ: number | null;
  volumeClass: VolumeClass;
  status: SignalStatus;
  exitReason: ExitReason;
  /** Exit price, or the latest close while the trade is still open. */
  exitPrice: number;
  barsHeld: number;
  /** Fade return in percent: realized once closed, marked to the latest close while open. */
  fadeReturnPct: number;
  /** Minutes between the entry bar closing and the scan that first saw it. */
  detectedLagMin: number;
  source: SignalSource;
}

export interface StoredSignal extends SignalRecord {
  id: string;
}

export function signalKey(r: Pick<SignalRecord, "symbol" | "sessionDate" | "entryTimeMs" | "side" | "k">): string {
  return `${r.symbol}|${r.sessionDate}|${r.entryTimeMs}|${r.side}|${r.k}`;
}

function toRecord(t: BandTrade, symbol: string, kind: StudyAssetKind, p: BandParams, nowMs: number): SignalRecord {
  const lag = Math.max(0, Math.round((nowMs - (t.entryTimeMs + BAR_MS)) / 60000));
  return {
    symbol,
    assetKind: kind,
    sessionDate: t.dateKey,
    entryTimeMs: t.entryTimeMs,
    side: t.side,
    k: p.k,
    stopK: p.stopK,
    entryPrice: t.entryPrice,
    vwap: t.vwap,
    sigma: t.sigma,
    bandPct: t.bandPct,
    volumeZ: t.volumeZ,
    volumeClass: t.volumeClass,
    status: t.exitReason === "open" ? "open" : "closed",
    exitReason: t.exitReason,
    exitPrice: t.exitPrice,
    barsHeld: t.barsHeld,
    fadeReturnPct: t.fadeReturnPct,
    detectedLagMin: lag,
    source: lag <= LIVE_LAG_MINUTES ? "live" : "backfill",
  };
}

export interface SignalScan {
  /** Every touch found in the newest session plus the outcomes of the few sessions before it. */
  records: SignalRecord[];
  /** The newest session's date, the only one new rows may be logged for. */
  newestSessionDate: string | null;
  /** True when the newest session is still running (its last bar is recent and it is short of a full session). */
  sessionRunning: boolean;
  completeSessions: number;
  notes: string[];
}

/**
 * Pure scan step: candles in, signal records out. Does not touch the network or the database.
 * `resolveSessions` is how many finished sessions before the newest are re-simulated so rows left open can be
 * closed out.
 */
export function scanSignals(
  candles: MarketCandle[],
  symbol: string,
  kind: StudyAssetKind,
  nowMs: number,
  params: Partial<BandParams> = {},
  resolveSessions = 5
): SignalScan {
  const p: BandParams = { ...DEFAULT_BAND_PARAMS, ...params };
  const notes: string[] = [];
  const raw = rawSessions(candles, kind);
  if (raw.length === 0) return { records: [], newestSessionDate: null, sessionRunning: false, completeSessions: 0, notes: ["No session bars were returned."] };

  const full = modalLength(raw.map((s) => s.bars.length));
  const newest = raw[raw.length - 1];
  const lastBar = newest.bars[newest.bars.length - 1];
  const running = newest.bars.length < full && nowMs - lastBar.datetime <= LIVE_FEED_MAX_AGE_MS;
  // A short newest session that is not running is a holiday or half day: leave it out like the study does.
  const complete = raw.filter((s) => s.bars.length === full);
  const hasVolume = complete.some((s) => s.bars.some((b) => b.volume > 0));
  if (complete.length < (hasVolume ? p.baselineDays : 1)) {
    return { records: [], newestSessionDate: newest.dateKey, sessionRunning: running, completeSessions: complete.length, notes: [`Only ${complete.length} full sessions in the window, not enough for the ${p.baselineDays}-session volume baseline.`] };
  }

  const records: SignalRecord[] = [];
  const newestIsComplete = complete.length > 0 && complete[complete.length - 1].dateKey === newest.dateKey;
  if (running) {
    const live = scanLiveSession(complete, newest, hasVolume, p);
    if (live === null) notes.push("Not enough prior sessions for the volume baseline, so today's touches could not be scored.");
    else for (const t of live) records.push(toRecord(t, symbol, kind, p, nowMs));
  }
  // Finished sessions: the newest finished one (if it is the newest day) plus a few before it, for outcomes.
  const { trades } = findBandTrades(complete, hasVolume, p);
  const keepFrom = Math.max(0, complete.length - 1 - resolveSessions);
  const keepDates = new Set(complete.slice(keepFrom).map((s) => s.dateKey));
  for (const t of trades) if (keepDates.has(t.dateKey)) records.push(toRecord(t, symbol, kind, p, nowMs));
  if (!running && !newestIsComplete) notes.push(`${newest.dateKey} is a short session (holiday or half day) and was skipped.`);
  if (!hasVolume) notes.push("This feed carries no volume, so VWAP is a plain average and there is no volume Z-score.");
  return { records, newestSessionDate: newestIsComplete || running ? newest.dateKey : (complete[complete.length - 1]?.dateKey ?? null), sessionRunning: running, completeSessions: complete.length, notes };
}

export interface SignalWritePlan {
  inserts: SignalRecord[];
  updates: { id: string; patch: Pick<SignalRecord, "status" | "exitReason" | "exitPrice" | "barsHeld" | "fadeReturnPct"> }[];
  /** Touches seen only in older sessions that were never logged: not recorded, since that would be backfilling history. */
  skippedOld: number;
  unchanged: number;
}

/**
 * Decides what to write. New rows are only inserted for the newest session. Rows already logged are updated only
 * while still open, and a row that has closed is never touched again, so the log cannot be quietly rewritten.
 */
export function planSignalWrites(found: SignalRecord[], existing: StoredSignal[], newestSessionDate: string | null): SignalWritePlan {
  const byKey = new Map(existing.map((e) => [signalKey(e), e]));
  const plan: SignalWritePlan = { inserts: [], updates: [], skippedOld: 0, unchanged: 0 };
  for (const f of found) {
    const e = byKey.get(signalKey(f));
    if (!e) {
      if (f.sessionDate === newestSessionDate) plan.inserts.push(f);
      else plan.skippedOld++;
      continue;
    }
    if (e.status === "closed") {
      plan.unchanged++;
      continue;
    }
    const same = f.status === e.status && f.exitReason === e.exitReason && f.barsHeld === e.barsHeld && f.exitPrice === e.exitPrice;
    if (same) plan.unchanged++;
    else plan.updates.push({ id: e.id, patch: { status: f.status, exitReason: f.exitReason, exitPrice: f.exitPrice, barsHeld: f.barsHeld, fadeReturnPct: f.fadeReturnPct } });
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------

export interface SignalLogSummary {
  total: number;
  open: number;
  closed: number;
  liveClosed: number;
  backfillClosed: number;
  /** Closed trades that were seen live: the only ones that count as forward-test evidence. */
  live: {
    n: number;
    avgReturnPct: number | null;
    ciLowerPct: number | null;
    ciUpperPct: number | null;
    ciExcludesZero: boolean;
    winRatePct: number | null;
    targetPct: number | null;
    stopPct: number | null;
    smallSample: boolean;
  };
  note: string;
}

export function summarizeSignalLog(rows: SignalRecord[]): SignalLogSummary {
  const closed = rows.filter((r) => r.status === "closed");
  const live = closed.filter((r) => r.source === "live");
  const returns = live.map((r) => r.fadeReturnPct);
  const ci = returns.length >= 2 ? bootstrapCi(returns) : null;
  const share = (reason: ExitReason) => (live.length ? (live.filter((r) => r.exitReason === reason).length / live.length) * 100 : null);
  const smallSample = live.length < SMALL_SAMPLE_TRADES;
  return {
    total: rows.length,
    open: rows.length - closed.length,
    closed: closed.length,
    liveClosed: live.length,
    backfillClosed: closed.length - live.length,
    live: {
      n: live.length,
      avgReturnPct: returns.length ? mean(returns) : null,
      ciLowerPct: ci?.lower ?? null,
      ciUpperPct: ci?.upper ?? null,
      ciExcludesZero: ci?.ciExcludesZero ?? false,
      winRatePct: returns.length ? (returns.filter((x) => x > 0).length / returns.length) * 100 : null,
      targetPct: share("target"),
      stopPct: share("stop"),
      smallSample,
    },
    note:
      live.length === 0
        ? "No signals have been seen live and closed yet. Results appear here as scans catch touches in real time."
        : smallSample
          ? `Only ${live.length} live closed signals, too few to judge. Hypothetical, before spread, slippage and fees.`
          : "Live closed signals only; backfilled rows are excluded. Hypothetical, before spread, slippage and fees.",
  };
}
