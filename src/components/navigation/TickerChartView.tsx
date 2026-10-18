"use client";

import dynamic from "next/dynamic";
import { useAppNavigation } from "@/lib/navigation/app-navigation";
import type { AssetClass } from "@/lib/navigation/study-registry";
import { ChartNews } from "./ChartNews";
import { useChartAlert } from "./use-chart-alert";

// The chart library is heavy; it loads only when a ticker chart is actually shown.
const PriceChart = dynamic(() => import("@/components/PriceChart").then((m) => m.PriceChart), {
  loading: () => (
    <p role="status" className="text-sm" style={{ color: "var(--text-2)" }}>
      Loading chart…
    </p>
  ),
});

/**
 * The chart for one ticker, opened from the command palette or a ?ticker= link. The group's normal Charts tab (watchlist
 * quick-picks, symbol box) is still one click away through "Back to Charts".
 */
export function TickerChartView({ symbol, assetClass }: { symbol: string; assetClass: AssetClass }) {
  const nav = useAppNavigation();
  const onCreateAlert = useChartAlert();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button type="button" className="jv-btn-outline" style={{ minHeight: 44 }} onClick={() => nav.patch({ ticker: undefined })}>
          <span aria-hidden="true">←</span> Back to Charts
        </button>
        <h2 className="jv-title" style={{ fontSize: 20, margin: 0 }}>
          {symbol}
        </h2>
      </div>
      <PriceChart key={`${assetClass}:${symbol}`} symbol={symbol} assetClass={assetClass} onCreateAlert={onCreateAlert} />
      <ChartNews symbol={symbol} assetClass={assetClass} />
    </div>
  );
}
