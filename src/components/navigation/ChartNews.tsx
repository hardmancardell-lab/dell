"use client";

import type { AssetClass } from "@/lib/agents/trading-agent/types";
import { TickerNewsBelowChart } from "@/components/TickerNewsBelowChart";

/**
 * The news shown directly under a ticker's chart. Every place that looks up a ticker and shows a chart (the Equities chart tab,
 * the per-asset Charts tabs, the Currency / Futures / Commodities dashboards, and the ticker chart opened from the command palette)
 * renders this one component, so the news follows the symbol and asset class everywhere and there is one place to change.
 *
 * It renders TickerNewsBelowChart: two labelled groups, "About this asset" and "Market and macro", chosen by the category map in
 * src/lib/news/category-map.ts. The News impact panel mounts through that component's `impactSlot` prop once it exists.
 *
 * It re-renders only when the symbol or asset class changes (the chart's own price updates live inside PriceChart and do not
 * re-render this component), and TickerNewsBelowChart fetches only on a symbol or class change, so chart ticks never refetch news.
 */
export function ChartNews({ symbol, assetClass }: { symbol: string; assetClass: AssetClass }) {
  return <TickerNewsBelowChart key={`${assetClass}:${symbol}`} symbol={symbol} assetClass={assetClass} />;
}
