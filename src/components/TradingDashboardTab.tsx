"use client";

import { useCallback, useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import { WatchlistSelector } from "./WatchlistSelector";
import type { AssetClass, WatchlistScanSummary } from "@/lib/agents/trading-agent/types";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="jv-label">{label}</div>
      <div className="jv-cond c-neutral" style={{ fontSize: 18 }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * Reused across every asset class's own Dashboard tab (Equities directly,
 * Bonds/Options/Currency/Futures/Commodities each embed this) — a single
 * .jarvis island here upgrades all six for free, even though the
 * surrounding page.tsx section shells and sibling tabs aren't redesigned
 * yet.
 */
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
    <div className="jarvis">
      <p className="jv-lede">
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
          className="jv-input flex-1 min-w-[180px]"
        />
        {!filterAssetClass && (
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)} className="jv-select">
            {ASSET_CLASSES.map((ac) => (
              <option key={ac} value={ac}>
                {assetClassLabel(ac)}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="jv-btn">
          Add
        </button>
      </form>

      {hydrated && filteredEntries.length === 0 && (
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Watchlist is empty — add a symbol above to get started.
        </p>
      )}

      {filteredEntries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {filteredEntries.map((e) => (
            <span key={`${e.symbol}-${e.assetClass}`} className="jv-chip">
              <span className="font-medium" style={{ color: "var(--text-0)" }}>
                {e.symbol}
              </span>
              <span style={{ color: "var(--text-2)" }}>{assetClassLabel(e.assetClass)}</span>
              <button onClick={() => removeEntry(e.symbol, e.assetClass)} aria-label={`Remove ${e.symbol} (${assetClassLabel(e.assetClass)})`}>
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <button onClick={runScan} disabled={loading || filteredEntries.length === 0} className="jv-btn">
        {loading ? "Scanning…" : autoScanned ? "Refresh Scan" : "Scan Watchlist"}
      </button>

      {error && (
        <div className="jv-card mt-6" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-8 flex flex-col gap-8">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {summary.tickersScanned} scanned, {summary.tickersFlagged} flagged.
          </div>

          {summary.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}

          <section>
            <div className="jv-strip-title">Volume Displacement ({volumeFlagged.length} flagged)</div>
            {volumeFlagged.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>
                No tickers crossed the volume threshold.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {volumeFlagged.map((r) => (
                  <div key={r.symbol} className="jv-card">
                    <div className="jv-br-b" />
                    <div className="text-sm font-mono font-medium mb-2" style={{ color: "var(--text-0)" }}>
                      {r.symbol} <span style={{ color: "var(--text-2)" }}>({assetClassLabel(r.assetClass)})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                        value={r.volumeDisplacement!.multiple !== null ? `${r.volumeDisplacement!.multiple.toFixed(1)}x` : "N/A"}
                        sub={`Threshold: ${r.volumeDisplacement!.threshold}x`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="jv-strip-title">Momentum ({momentumFlagged.length} flagged)</div>
            {momentumFlagged.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>
                No tickers had 3 green days with rising volume.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {momentumFlagged.map((r) => (
                  <div key={r.symbol} className="jv-card">
                    <div className="jv-br-b" />
                    <div className="text-sm font-mono font-medium mb-2" style={{ color: "var(--text-0)" }}>
                      {r.symbol} <span style={{ color: "var(--text-2)" }}>({assetClassLabel(r.assetClass)})</span>
                    </div>
                    <div className="text-sm" style={{ color: "var(--text-2)" }}>
                      Volumes (oldest to newest): {r.momentum!.volumes.map((v) => v.toLocaleString()).join(" → ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="jv-strip-title">Mean Reversion ({meanReversionFlagged.length} flagged)</div>
            <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
              Rolling z-score of price vs. its trailing 20-day mean — flags &plusmn;2 standard-deviation
              deviations as oversold/overbought. A statistical deviation, not a prediction — see the Backtest
              tab for whether reversion actually followed historically.
            </p>
            {meanReversionFlagged.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>
                No tickers crossed the &plusmn;2 z-score threshold.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {meanReversionFlagged.map((r) => (
                  <div key={r.symbol} className="jv-card">
                    <div className="jv-br-b" />
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-sm font-mono font-medium" style={{ color: "var(--text-0)" }}>
                        {r.symbol} <span style={{ color: "var(--text-2)" }}>({assetClassLabel(r.assetClass)})</span>
                      </div>
                      <span className={`jv-badge ${r.meanReversion!.direction === "oversold" ? "c-signal" : "c-danger"}`}>
                        {r.meanReversion!.direction}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              <div className="jv-strip-title">Failed to Scan</div>
              <div className="flex flex-col gap-1">
                {failed.map((r) => (
                  <div key={r.symbol} className="text-sm" style={{ color: "var(--text-2)" }}>
                    <span className="font-medium font-mono" style={{ color: "var(--text-1)" }}>
                      {r.symbol}
                    </span>
                    : {r.error}
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
