import type { TradeLogRow } from "@/lib/data/paper-trading-db";

/**
 * Realized paper-trading results per strategy, set beside the backtested win
 * rate each trade was entered on. Pure function over trade-log rows so it can
 * be checked by hand.
 *
 * A "closed trade" is a fill that carries a realized P&L (a sell that reduces a
 * long, or a buy that covers a short option). Fees are already netted into
 * that number by the engine. Opening fills have no realized P&L yet and count
 * only toward `fills`.
 *
 * Nothing here predicts anything. With a small number of closed trades the
 * realized win rate is mostly noise, so `reliable` stays false below
 * MIN_CLOSED_FOR_COMPARISON and the caller should say so rather than rank on it.
 */

export const MIN_CLOSED_FOR_COMPARISON = 30;

export interface StrategyPerformance {
  key: string; // strategyType, or "manual" for trades with no strategy
  label: string;
  source: string;
  fills: number;
  closedTrades: number;
  wins: number;
  losses: number;
  realizedWinRatePct: number | null;
  totalRealizedPnl: number;
  avgWin: number | null;
  avgLoss: number | null; // negative number
  profitFactor: number | null; // gross wins / gross losses; null when there are no losses
  backtestedWinRatePct: number | null; // mean of the entry-time KPI across this strategy's fills
  backtestedSampleSize: number | null;
  gapPct: number | null; // realized minus backtested, in percentage points
  reliable: boolean;
  lastTradeAt: string | null;
}

export interface PerformanceSummary {
  strategies: StrategyPerformance[];
  totals: { fills: number; closedTrades: number; totalRealizedPnl: number };
  note: string;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function round(n: number | null, dp: number): number | null {
  if (n === null) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function summarizeStrategies(rows: TradeLogRow[]): PerformanceSummary {
  const groups = new Map<string, TradeLogRow[]>();
  for (const r of rows) {
    const key = r.strategy_type ?? "manual";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const strategies: StrategyPerformance[] = [];
  for (const [key, g] of groups) {
    const closed = g.filter((r) => r.realized_pnl !== null);
    const pnls = closed.map((r) => Number(r.realized_pnl));
    const winPnls = pnls.filter((p) => p > 0);
    const lossPnls = pnls.filter((p) => p < 0);
    const grossWin = winPnls.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(lossPnls.reduce((a, b) => a + b, 0));

    const rates: number[] = [];
    const samples: number[] = [];
    for (const r of g) {
      const k = r.kpis as { historicalWinRatePct?: unknown; sampleSize?: unknown } | null;
      if (k && typeof k.historicalWinRatePct === "number") rates.push(k.historicalWinRatePct);
      if (k && typeof k.sampleSize === "number") samples.push(k.sampleSize);
    }
    const realizedRate = closed.length ? (winPnls.length / closed.length) * 100 : null;
    const backtested = mean(rates);

    strategies.push({
      key,
      label: g.find((r) => r.strategy_label)?.strategy_label ?? (key === "manual" ? "Manual trades (no strategy)" : key),
      source: g[0].source,
      fills: g.length,
      closedTrades: closed.length,
      wins: winPnls.length,
      losses: lossPnls.length,
      realizedWinRatePct: round(realizedRate, 1),
      totalRealizedPnl: round(pnls.reduce((a, b) => a + b, 0), 2) ?? 0,
      avgWin: round(mean(winPnls), 2),
      avgLoss: round(mean(lossPnls), 2),
      profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
      backtestedWinRatePct: round(backtested, 1),
      backtestedSampleSize: samples.length ? Math.round(Math.max(...samples)) : null,
      gapPct: realizedRate !== null && backtested !== null ? round(realizedRate - backtested, 1) : null,
      reliable: closed.length >= MIN_CLOSED_FOR_COMPARISON,
      lastTradeAt: g.reduce((m, r) => (r.logged_at > m ? r.logged_at : m), g[0].logged_at),
    });
  }

  strategies.sort((a, b) => b.fills - a.fills || a.key.localeCompare(b.key));
  return {
    strategies,
    totals: {
      fills: rows.length,
      closedTrades: strategies.reduce((a, s) => a + s.closedTrades, 0),
      totalRealizedPnl: round(strategies.reduce((a, s) => a + s.totalRealizedPnl, 0), 2) ?? 0,
    },
    note:
      `Paper results only, with simulated fills. Realized win rates under ${MIN_CLOSED_FOR_COMPARISON} closed trades are mostly noise, ` +
      "so they are shown but not ranked or compared as evidence that a strategy works or fails.",
  };
}
