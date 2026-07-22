"use client";

import { useCallback, useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import { WatchlistSelector } from "./WatchlistSelector";
import type { AssetClass, WatchlistScanSummary } from "@/lib/agents/trading-agent/types";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

export function TradingDashboardTab({ filterAssetClass }: { filterAssetClass?: AssetClass } = {}) {
  const { entries, hydrated, addEntry, removeEntry } = useWatchlist();
  const [symbolInput, setSymbolInput] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>(filterAssetClass ?? "equity");

  const [summary, setSummary] = useState<WatchlistScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoScanned, setAutoScanned] = useState(false);

  const filteredEntries = filterAssetClass ? entries.filter((e) => e.assetClass === filterAssetClass) : entries;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    addEntry(symbolInput, filterAssetClass ?? assetClass);
    setSymbolInput("");
  }

  const runScan = useCallback(async () => {
    if (filteredEntries.length === 0) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/watchlist-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: filteredEntries }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setSummary(json as WatchlistScanSummary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filteredEntries]);

  useEffect(() => {
    if (hydrated && !autoScanned && filteredEntries.length > 0) {
      setAutoScanned(true);
      runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, autoScanned, filteredEntries.length]);

  const volumeFlagged = summary?.results.filter((r) => r.volumeDisplacement?.triggered) ?? [];
  const momentumFlagged = summary?.results.filter((r) => r.momentum?.triggered) ?? [];
  const meanReversionFlagged = summary?.results.filter((r) => r.meanReversion?.triggered) ?? [];
  const failed = summary?.results.filter((r) => r.error !== null) ?? [];

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        {filterAssetClass
          ? `Add ${assetClassLabel(filterAssetClass).toLowerCase()} symbols, then scan for three signals: Volume Displacement (today's volume vs. its trailing average), Momentum (3 consecutive green closes with rising volume), and Mean Reversion (price deviation from its rolling mean). This dashboard scans automatically when it loads.`
          : "Add symbols across any asset class, then scan the watchlist for three signals: Volume Displacement (today's volume vs. its trailing average), Momentum (3 consecutive green closes with rising volume), and Mean Reversion (price deviation from its rolling mean)."}
      </p>

      <WatchlistSelector />

      <form onSubmit={handleAdd} className="flex flex-wrap gap-3 mb-4">
        <input
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          placeholder="Symbol, e.g. AAPL, /ES, EUR/USD"
          className="flex-1 min-w-[180px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        {!filterAssetClass && (
          <select
            value={assetClass}
            onChange={(e) => setAssetClass(e.target.value as AssetClass)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
          >
            {ASSET_CLASSES.map((ac) => (
              <option key={ac} value={ac}>
                {assetClassLabel(ac)}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium"
        >
          Add
        </button>
      </form>

      {hydrated && filteredEntries.length === 0 && (
        <p className="text-sm text-zinc-500 mb-4">Watchlist is empty — add a symbol above to get started.</p>
      )}

      {filteredEntries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {filteredEntries.map((e) => (
            <span
              key={`${e.symbol}-${e.assetClass}`}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-sm"
            >
              <span className="font-medium">{e.symbol}</span>
              <span className="text-xs text-zinc-500">{assetClassLabel(e.assetClass)}</span>
              <button
                onClick={() => removeEntry(e.symbol, e.assetClass)}
                className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                aria-label={`Remove ${e.symbol} (${assetClassLabel(e.assetClass)})`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        onClick={runScan}
        disabled={loading || filteredEntries.length === 0}
        className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Scanning…" : autoScanned ? "Refresh Scan" : "Scan Watchlist"}
      </button>

      {error && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-8 space-y-8">
          <div className="text-sm text-zinc-500">
            {summary.tickersScanned} scanned, {summary.tickersFlagged} flagged.
          </div>

          {summary.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}

          <section>
            <h2 className="text-lg font-semibold mb-3">
              Volume Displacement ({volumeFlagged.length} flagged)
            </h2>
            {volumeFlagged.length === 0 ? (
              <p className="text-sm text-zinc-500">No tickers crossed the volume threshold.</p>
            ) : (
              <div className="space-y-3">
                {volumeFlagged.map((r) => (
                  <div key={r.symbol} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                    <div className="font-medium text-sm mb-2">
                      {r.symbol} <span className="text-xs text-zinc-500">({assetClassLabel(r.assetClass)})</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <StatCard label="Today's Volume" value={r.volumeDisplacement!.todayVolume.toLocaleString()} />
                      <StatCard
                        label="Rolling Average"
                        value={
                          r.volumeDisplacement!.rollingAverageVolume !== null
                            ? Math.round(r.volumeDisplacement!.rollingAverageVolume).toLocaleString()
                            : "N/A"
                        }
                      />
                      <StatCard
                        label="Multiple"
                        value={
                          r.volumeDisplacement!.multiple !== null
                            ? `${r.volumeDisplacement!.multiple.toFixed(1)}x`
                            : "N/A"
                        }
                        sub={`Threshold: ${r.volumeDisplacement!.threshold}x`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">Momentum ({momentumFlagged.length} flagged)</h2>
            {momentumFlagged.length === 0 ? (
              <p className="text-sm text-zinc-500">No tickers had 3 green days with rising volume.</p>
            ) : (
              <div className="space-y-3">
                {momentumFlagged.map((r) => (
                  <div key={r.symbol} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                    <div className="font-medium text-sm mb-2">
                      {r.symbol} <span className="text-xs text-zinc-500">({assetClassLabel(r.assetClass)})</span>
                    </div>
                    <div className="text-sm text-zinc-500">
                      Volumes (oldest to newest): {r.momentum!.volumes.map((v) => v.toLocaleString()).join(" → ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">
              Mean Reversion ({meanReversionFlagged.length} flagged)
            </h2>
            <p className="text-xs text-zinc-500 mb-3">
              Rolling z-score of price vs. its trailing 20-day mean — flags
              &plusmn;2 standard-deviation deviations as oversold/overbought.
              A statistical deviation, not a prediction — see the Backtest
              tab for whether reversion actually followed historically.
            </p>
            {meanReversionFlagged.length === 0 ? (
              <p className="text-sm text-zinc-500">No tickers crossed the &plusmn;2 z-score threshold.</p>
            ) : (
              <div className="space-y-3">
                {meanReversionFlagged.map((r) => (
                  <div key={r.symbol} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm">
                        {r.symbol} <span className="text-xs text-zinc-500">({assetClassLabel(r.assetClass)})</span>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          r.meanReversion!.direction === "oversold"
                            ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                            : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
                        }`}
                      >
                        {r.meanReversion!.direction}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <StatCard
                        label="Z-Score"
                        value={r.meanReversion!.zScore !== null ? r.meanReversion!.zScore.toFixed(2) : "N/A"}
                        sub={`Threshold: ±${r.meanReversion!.threshold}`}
                      />
                      <StatCard label="Price" value={`$${r.meanReversion!.price.toFixed(2)}`} />
                      <StatCard
                        label="Rolling Mean"
                        value={r.meanReversion!.rollingMean !== null ? `$${r.meanReversion!.rollingMean.toFixed(2)}` : "N/A"}
                        sub={`${r.meanReversion!.lookbackDays}-day`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {failed.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">Failed to Scan</h2>
              <div className="space-y-2">
                {failed.map((r) => (
                  <div key={r.symbol} className="text-sm text-zinc-500">
                    <span className="font-medium">{r.symbol}</span>: {r.error}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
