import type { AssetClass, HypothesisExitType, HypothesisStatus, StopLossVerdict, StrategyHypothesis } from "@/lib/agents/trading-agent/types";

/**
 * Plain-fetch Supabase REST CRUD for strategy_hypotheses — same
 * header/Prefer pattern as alerts-db.ts/paper-trading-db.ts.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isHypothesisLedgerConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }
  return { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY };
}

/** A failed REST call. Keeps the status and the response text so callers can recognise a missing column. */
export class SupabaseRequestError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "SupabaseRequestError";
    this.status = status;
    this.body = body;
  }
}

/** Columns added by db/migrations/2026-10-19_strategy_hypotheses_fdr_family_size.sql. Sent only while the column may exist. */
const NEW_COLUMNS = ["fdr_family_size"] as const;

/**
 * True when a failed write was refused because one of the NEW columns does not exist yet: Postgres code 42703
 * ("column ... does not exist") or PostgREST code PGRST204 ("Could not find the ... column ... in the schema cache"),
 * and the text names one of the new columns. An error about any other column is not ours to retry.
 */
export function isMissingNewColumnError(err: unknown): boolean {
  if (!(err instanceof SupabaseRequestError)) return false;
  if (err.status !== 400 && err.status !== 404 && err.status !== 500) return false;
  const text = err.body || err.message;
  const looksMissing = /42703|PGRST204|does not exist|could not find the .* column/i.test(text);
  return looksMissing && NEW_COLUMNS.some((c) => text.includes(c));
}

/** How long a "the column is missing" answer is remembered, so the retry is not repeated on every write. */
export const MISSING_COLUMN_MEMORY_MS = 5 * 60 * 1000;
let columnMissingUntil = 0;
/** Test hook: forget what was learned about the new column. */
export function resetFdrColumnMemory(): void {
  columnMissingUntil = 0;
}

async function supabaseRequest<T>(
  path: string,
  init: { method: string; body?: unknown; prefer?: string }
): Promise<T> {
  const { url, key } = requireConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: init.prefer ?? "return=minimal",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SupabaseRequestError(`Supabase request failed (${res.status}) for ${path}: ${text}`, res.status, text);
  }
  if (init.prefer === "return=representation") {
    return (await res.json()) as T;
  }
  return undefined as T;
}

interface HypothesisRow {
  id: string;
  created_at: string;
  ticker: string;
  asset_class: AssetClass;
  strategy_type: string;
  horizon_label: string;
  entry_rule: string;
  exit_type: HypothesisExitType;
  exit_rule: string;
  sample_size: number;
  win_rate_pct: number | null;
  profit_factor: number | null;
  passes_three_bars: boolean;
  p_value_fdr: number | null;
  bootstrap_ci_lower: number | null;
  bootstrap_ci_upper: number | null;
  status: HypothesisStatus;
  rejection_reason: string | null;
  source_engine: string;
  entropy_score: number | null;
  largest_loss_pct: number | null;
  max_drawdown_pct: number | null;
  stop_loss_verdict: StopLossVerdict | null;
  /** Absent until the 2026-10-19 migration is applied; null on rows it could not backfill. */
  fdr_family_size?: number | null;
}

export function toHypothesis(row: HypothesisRow): StrategyHypothesis {
  return {
    id: row.id,
    createdAt: row.created_at,
    ticker: row.ticker,
    assetClass: row.asset_class,
    strategyType: row.strategy_type,
    horizonLabel: row.horizon_label,
    entryRule: row.entry_rule,
    exitType: row.exit_type,
    exitRule: row.exit_rule,
    sampleSize: row.sample_size,
    winRatePct: row.win_rate_pct,
    profitFactor: row.profit_factor,
    passesThreeBars: row.passes_three_bars,
    pValueFdr: row.p_value_fdr,
    bootstrapCiLower: row.bootstrap_ci_lower,
    bootstrapCiUpper: row.bootstrap_ci_upper,
    status: row.status,
    rejectionReason: row.rejection_reason,
    sourceEngine: row.source_engine,
    entropyScore: row.entropy_score,
    largestLossPct: row.largest_loss_pct,
    maxDrawdownPct: row.max_drawdown_pct,
    stopLossVerdict: row.stop_loss_verdict,
    fdrFamilySize: typeof row.fdr_family_size === "number" && row.fdr_family_size >= 1 ? row.fdr_family_size : null,
  };
}

/** The row sent to PostgREST. The new column is included only when asked for. */
export function hypothesisToRow(h: Omit<StrategyHypothesis, "id" | "createdAt">, includeNewColumns: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    ticker: h.ticker,
    asset_class: h.assetClass,
    strategy_type: h.strategyType,
    horizon_label: h.horizonLabel,
    entry_rule: h.entryRule,
    exit_type: h.exitType,
    exit_rule: h.exitRule,
    sample_size: h.sampleSize,
    win_rate_pct: h.winRatePct,
    profit_factor: h.profitFactor,
    passes_three_bars: h.passesThreeBars,
    p_value_fdr: h.pValueFdr,
    bootstrap_ci_lower: h.bootstrapCiLower,
    bootstrap_ci_upper: h.bootstrapCiUpper,
    status: h.status,
    rejection_reason: h.rejectionReason,
    source_engine: h.sourceEngine,
    entropy_score: h.entropyScore,
    largest_loss_pct: h.largestLossPct,
    max_drawdown_pct: h.maxDrawdownPct,
    stop_loss_verdict: h.stopLossVerdict,
  };
  // Only a real family size is sent. The family size is also in the exit-rule text, so nothing is lost without it.
  if (includeNewColumns && typeof h.fdrFamilySize === "number" && h.fdrFamilySize >= 1) row.fdr_family_size = h.fdrFamilySize;
  return row;
}

export async function insertHypothesis(h: Omit<StrategyHypothesis, "id" | "createdAt">): Promise<void> {
  const tryNewColumns = Date.now() >= columnMissingUntil;
  try {
    await supabaseRequest("strategy_hypotheses", { method: "POST", body: hypothesisToRow(h, tryNewColumns) });
  } catch (err) {
    // The app must keep working before the migration is applied: retry ONCE without the new fields and remember it.
    if (!tryNewColumns || !isMissingNewColumnError(err)) throw err;
    columnMissingUntil = Date.now() + MISSING_COLUMN_MEMORY_MS;
    await supabaseRequest("strategy_hypotheses", { method: "POST", body: hypothesisToRow(h, false) });
  }
}

export async function getRecentHypotheses(limit = 100): Promise<StrategyHypothesis[]> {
  const rows = await supabaseRequest<HypothesisRow[]>(`strategy_hypotheses?order=created_at.desc&limit=${limit}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toHypothesis);
}

/** Every real hypothesis at/above minWinRate, regardless of whether it separately passed the three-bar significance gate — validation status is returned per-row (passesThreeBars) so the caller shows both signals rather than one masking the other. Most-recent sweep per (ticker, strategyType, horizon) combo is deduped by the caller, same as guided-trade-signals.ts already does for the live-signal feed. */
export async function getHighWinRateHypotheses(minWinRatePct: number, limit = 300): Promise<StrategyHypothesis[]> {
  const rows = await supabaseRequest<HypothesisRow[]>(
    `strategy_hypotheses?win_rate_pct=gte.${minWinRatePct}&order=win_rate_pct.desc&limit=${limit}`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(toHypothesis);
}
