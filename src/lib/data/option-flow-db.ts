import type { OptionFlowRow } from "@/lib/agents/trading-agent/skills/option-flow-snapshot";

/**
 * Plain-fetch Supabase REST access for option_flow_snapshots, same header pattern as vwap-signal-db.ts (service-role
 * key, no client library). The table is research data, so a missing table or missing config surfaces as a distinct
 * OptionFlowDbUnavailable that names the migration file.
 */

const TABLE = "option_flow_snapshots";
const MIGRATION = "db/migrations/2026-10-15_option_flow_snapshots.sql";

export function isOptionFlowDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export class OptionFlowDbUnavailable extends Error {}

/** Every column except the heavy per-contract jsonb. */
const SCALAR_COLUMNS = [
  "symbol", "snapshot_time", "actual_fetch_time", "session_date", "spot", "expirations_used", "expirations_failed",
  "call_volume", "put_volume", "call_premium", "put_premium", "premium_fallback_volume", "premium_unpriced_volume",
  "pc_volume", "pc_premium", "pc_oi", "oi_call", "oi_put", "oi_expirations_used", "oi_asof", "exp_volumes",
  "new_call_volume", "new_put_volume", "pc_new_volume", "minutes_since_prev", "first_pc_volume", "first_pc_premium",
  "pc_volume_chg", "pc_premium_chg", "agg_call_buy", "agg_call_sell", "agg_put_buy", "agg_put_sell", "agg_unclassified",
  "iv_atm_near", "iv_atm_next", "stale", "clamped", "flags", "provider_calls",
  "data_feed", "quote_lag_seconds",
].join(",");

/**
 * Supabase sometimes answers a valid service-role call with a one-off 401 (and, rarely, 408/429/5xx or a dropped connection).
 * Seen in production 2026-10-21..26: about one run in four lost SPY's snapshot to "Supabase request failed (401)", while the next call a few
 * seconds later succeeded. Retry those a couple of times with a short pause. Every write here is an idempotent upsert on
 * (symbol, snapshot_time), so a repeat can never double-count; a missing table (404) or a bad request (400) is never retried.
 */
export const RETRY_DELAYS_MS = [300, 900];
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      const transient = res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500;
      if (!transient || attempt >= RETRY_DELAYS_MS.length) return res;
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

async function request<T>(path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new OptionFlowDbUnavailable("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), so option-flow snapshots cannot be stored or read.");
  const res = await fetchWithRetry(`${url}/rest/v1/${path}`, {
    method: init.method,
    cache: "no-store",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: init.prefer ?? "return=minimal" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // PostgREST answers 404 / PGRST205 / 42P01 when the table has not been created yet.
    if (res.status === 404 || /PGRST205|42P01|does not exist|schema cache/i.test(text)) {
      throw new OptionFlowDbUnavailable(`The option_flow_snapshots table does not exist yet. Run ${MIGRATION} in the Supabase SQL editor.`);
    }
    throw new Error(`Supabase request failed (${res.status}) for ${path}: ${text.slice(0, 200)}`);
  }
  return init.prefer?.includes("return=representation") ? ((await res.json()) as T) : (undefined as T);
}

const REP = "return=representation";
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Normalises a REST row: numeric columns can arrive as strings, absent columns as undefined. */
export function fromRow(r: Record<string, unknown>): OptionFlowRow {
  const o = r as Record<string, any>;
  return {
    symbol: o.symbol,
    snapshot_time: new Date(o.snapshot_time).toISOString(),
    actual_fetch_time: new Date(o.actual_fetch_time).toISOString(),
    session_date: String(o.session_date).slice(0, 10),
    spot: Number(o.spot),
    expirations_used: o.expirations_used ?? [],
    expirations_failed: o.expirations_failed ?? [],
    call_volume: Number(o.call_volume),
    put_volume: Number(o.put_volume),
    call_premium: Number(o.call_premium),
    put_premium: Number(o.put_premium),
    premium_fallback_volume: Number(o.premium_fallback_volume ?? 0),
    premium_unpriced_volume: Number(o.premium_unpriced_volume ?? 0),
    pc_volume: n(o.pc_volume),
    pc_premium: n(o.pc_premium),
    pc_oi: n(o.pc_oi),
    oi_call: n(o.oi_call),
    oi_put: n(o.oi_put),
    oi_expirations_used: o.oi_expirations_used ?? null,
    oi_asof: o.oi_asof ? new Date(o.oi_asof).toISOString() : null,
    exp_volumes: o.exp_volumes ?? {},
    new_call_volume: n(o.new_call_volume),
    new_put_volume: n(o.new_put_volume),
    pc_new_volume: n(o.pc_new_volume),
    minutes_since_prev: n(o.minutes_since_prev),
    first_pc_volume: n(o.first_pc_volume),
    first_pc_premium: n(o.first_pc_premium),
    pc_volume_chg: n(o.pc_volume_chg),
    pc_premium_chg: n(o.pc_premium_chg),
    agg_call_buy: n(o.agg_call_buy),
    agg_call_sell: n(o.agg_call_sell),
    agg_put_buy: n(o.agg_put_buy),
    agg_put_sell: n(o.agg_put_sell),
    agg_unclassified: n(o.agg_unclassified),
    iv_atm_near: n(o.iv_atm_near),
    iv_atm_next: n(o.iv_atm_next),
    stale: Boolean(o.stale),
    clamped: Boolean(o.clamped),
    flags: o.flags ?? [],
    provider_calls: n(o.provider_calls),
    // Rows written before the column existed (or an unrecognised value) read as 'sandbox', which is what they were.
    data_feed: o.data_feed === "production" ? "production" : "sandbox",
    quote_lag_seconds: n(o.quote_lag_seconds),
    contracts: o.contracts ?? null,
  };
}

/** Idempotent per (symbol, bucket): a second run in the same bucket replaces the first. */
export async function upsertSnapshot(row: OptionFlowRow): Promise<void> {
  await request(`${TABLE}?on_conflict=symbol,snapshot_time`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { ...row, updated_at: new Date().toISOString() },
  });
}

