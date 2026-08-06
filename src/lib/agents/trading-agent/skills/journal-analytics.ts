import { computeJournalPositionMetrics } from "./journal-log";
import { mean } from "@/lib/agents/trading-agent/stats";
import type {
  JournalAnalytics,
  JournalDayOfWeekBreakdown,
  JournalEmotionBreakdown,
  JournalEquityCurvePoint,
  JournalMistakeFrequency,
  JournalPosition,
  JournalStrategyBreakdown,
} from "@/lib/agents/trading-agent/types";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ClosedRow {
  position: JournalPosition;
  realizedPnl: number;
  realizedR: number | null;
  closedAt: string;
}

function buildClosedRows(positions: JournalPosition[]): ClosedRow[] {
  return positions
    .filter((p) => p.status === "closed" && p.closedAt)
    .map((p) => {
      const metrics = computeJournalPositionMetrics(p.fills, p.instrumentType, p.stopLoss);
      return { position: p, realizedPnl: metrics.realizedPnl, realizedR: metrics.realizedR, closedAt: p.closedAt! };
    })
    .sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
}

/**
 * Aggregate stats across every closed position — the "data analyst" layer
 * on top of journal-log.ts's per-position math. Every figure is derived
 * live from real fills, never stored, so it can never drift.
 */
