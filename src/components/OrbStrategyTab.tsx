"use client";

import { useState } from "react";
import { OrbWatchlistTab } from "./OrbWatchlistTab";
import { OrbDetailTab } from "./OrbDetailTab";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

type Mode = "watchlist" | "detail";

/**
 * Merges the two previously-separate ORB tabs (Watchlist and Ticker Detail)
 * into one, with an internal mode toggle — same pattern CalendarEffectsTab.tsx
 * already uses for its Day-of-Week/Time-of-Day/Single-Weekday modes. Both
 * underlying components are reused completely unchanged; this is purely a
 * navigation/grouping change, not a rewrite of either.
 */
export function OrbStrategyTab({
  filterAssetClass = "equity",
  defaultTicker = "AAPL",
}: {
  filterAssetClass?: AssetClass;
  defaultTicker?: string;
}) {
  const [mode, setMode] = useState<Mode>("watchlist");

  return (
    <div className="jarvis" style={{ padding: 0, backgroundImage: "none", background: "transparent" }}>
      <div className="flex flex-wrap gap-2 mb-6">
        {(
          [
            ["watchlist", "Watchlist"],
            ["detail", "Ticker Detail"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} className={mode === m ? "jv-btn" : "jv-btn-outline"}>
            {label}
          </button>
        ))}
      </div>

      {mode === "watchlist" ? (
        <OrbWatchlistTab filterAssetClass={filterAssetClass} />
      ) : (
        <OrbDetailTab defaultTicker={defaultTicker} />
      )}
    </div>
  );
}
