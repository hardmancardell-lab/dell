"use client";

import { useCallback, useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { ORB_LOOKBACK_MONTH_OPTIONS } from "@/lib/agents/trading-agent/constants";
import { WatchlistSelector } from "./WatchlistSelector";
import type { AssetClass, OrbWatchlistSummary } from "@/lib/agents/trading-agent/types";

const RANGE_OPTIONS: (5 | 15 | 30)[] = [5, 15, 30];
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function fmtPrice(v: number | null): string {
  return v !== null ? `$${v.toFixed(2)}` : "N/A";
}

/** Reused across Equities/Currency/Futures/Commodities' own ORB Watchlist tabs — a single .jarvis island here upgrades all four. */
export function OrbWatchlistTab({ filterAssetClass = "equity" }: { filterAssetClass?: AssetClass }) {
  const { entries, hydrated } = useWatchlist();
  const scopedEntries = entries.filter((e) => e.assetClass === filterAssetClass);
  const [openingRangeMinutes, setOpeningRangeMinutes] = useState<5 | 15 | 30>(15);
  const [lookbackMonths, setLookbackMonths] = useState(3);
  const [summary, setSummary] = useState<OrbWatchlistSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoScanned, setAutoScanned] = useState(false);

  const runScan = useCallback(async () => {
    if (scopedEntries.length === 0) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/orb-watchlist-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: scopedEntries,
          openingRangeMinutes,
          lookbackMonths,
          allowedAssetClasses: [filterAssetClass],
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setSummary(json as OrbWatchlistSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedEntries.length, openingRangeMinutes, lookbackMonths, filterAssetClass]);

  useEffect(() => {
    if (hydrated && !autoScanned && scopedEntries.length > 0) {
      setAutoScanned(true);
      runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, autoScanned, scopedEntries.length]);

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Opening Range Breakout, backtested and tracked across every {filterAssetClass === "equity" ? "equity" : filterAssetClass} ticker on the
        watchlist at once. For the full 6-row breakdown of any one ticker (long/short ×
        30min/60min/hold-to-EOD), use the Ticker Detail tab.
      </p>

      {filterAssetClass === "forex" && (
        <div className="jv-card mb-4 text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
          The opening range is built around a single NYSE/Nasdaq session open (9:30am ET). Spot forex trades
          24/5 with no single daily open, so this concept doesn&apos;t map cleanly onto currency pairs — read
          these results as an approximation using 9:30am ET as an arbitrary anchor time, not a true
          session-open breakout the way it is for equities.
        </div>
      )}

      <WatchlistSelector />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="jv-label" style={{ marginBottom: 0 }}>Opening Range</span>
        {RANGE_OPTIONS.map((m) => (
          <button key={m} onClick={() => setOpeningRangeMinutes(m)} className={m === openingRangeMinutes ? "jv-btn" : "jv-btn-outline"} style={{ padding: "6px 14px" }}>
            {m}min
          </button>
        ))}
        <span className="jv-label ml-4" style={{ marginBottom: 0 }}>Lookback</span>
        {ORB_LOOKBACK_MONTH_OPTIONS.map((m) => (
          <button key={m} onClick={() => setLookbackMonths(m)} className={m === lookbackMonths ? "jv-btn" : "jv-btn-outline"} style={{ padding: "6px 14px" }}>
            {m}mo
          </button>
        ))}
      </div>

      {hydrated && scopedEntries.length === 0 && (
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          No {filterAssetClass} symbols on the watchlist — add some on the Dashboard tab first.
        </p>
      )}

      <button onClick={runScan} disabled={loading || scopedEntries.length === 0} className="jv-btn">
        {loading ? "Scanning…" : autoScanned ? "Refresh Scan" : "Scan Watchlist"}
      </button>

      {error && (
        <div className="jv-card mt-6" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-8 flex flex-col gap-6">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {summary.tickersScanned} scanned, {summary.tickersWithBreakoutToday} with a breakout today.
          </div>

          {summary.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className={TH_CLASS}>Symbol</th>
                  <th className={TH_CLASS}>Opening Range</th>
                  <th className={TH_CLASS}>Breakout Today</th>
                  <th className={TH_CLASS}>Long Hold-to-EOD</th>
                  <th className={TH_CLASS}>Short Hold-to-EOD</th>
                </tr>
              </thead>
              <tbody>
                {summary.results.map((r) => {
                  const longEod = r.orb?.horizons.find((h) => h.direction === "long" && h.horizonLabel === "holdToEod");
                  const shortEod = r.orb?.horizons.find((h) => h.direction === "short" && h.horizonLabel === "holdToEod");
                  return (
                    <tr key={r.symbol} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{r.symbol}</td>
                      {r.error ? (
                        <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }} colSpan={4}>
                          {r.error}
                        </td>
                      ) : (
                        <>
                          <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                            {fmtPrice(r.orb?.todaySnapshot?.openingRangeLow ?? null)} -{" "}
                            {fmtPrice(r.orb?.todaySnapshot?.openingRangeHigh ?? null)}
                          </td>
                          <td className={TD_CLASS}>
                            {r.orb?.todaySnapshot?.breakoutDirection && r.orb.todaySnapshot.breakoutDirection !== "none-yet" ? (
                              <span className={`jv-badge capitalize ${r.orb.todaySnapshot.breakoutDirection === "long" ? "c-signal" : "c-danger"}`}>
                                {r.orb.todaySnapshot.breakoutDirection}
                              </span>
                            ) : (
                              <span className="text-xs" style={{ color: "var(--text-2)" }}>
                                {r.orb?.todaySnapshot?.breakoutDirection === "none-yet" ? "none yet" : "N/A"}
                              </span>
                            )}
                          </td>
                          <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                            {longEod ? `${fmtPct(longEod.meanReturnPct)} (n=${longEod.sampleSize}, pass=${longEod.passesAllThreeBars ? "yes" : "no"})` : "N/A"}
                          </td>
                          <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                            {shortEod ? `${fmtPct(shortEod.meanReturnPct)} (n=${shortEod.sampleSize}, pass=${shortEod.passesAllThreeBars ? "yes" : "no"})` : "N/A"}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
