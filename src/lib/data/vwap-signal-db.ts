import type { SignalRecord, StoredSignal, SignalWritePlan } from "@/lib/agents/trading-agent/skills/vwap-signal-log";

/**
 * Plain-fetch Supabase REST access for vwap_signal_log, same header pattern as paper-trading-db.ts. The log is
 * research data, so a missing table or missing config is reported to the caller as "unavailable" instead of
 * throwing: the scan still returns what it found.
 */

const TABLE = "vwap_signal_log";

export function isSignalDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export class SignalDbUnavailable extends Error {}

async function request<T>(path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new SignalDbUnavailable("Supabase is not configured, so signals cannot be saved.");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method,
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: init.prefer ?? "return=minimal" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // PostgREST answers 404 / PGRST205 / 42P01 when the table has not been created yet.
    if (res.status === 404 || /PGRST205|42P01|does not exist|schema cache/i.test(text)) {
      throw new SignalDbUnavailable("The signal log table does not exist yet. Run db/migrations/2026-10-08_vwap_signal_log.sql in Supabase.");
    }
    throw new Error(`Supabase request failed (${res.status}) for ${path}: ${text.slice(0, 200)}`);
  }
  return init.prefer === "return=representation" ? ((await res.json()) as T) : (undefined as T);
}

interface Row {
  id: string;
  symbol: string;
  asset_kind: "equity" | "forex";
  session_date: string;
  entry_time: string;
  side: "upper" | "lower";
  k: number;
  stop_k: number;
  entry_price: number;
  vwap: number;
  sigma: number;
  band_pct: number;
  volume_z: number | null;
  volume_class: SignalRecord["volumeClass"];
  status: "open" | "closed";
  exit_reason: SignalRecord["exitReason"];
  exit_price: number;
  bars_held: number;
  fade_return_pct: number;
  detected_lag_min: number;
  source: "live" | "backfill";
}

const num = (v: unknown) => Number(v);

export function fromRow(r: Row): StoredSignal {
  return {
    id: r.id,
    symbol: r.symbol,
    assetKind: r.asset_kind,
    sessionDate: r.session_date,
    entryTimeMs: Date.parse(r.entry_time),
    side: r.side,
    k: num(r.k),
    stopK: num(r.stop_k),
    entryPrice: num(r.entry_price),
    vwap: num(r.vwap),
    sigma: num(r.sigma),
    bandPct: num(r.band_pct),
    volumeZ: r.volume_z === null ? null : num(r.volume_z),
    volumeClass: r.volume_class,
    status: r.status,
    exitReason: r.exit_reason,
    exitPrice: num(r.exit_price),
    barsHeld: num(r.bars_held),
    fadeReturnPct: num(r.fade_return_pct),
    detectedLagMin: num(r.detected_lag_min),
    source: r.source,
  };
}

export function toRow(s: SignalRecord): Omit<Row, "id"> {
  return {
    symbol: s.symbol,
    asset_kind: s.assetKind,
    session_date: s.sessionDate,
    entry_time: new Date(s.entryTimeMs).toISOString(),
    side: s.side,
    k: s.k,
    stop_k: s.stopK,
    entry_price: s.entryPrice,
    vwap: s.vwap,
    sigma: s.sigma,
    band_pct: s.bandPct,
    volume_z: s.volumeZ,
    volume_class: s.volumeClass,
    status: s.status,
    exit_reason: s.exitReason,
    exit_price: s.exitPrice,
    bars_held: s.barsHeld,
    fade_return_pct: s.fadeReturnPct,
    detected_lag_min: s.detectedLagMin,
    source: s.source,
  };
}

export async function listSignals(symbol: string | null, limit = 500): Promise<StoredSignal[]> {
  const filter = symbol ? `symbol=eq.${encodeURIComponent(symbol)}&` : "";
  const rows = await request<Row[]>(`${TABLE}?${filter}order=entry_time.desc&limit=${limit}`, { method: "GET", prefer: "return=representation" });
  return rows.map(fromRow);
}

/** Rows for one symbol in the sessions a scan can touch (new rows are checked against these before inserting). */
export async function signalsForSessions(symbol: string, sessionDates: string[]): Promise<StoredSignal[]> {
  if (sessionDates.length === 0) return [];
  const dates = sessionDates.map((d) => `"${d}"`).join(",");
  const rows = await request<Row[]>(
    `${TABLE}?symbol=eq.${encodeURIComponent(symbol)}&session_date=in.(${encodeURIComponent(dates)})&limit=1000`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(fromRow);
}

/** Inserts new rows. A row that already exists (unique key) is skipped rather than overwritten, so a retry or a double click is harmless. */
export async function insertSignals(records: SignalRecord[]): Promise<void> {
  if (records.length === 0) return;
  await request(`${TABLE}?on_conflict=symbol,session_date,entry_time,side,k`, {
    method: "POST",
    prefer: "resolution=ignore-duplicates",
    body: records.map(toRow),
  });
}

export async function updateSignal(id: string, patch: SignalWritePlan["updates"][number]["patch"]): Promise<void> {
  await request(`${TABLE}?id=eq.${encodeURIComponent(id)}&status=eq.open`, {
    method: "PATCH",
    body: {
      status: patch.status,
      exit_reason: patch.exitReason,
      exit_price: patch.exitPrice,
      bars_held: patch.barsHeld,
      fade_return_pct: patch.fadeReturnPct,
      updated_at: new Date().toISOString(),
    },
  });
}
