import type { JournalFill, JournalInstrumentType, JournalPositionMetrics } from "@/lib/agents/trading-agent/types";

// Options are ×100 notional per contract, same convention as
// paper-trading-engine.ts's notionalMultiplier — shares are ×1.
export function journalMultiplier(instrumentType: JournalInstrumentType): number {
  return instrumentType === "shares" ? 1 : 100;
}

/**
 * Average-cost accounting over a position's fills, walked in chronological
 * order — the same convention paper-trading-engine.ts's applyFill uses for
 * PaperPosition. Supports averaging in (multiple buys) and partial exits
 * (multiple sells) correctly, unlike a single entry/exit price pair.
 *
 * R-multiple is computed at the position level: risk-per-unit is
 * |avgEntryPrice - stopLoss| using the average cost across ALL buy fills
 * (whether placed before or after any sells), and the risk base uses the
 * position's peak open quantity. This is a documented simplification when
 * lots are added at different times/prices with a moving stop — it treats
 * the position's realized R as "how many R was risked and made in total,"
 * not a per-lot breakdown.
 */
export function computeJournalPositionMetrics(
  fills: JournalFill[],
  instrumentType: JournalInstrumentType,
  stopLoss: number | null,
  currentPrice: number | null = null
): JournalPositionMetrics {
  const multiplier = journalMultiplier(instrumentType);
  const sorted = [...fills].sort((a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime());

  let openQuantity = 0;
  let avgEntryPrice = 0;
  let peakQuantity = 0;
  let realizedPnl = 0;
  let sellQty = 0;
  let sellNotional = 0;

  for (const fill of sorted) {
    if (fill.side === "buy") {
      const newQty = openQuantity + fill.quantity;
      avgEntryPrice = newQty > 0 ? (avgEntryPrice * openQuantity + fill.price * fill.quantity) / newQty : fill.price;
      openQuantity = newQty;
      peakQuantity = Math.max(peakQuantity, openQuantity);
    } else {
      realizedPnl += (fill.price - avgEntryPrice) * fill.quantity * multiplier;
      sellQty += fill.quantity;
      sellNotional += fill.price * fill.quantity;
      openQuantity -= fill.quantity;
    }
  }

  const avgExitPrice = sellQty > 0 ? sellNotional / sellQty : null;
  const costBasisOpen = openQuantity * avgEntryPrice * multiplier;

  let plannedRiskAmount: number | null = null;
  let realizedR: number | null = null;
  let unrealizedR: number | null = null;
  if (stopLoss !== null && peakQuantity > 0) {
    const riskPerUnit = Math.abs(avgEntryPrice - stopLoss);
    if (riskPerUnit > 0) {
      plannedRiskAmount = riskPerUnit * peakQuantity * multiplier;
      realizedR = plannedRiskAmount > 0 ? realizedPnl / plannedRiskAmount : null;
      if (currentPrice !== null && openQuantity > 0) {
        const unrealizedPnl = (currentPrice - avgEntryPrice) * openQuantity * multiplier;
        unrealizedR = unrealizedPnl / (riskPerUnit * openQuantity * multiplier);
      }
    }
  }

  return {
    openQuantity,
    avgEntryPrice: sorted.some((f) => f.side === "buy") ? avgEntryPrice : null,
    avgExitPrice,
    peakQuantity,
    costBasisOpen,
    realizedPnl,
    realizedR,
    plannedRiskAmount,
    unrealizedR,
  };
}
