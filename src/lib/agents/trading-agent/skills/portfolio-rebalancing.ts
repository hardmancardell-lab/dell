import type { AssetClass, AssetClassRebalancingRow, AssetClassRebalancingTarget, RebalancingRow, RebalancingTarget } from "../types";
import { assetClassLabel } from "../asset-class-label";

/**
 * Pure math, zero I/O — client-safe (same pattern as strategy-scanner.ts):
 * given each holding's current value and a set of target weights, computes
 * the dollar (and, where a price is known, share-count) delta needed to
 * hit target. Doesn't place trades — this app has no order-execution code
 * anywhere — just sizes them.
 */
export function computeRebalancing(
  currentValues: { symbol: string; currentValue: number; currentPrice: number | null }[],
  targets: RebalancingTarget[]
): RebalancingRow[] {
  const totalValue = currentValues.reduce((s, v) => s + v.currentValue, 0);
  const targetBySymbol = new Map(targets.map((t) => [t.symbol, t.targetPercent]));

  return currentValues.map((v): RebalancingRow => {
    const targetPercent = targetBySymbol.get(v.symbol) ?? 0;
    const currentPercent = totalValue > 0 ? (v.currentValue / totalValue) * 100 : 0;
    const targetValue = (targetPercent / 100) * totalValue;
    const deltaValue = targetValue - v.currentValue;
    const deltaShares = v.currentPrice && v.currentPrice > 0 ? deltaValue / v.currentPrice : null;
    // A small dead-band avoids flagging "buy $0.03" as an action on rounding noise.
    const action: RebalancingRow["action"] = Math.abs(deltaValue) < 1 ? "hold" : deltaValue > 0 ? "buy" : "sell";

    return { symbol: v.symbol, currentValue: v.currentValue, currentPercent, targetPercent, targetValue, deltaValue, deltaShares, action };
  });
}

/**
 * Same pure math as computeRebalancing above, one level up: a target here is
 * a whole asset class (e.g. "60% bonds"), not a single symbol — no share
 * count, since a class isn't one priced instrument. Meant to be used
 * alongside computeRebalancing, not instead of it: this sizes the top-level
 * mix (stocks vs. bonds vs. cash-equivalents, etc.), and the per-symbol tool
 * still handles which specific holdings make up each class's share.
 */
export function computeAssetClassRebalancing(
  currentValuesByClass: { assetClass: AssetClass; currentValue: number }[],
  targets: AssetClassRebalancingTarget[]
): AssetClassRebalancingRow[] {
  const totalValue = currentValuesByClass.reduce((s, v) => s + v.currentValue, 0);
  const targetByClass = new Map(targets.map((t) => [t.assetClass, t.targetPercent]));

  return currentValuesByClass.map((v): AssetClassRebalancingRow => {
    const targetPercent = targetByClass.get(v.assetClass) ?? 0;
    const currentPercent = totalValue > 0 ? (v.currentValue / totalValue) * 100 : 0;
    const targetValue = (targetPercent / 100) * totalValue;
    const deltaValue = targetValue - v.currentValue;
    // Same dead-band as the per-symbol version, avoids flagging rounding noise as an action.
    const action: AssetClassRebalancingRow["action"] = Math.abs(deltaValue) < 1 ? "hold" : deltaValue > 0 ? "buy" : "sell";

    return {
      assetClass: v.assetClass,
      label: assetClassLabel(v.assetClass),
      currentValue: v.currentValue,
      currentPercent,
      targetPercent,
      targetValue,
      deltaValue,
      action,
    };
  });
}
