"use client";

import type { AssetClass } from "@/lib/agents/trading-agent/types";
import { TickerNewsPanel } from "@/components/TickerNewsPanel";

/**
 * The news shown directly under a ticker's chart. Every place that looks up a ticker and shows a chart (the Equities chart tab,
 * the per-asset Charts tabs, the Currency / Futures / Commodities dashboards, and the ticker chart opened from the command palette)
 * renders this one component, so the news follows the symbol and asset class everywhere and there is one place to change.
 *
 * Today it renders the existing TickerNewsPanel. When src/components/TickerNewsBelowChart.tsx (the News agent's component: takes a
 * symbol and an assetClass, with a slot for NewsImpactPanel) lands, swap the import and the JSX below; nothing else changes.
 *
 * It re-renders only when the symbol or asset class changes (the chart's own price updates live inside PriceChart and do not
 * re-render this component), so news is not refetched on chart ticks.
 */
export function ChartNews({ symbol, assetClass }: { symbol: string; assetClass: AssetClass }) {
  if (assetClass === "crypto") return null; // TickerNewsPanel has no crypto feed; TickerNewsBelowChart will.
  return <TickerNewsPanel key={`${assetClass}:${symbol}`} symbol={symbol} assetClass={assetClass} />;
}
