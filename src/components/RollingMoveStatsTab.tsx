"use client";

import { useState } from "react";
import type { AssetClass, RollingMoveStatsResult } from "@/lib/agents/trading-agent/types";

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}%`;
}

export function RollingMoveStatsTab({ defaultTicker = "EUR/USD", defaultAssetClass = "forex" }: { defaultTicker?: string; defaultAssetClass?: AssetClass }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [assetClass, setAssetClass] = useState<AssetClass>(defaultAssetClass);
  const [result, setResult] = useState<RollingMoveStatsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rolling-move-stats?ticker=${encodeURIComponent(ticker.trim())}&assetClass=${assetClass}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load rolling move stats.");
      setResult(data as RollingMoveStatsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Real rolling 20/40/100-day move statistics, computed directly from actual daily bars — average up-day
        return and average down-day return are reported separately, not collapsed into one symmetric figure, since
        that asymmetry is exactly what a directional strategy needs to see.
      </p>

      <form onSubmit={run} className="flex gap-3">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. EUR/USD or AAPL"
          className="flex-1 px-4 py-2 text-sm"
          style={{ background: "var(--ink-900)", border: "1px solid var(--line)", color: "var(--text-0)", fontFamily: "var(--font-mono)" }}
        />
        <select
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          className="px-3 py-2 text-sm"
          style={{ background: "var(--ink-900)", border: "1px solid var(--line)", color: "var(--text-0)" }}
        >
          <option value="forex">Forex</option>
          <option value="equity">Equity</option>
          <option value="commodity">Commodity</option>
          <option value="future">Future</option>
          <option value="bond">Bond</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--signal)", color: "var(--ink-950)" }}
        >
          {loading ? "Computing…" : "Compute"}
        </button>
      </form>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="font-medium">Could not load rolling move stats</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {result && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                {["Window", "Trading Days", "Avg Up-Day", "Avg Down-Day", "Avg Absolute Move"].map((h) => (
                  <th key={h} className="text-left py-2 px-2" style={{ color: "var(--text-2)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.windows.map((w) => (
                <tr key={w.windowDays} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td className="py-2 px-2 font-medium">{w.windowDays}d</td>
                  <td className="py-2 px-2">{w.tradingDaysUsed}</td>
                  <td className="py-2 px-2" style={{ color: "var(--signal)" }}>
                    {fmtPct(w.avgUpDayPct)} <span style={{ color: "var(--text-2)" }}>({w.upDayCount})</span>
                  </td>
                  <td className="py-2 px-2" style={{ color: "var(--danger)" }}>
                    {fmtPct(w.avgDownDayPct)} <span style={{ color: "var(--text-2)" }}>({w.downDayCount})</span>
                  </td>
                  <td className="py-2 px-2">{fmtPct(w.avgAbsMovePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.dataLimitations.length > 0 && (
            <div className="flex flex-col gap-2 mt-4">
              {result.dataLimitations.map((d) => (
                <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                  <div className="text-sm" style={{ color: "var(--verdict)" }}>
                    {d}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
