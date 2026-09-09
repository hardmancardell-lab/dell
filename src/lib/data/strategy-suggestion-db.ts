import type { OptionStrategyVariant, PaperOptionRight, StrategySuggestion } from "@/lib/agents/trading-agent/types";

/**
 * Plain-fetch Supabase REST CRUD for strategy_suggestions — same
 * header/Prefer pattern as hypothesis-ledger-db.ts/advisor-clients-db.ts.
 * This is the internal, admin-only forward-testing ledger: every real
 * guided-signal occurrence gets both option-strategy variants recorded
 * here automatically (see strategy-suggestion.ts), independent of whether
 * any client places the client-facing single-leg suggestion.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isStrategySuggestionDbConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }
  return { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY };
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
    throw new Error(`Supabase request failed (${res.status}) for ${path}: ${text}`);
  }
  if (init.prefer === "return=representation") {
    return (await res.json()) as T;
  }
  return undefined as T;
}

interface SuggestionRow {
  id: string;
  created_at: string;
  ticker: string;
  strategy_type: string;
  horizon_label: string;
  horizon_days: number;
  direction: "long" | "short";
  variant: OptionStrategyVariant;
  underlying_symbol: string;
  expiration_date: string;
  option_right: PaperOptionRight;
  long_strike: number;
  short_strike: number | null;
  entry_debit: number;
  entry_date: string;
  status: "open" | "closed";
  exit_debit: number | null;
  exit_date: string | null;
  realized_pnl_per_contract: number | null;
  close_reason: string | null;
}

function toSuggestion(row: SuggestionRow): StrategySuggestion {
  return {
    id: row.id,
    createdAt: row.created_at,
    ticker: row.ticker,
    strategyType: row.strategy_type,
    horizonLabel: row.horizon_label,
    horizonDays: row.horizon_days,
    direction: row.direction,
    variant: row.variant,
    underlyingSymbol: row.underlying_symbol,
    expirationDate: row.expiration_date,
    optionRight: row.option_right,
    longStrike: row.long_strike,
    shortStrike: row.short_strike,
    entryDebit: row.entry_debit,
    entryDate: row.entry_date,
    status: row.status,
    exitDebit: row.exit_debit,
    exitDate: row.exit_date,
    realizedPnlPerContract: row.realized_pnl_per_contract,
    closeReason: row.close_reason,
  };
}

export async function insertSuggestion(s: Omit<StrategySuggestion, "id" | "createdAt">): Promise<StrategySuggestion> {
  const rows = await supabaseRequest<SuggestionRow[]>("strategy_suggestions", {
    method: "POST",
    prefer: "return=representation",
    body: {
      ticker: s.ticker,
      strategy_type: s.strategyType,
      horizon_label: s.horizonLabel,
      horizon_days: s.horizonDays,
      direction: s.direction,
      variant: s.variant,
      underlying_symbol: s.underlyingSymbol,
      expiration_date: s.expirationDate,
      option_right: s.optionRight,
      long_strike: s.longStrike,
      short_strike: s.shortStrike,
      entry_debit: s.entryDebit,
      entry_date: s.entryDate,
      status: s.status,
      exit_debit: s.exitDebit,
      exit_date: s.exitDate,
      realized_pnl_per_contract: s.realizedPnlPerContract,
      close_reason: s.closeReason,
    },
  });
  return toSuggestion(rows[0]);
}

/** Used for the once-per-day idempotency check — has this exact (ticker, strategyType, variant) already been suggested today? */
export async function findSuggestionForToday(
  ticker: string,
  strategyType: string,
  variant: OptionStrategyVariant,
  entryDate: string
): Promise<StrategySuggestion | null> {
  const rows = await supabaseRequest<SuggestionRow[]>(
    `strategy_suggestions?ticker=eq.${encodeURIComponent(ticker)}&strategy_type=eq.${encodeURIComponent(strategyType)}&variant=eq.${variant}&entry_date=eq.${entryDate}&select=*`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.length > 0 ? toSuggestion(rows[0]) : null;
}

export async function listOpenSuggestions(): Promise<StrategySuggestion[]> {
  const rows = await supabaseRequest<SuggestionRow[]>("strategy_suggestions?status=eq.open&select=*&order=entry_date.asc", {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toSuggestion);
}

export async function listAllSuggestions(limit = 500): Promise<StrategySuggestion[]> {
  const rows = await supabaseRequest<SuggestionRow[]>(`strategy_suggestions?select=*&order=created_at.desc&limit=${limit}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toSuggestion);
}

export async function closeSuggestion(
  id: string,
  exitDebit: number,
  exitDate: string,
  realizedPnlPerContract: number,
  closeReason: string
): Promise<void> {
  await supabaseRequest(`strategy_suggestions?id=eq.${id}`, {
    method: "PATCH",
    body: {
      status: "closed",
      exit_debit: exitDebit,
      exit_date: exitDate,
      realized_pnl_per_contract: realizedPnlPerContract,
      close_reason: closeReason,
    },
  });
}
