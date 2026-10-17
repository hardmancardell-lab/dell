import { fetchBarsForTimeframe } from "@/lib/data/market-data";
import { SignalDbUnavailable, insertSignals, listSignals, signalsForSessions, updateSignal } from "@/lib/data/vwap-signal-db";
import type { BandParams } from "./vwap-band-engine";
import { assetKindOf } from "./vwap-band-study";
import { planSignalWrites, scanSignals, summarizeSignalLog, type SignalLogSummary, type SignalRecord, type StoredSignal } from "./vwap-signal-log";

/** Calendar days of 5-minute bars fetched per scan: 20 prior sessions for the volume baseline plus slack for holidays. */
const SCAN_CALENDAR_DAYS = 45;
const LIVE_REVALIDATE_SECONDS = 30;

export interface SignalScanResult {
  ticker: string;
  scannedAt: string;
  sessionRunning: boolean;
  newestSessionDate: string | null;
  /** Touches found in the newest session right now (open or closed), whether or not they were saved. */
  currentSession: SignalRecord[];
  saved: { inserted: number; updated: number; unchanged: number; skippedOld: number } | null;
  /** Why nothing was saved, when that is the case (no database, table missing). */
  saveNote: string | null;
  notes: string[];
}

export interface SignalLogView {
  signals: StoredSignal[];
  summary: SignalLogSummary;
  available: boolean;
  unavailableReason: string | null;
}

/**
 * Fetches the latest 5-minute bars, finds band touches, and records them. The scan itself needs no database, so
 * if saving is not possible the touches found are still returned and the reason is given in `saveNote`.
 */
export async function runSignalScan(ticker: string, params: Partial<BandParams> = {}, nowMs: number = Date.now()): Promise<SignalScanResult> {
  const symbol = ticker.trim().toUpperCase();
  const kind = assetKindOf(symbol);
  const startMs = nowMs - SCAN_CALENDAR_DAYS * 24 * 60 * 60 * 1000;
  const candles = await fetchBarsForTimeframe(symbol, "5Min", startMs, nowMs, LIVE_REVALIDATE_SECONDS, { adjustment: "raw" }); // live signal log: unadjusted, like the live quote it is compared with
  if (candles.length === 0) throw new Error(`No 5-minute bars returned for ${symbol}. Check the symbol (forex uses the EUR/USD form).`);

  const scan = scanSignals(candles, symbol, kind, nowMs, params);
  const result: SignalScanResult = {
    ticker: symbol,
    scannedAt: new Date(nowMs).toISOString(),
    sessionRunning: scan.sessionRunning,
    newestSessionDate: scan.newestSessionDate,
    currentSession: scan.records.filter((r) => r.sessionDate === scan.newestSessionDate),
    saved: null,
    saveNote: null,
    notes: scan.notes,
  };

  try {
    const dates = [...new Set(scan.records.map((r) => r.sessionDate))];
    const existing = await signalsForSessions(symbol, dates);
    const plan = planSignalWrites(scan.records, existing, scan.newestSessionDate);
    await insertSignals(plan.inserts);
    for (const u of plan.updates) await updateSignal(u.id, u.patch);
    result.saved = { inserted: plan.inserts.length, updated: plan.updates.length, unchanged: plan.unchanged, skippedOld: plan.skippedOld };
  } catch (e) {
    result.saveNote = e instanceof SignalDbUnavailable ? e.message : `Signals were found but could not be saved: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}`;
  }
  return result;
}

/** The saved log with its summary. Reports "unavailable" instead of throwing when the database is not set up. */
export async function readSignalLog(ticker: string | null, limit = 500): Promise<SignalLogView> {
  try {
    const signals = await listSignals(ticker ? ticker.trim().toUpperCase() : null, limit);
    return { signals, summary: summarizeSignalLog(signals), available: true, unavailableReason: null };
  } catch (e) {
    return {
      signals: [],
      summary: summarizeSignalLog([]),
      available: false,
      unavailableReason: e instanceof SignalDbUnavailable ? e.message : `The signal log could not be read: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}`,
    };
  }
}
