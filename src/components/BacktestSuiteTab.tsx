"use client";

import { useState } from "react";
import { HistoricalBacktestTab } from "./HistoricalBacktestTab";
import { CalendarEffectsTab } from "./CalendarEffectsTab";
import { RollingMoveStatsTab } from "./RollingMoveStatsTab";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

type Mode = "backtest" | "calendar" | "rolling";

/**
 * Merges Backtest, Calendar Effects, and Rolling Move Stats into one tab
 * with an internal mode toggle — same pattern OrbStrategyTab already uses
 * for Watchlist/Ticker Detail. All three underlying components are reused
 * completely unchanged; this is a navigation/grouping change only.
 */
export function BacktestSuiteTab({
  assetClass = "forex",
  defaultTicker = "EUR/USD",
}: {
  assetClass?: AssetClass;
  defaultTicker?: string;
}) {
  const [mode, setMode] = useState<Mode>("backtest");

  return (
    <div className="jarvis" style={{ padding: 0, backgroundImage: "none", background: "transparent" }}>
      <div className="flex flex-wrap gap-2 mb-6">
        {(
          [
            ["backtest", "Signal Backtest"],
            ["calendar", "Calendar Effects"],
            ["rolling", "Rolling Move Stats"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} className={mode === m ? "jv-btn" : "jv-btn-outline"}>
            {label}
          </button>
        ))}
      </div>

      {mode === "backtest" && <HistoricalBacktestTab defaultTicker={defaultTicker} assetClass={assetClass} />}
      {mode === "calendar" && <CalendarEffectsTab defaultTicker={defaultTicker} assetClass={assetClass} />}
      {mode === "rolling" && <RollingMoveStatsTab defaultTicker={defaultTicker} defaultAssetClass={assetClass} />}
    </div>
  );
}