export function computeJournalAnalytics(positions: JournalPosition[]): JournalAnalytics {
  const dataLimitations: string[] = [];
  const closed = buildClosedRows(positions);

  if (closed.length === 0) {
    return {
      closedCount: 0,
      winRate: null,
      expectancyR: null,
      profitFactorR: null,
      avgWinR: null,
      avgLossR: null,
      totalRealizedPnl: 0,
      currentStreak: { type: null, count: 0 },
      byStrategy: [],
      byDayOfWeek: [],
      byEmotion: [],
      mistakeFrequency: [],
      equityCurve: [],
      maxDrawdownPct: null,
      planAdherenceRate: null,
      noStopRate: null,
      dataLimitations: ["No closed positions yet — analytics fill in once you close trades."],
    };
  }

  const withR = closed.filter((c) => c.realizedR !== null) as (ClosedRow & { realizedR: number })[];
  const noStopCount = closed.length - withR.length;
  if (noStopCount > 0) {
    dataLimitations.push(
      `${noStopCount} of ${closed.length} closed position(s) had no stop-loss set, so R-multiple couldn't be computed for them — they're excluded from expectancy/profit-factor but still count in win rate and total P&L.`
    );
  }

  const totalRealizedPnl = closed.reduce((sum, c) => sum + c.realizedPnl, 0);
  const wins = closed.filter((c) => c.realizedPnl > 0);
  const winRate = (wins.length / closed.length) * 100;

  const winRs = withR.filter((c) => c.realizedR > 0).map((c) => c.realizedR);
  const lossRs = withR.filter((c) => c.realizedR <= 0).map((c) => c.realizedR);
  const expectancyR = withR.length > 0 ? mean(withR.map((c) => c.realizedR)) : null;
  const avgWinR = winRs.length > 0 ? mean(winRs) : null;
  const avgLossR = lossRs.length > 0 ? mean(lossRs) : null;
  const sumWinR = winRs.reduce((s, r) => s + r, 0);
  const sumLossR = lossRs.reduce((s, r) => s + r, 0);
  const profitFactorR = sumLossR < 0 ? sumWinR / Math.abs(sumLossR) : null;

  // Current streak — walk backward from the most recently closed trade.
  let streakType: "win" | "loss" | null = null;
  let streakCount = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const isWin = closed[i].realizedPnl > 0;
    const type = isWin ? "win" : "loss";
    if (streakType === null) {
      streakType = type;
      streakCount = 1;
    } else if (type === streakType) {
      streakCount++;
    } else {
      break;
    }
  }

  // By strategy
  const strategyMap = new Map<string, ClosedRow[]>();
  for (const c of closed) {
    const key = c.position.strategy === "other" && c.position.strategyOther ? c.position.strategyOther : c.position.strategy;
    if (!strategyMap.has(key)) strategyMap.set(key, []);
    strategyMap.get(key)!.push(c);
  }
  const byStrategy: JournalStrategyBreakdown[] = Array.from(strategyMap.entries()).map(([strategy, rows]) => {
    const rowsWithR = rows.filter((r) => r.realizedR !== null).map((r) => r.realizedR!);
    return {
      strategy,
      count: rows.length,
      winRate: (rows.filter((r) => r.realizedPnl > 0).length / rows.length) * 100,
      expectancyR: rowsWithR.length > 0 ? mean(rowsWithR) : null,
      totalRealizedPnl: rows.reduce((s, r) => s + r.realizedPnl, 0),
    };
  });

  // By day of week — closedAt is a full ISO timestamp, so getUTCDay() directly
  // is safe (no date-only-string local-timezone reinterpretation risk here).
  const dowMap = new Map<number, ClosedRow[]>();
  for (const c of closed) {
    const dow = new Date(c.closedAt).getUTCDay();
    if (!dowMap.has(dow)) dowMap.set(dow, []);
    dowMap.get(dow)!.push(c);
  }
  const byDayOfWeek: JournalDayOfWeekBreakdown[] = Array.from(dowMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([dow, rows]) => {
      const rowsWithR = rows.filter((r) => r.realizedR !== null).map((r) => r.realizedR!);
      return {
        dayOfWeek: DAY_LABELS[dow],
        count: rows.length,
        winRate: (rows.filter((r) => r.realizedPnl > 0).length / rows.length) * 100,
        avgR: rowsWithR.length > 0 ? mean(rowsWithR) : null,
      };
    });

  // By emotion
  const emotionMap = new Map<string, ClosedRow[]>();
  for (const c of closed) {
    const key = c.position.emotionTag ?? "untagged";
    if (!emotionMap.has(key)) emotionMap.set(key, []);
    emotionMap.get(key)!.push(c);
  }
  const byEmotion: JournalEmotionBreakdown[] = Array.from(emotionMap.entries()).map(([emotion, rows]) => {
    const rowsWithR = rows.filter((r) => r.realizedR !== null).map((r) => r.realizedR!);
    return {
      emotion,
      count: rows.length,
      winRate: (rows.filter((r) => r.realizedPnl > 0).length / rows.length) * 100,
      avgR: rowsWithR.length > 0 ? mean(rowsWithR) : null,
    };
  });

  // Mistake frequency
  const mistakeMap = new Map<string, ClosedRow[]>();
  for (const c of closed) {
    for (const tag of c.position.mistakeTags) {
      if (!mistakeMap.has(tag)) mistakeMap.set(tag, []);
      mistakeMap.get(tag)!.push(c);
    }
  }
  const mistakeFrequency: JournalMistakeFrequency[] = Array.from(mistakeMap.entries())
    .map(([mistake, rows]) => ({
      mistake,
      count: rows.length,
      totalPnlImpact: rows.reduce((s, r) => s + r.realizedPnl, 0),
    }))
    .sort((a, b) => b.count - a.count);

  // Equity curve + drawdown (as % of peak cumulative profit reached — this
  // app doesn't track a real starting account balance, so a dollar-based
  // peak-to-trough is used rather than assuming one).
  let cumulative = 0;
  const equityCurve: JournalEquityCurvePoint[] = closed.map((c) => {
    cumulative += c.realizedPnl;
    return { date: c.closedAt, cumulativePnl: cumulative };
  });
  let peak = -Infinity;
  let maxDrawdownPct: number | null = null;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.cumulativePnl);
    if (peak > 0) {
      const dd = ((peak - point.cumulativePnl) / peak) * 100;
      maxDrawdownPct = maxDrawdownPct === null ? dd : Math.max(maxDrawdownPct, dd);
    }
  }
  if (peak <= 0) dataLimitations.push("Cumulative P&L has never gone positive yet, so drawdown-from-peak isn't meaningful.");

  const withFollowedPlan = closed.filter((c) => c.position.followedPlan !== null);
  const planAdherenceRate =
    withFollowedPlan.length > 0 ? (withFollowedPlan.filter((c) => c.position.followedPlan === true).length / withFollowedPlan.length) * 100 : null;
  const noStopRate = (noStopCount / closed.length) * 100;
  if (noStopRate > 0) {
    dataLimitations.push(`${noStopRate.toFixed(0)}% of closed trades had no stop-loss set at entry — a real risk-management gap worth closing.`);
  }

  return {
    closedCount: closed.length,
    winRate,
    expectancyR,
    profitFactorR,
    avgWinR,
    avgLossR,
    totalRealizedPnl,
    currentStreak: { type: streakType, count: streakCount },
    byStrategy,
    byDayOfWeek,
    byEmotion,
    mistakeFrequency,
    equityCurve,
    maxDrawdownPct,
    planAdherenceRate,
    noStopRate,
    dataLimitations,
  };
}