/** The latest snapshot of this symbol in this session strictly before the given bucket, with its per-contract detail (the next snapshot needs it). */
export async function getPreviousSnapshot(symbol: string, sessionDate: string, beforeSnapshotTimeIso: string): Promise<OptionFlowRow | null> {
  const rows = await request<Record<string, unknown>[]>(
    `${TABLE}?symbol=eq.${encodeURIComponent(symbol)}&session_date=eq.${sessionDate}&snapshot_time=lt.${encodeURIComponent(beforeSnapshotTimeIso)}&order=snapshot_time.desc&limit=1`,
    { method: "GET", prefer: REP }
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** The last snapshot of the most recent earlier session (scalar columns only). Used to spot a holiday serving the last session's volume. */
export async function getLastSnapshotBeforeSession(symbol: string, sessionDate: string): Promise<OptionFlowRow | null> {
  const rows = await request<Record<string, unknown>[]>(
    `${TABLE}?select=${SCALAR_COLUMNS}&symbol=eq.${encodeURIComponent(symbol)}&session_date=lt.${sessionDate}&order=snapshot_time.desc&limit=1`,
    { method: "GET", prefer: REP }
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** One session's snapshots in time order. The per-contract jsonb is left out unless asked for (about 30 KB per row for SPY). */
export async function getDaySeries(symbol: string, sessionDate: string, opts: { includeContracts?: boolean } = {}): Promise<OptionFlowRow[]> {
  const select = opts.includeContracts ? "select=*&" : `select=${SCALAR_COLUMNS}&`;
  const rows = await request<Record<string, unknown>[]>(
    `${TABLE}?${select}symbol=eq.${encodeURIComponent(symbol)}&session_date=eq.${sessionDate}&order=snapshot_time.asc&limit=500`,
    { method: "GET", prefer: REP }
  );
  return rows.map(fromRow);
}

/** The most recent `n` session dates that have rows for this symbol, newest first. */
export async function getRecentSessionDates(symbol: string, n = 20): Promise<string[]> {
  // One narrow column; a full session is about 78 rows, so this reads at most n x 80 tiny rows.
  const rows = await request<{ session_date: string }[]>(
    `${TABLE}?select=session_date&symbol=eq.${encodeURIComponent(symbol)}&order=session_date.desc&limit=${Math.min(n * 80, 4000)}`,
    { method: "GET", prefer: REP }
  );
  return [...new Set(rows.map((r) => String(r.session_date).slice(0, 10)))].slice(0, n);
}

/** The recent `n` sessions' snapshots for a symbol (scalar columns), oldest first: input for the percentile baseline. */
export async function getRecentSessions(symbol: string, n = 20): Promise<OptionFlowRow[]> {
  const dates = await getRecentSessionDates(symbol, n);
  if (dates.length === 0) return [];
  const rows = await request<Record<string, unknown>[]>(
    `${TABLE}?select=${SCALAR_COLUMNS}&symbol=eq.${encodeURIComponent(symbol)}&session_date=gte.${dates[dates.length - 1]}&order=snapshot_time.asc&limit=${n * 90}`,
    { method: "GET", prefer: REP }
  );
  return rows.map(fromRow);
}

/**
 * Retention. detailOnly: null the per-contract jsonb of sessions older than the cutoff (keeps the scalar rows).
 * Otherwise delete whole rows older than the cutoff. `olderThanDateKey` is an ET session date (YYYY-MM-DD).
 */
export async function prune(olderThanDateKey: string, opts: { detailOnly?: boolean } = {}): Promise<void> {
  if (opts.detailOnly) {
    await request(`${TABLE}?session_date=lt.${olderThanDateKey}&contracts=not.is.null`, { method: "PATCH", body: { contracts: null } });
  } else {
    await request(`${TABLE}?session_date=lt.${olderThanDateKey}`, { method: "DELETE" });
  }
}
