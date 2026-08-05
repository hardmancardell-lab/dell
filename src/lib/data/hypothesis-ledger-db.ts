import type { AssetClass, HypothesisExitType, HypothesisStatus, StrategyHypothesis } from "@/lib/agents/trading-agent/types";

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
}

function toHypothesis(row: HypothesisRow): StrategyHypothesis {
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
  };
}

export async function insertHypothesis(h: Omit<StrategyHypothesis, "id" | "createdAt">): Promise<void> {
  await supabaseRequest("strategy_hypotheses", {
    method: "POST",
    body: {
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
    },
  });
}

export async function getRecentHypotheses(limit = 100): Promise<StrategyHypothesis[]> {
  const rows = await supabaseRequest<HypothesisRow[]>(`strategy_hypotheses?order=created_at.desc&limit=${limit}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toHypothesis);
}
