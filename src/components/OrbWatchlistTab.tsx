"use client";

import { useCallback, useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { ORB_LOOKBACK_MONTH_OPTIONS } from "@/lib/agents/trading-agent/constants";
import { WatchlistSelector } from "./WatchlistSelector";
import type { AssetClass, OrbWatchlistSummary } from "@/lib/agents/trading-agent/types";

const RANGE_OPTIONS: (5 | 15 | 30)[] = [5, 15, 30];

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function fmtPrice(v: number | null): string {
  return v !== null ? `$${v.toFixed(2)}` : "N/A";
}

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
    <div>
      <p className="text-zinc-500 mb-6">
        Opening Range Breakout, backtested and tracked across every {filterAssetClass === "equity" ? "equity" : filterAssetClass} ticker on the
        watchlist at once. For the full 6-row breakdown of any one ticker (long/short ×
        30min/60min/hold-to-EOD), use the Ticker Detail tab.
      </p>

      {filterAssetClass === "forex" && (
        <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400 mb-4">
          The opening range is built around a single NYSE/Nasdaq session open (9:30am ET). Spot
          forex trades 24/5 with no single daily open, so this concept doesn&apos;t map cleanly
          onto currency pairs — read these results as an approximation using 9:30am ET as an
          arbitrary anchor time, not a true session-open breakout the way it is for equities.
        </div>
      )}

      <WatchlistSelector />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Opening Range</span>
        {RANGE_OPTIONS.map((m) => (
          <button
            key={m}
            onClick={() => setOpeningRangeMinutes(m)}
            className={`rounded-lg px-3 py-1 text-xs font-medium ${
              m === openingRangeMinutes
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {m}min
          </button>
        ))}
        <span className="text-xs uppercase tracking-wide text-zinc-500 ml-4">Lookback</span>
        {ORB_LOOKBACK_MONTH_OPTIONS.map((m) => (
          <button
            key={m}
            onClick={() => setLookbackMonths(m)}
            className={`rounded-lg px-3 py-1 text-xs font-medium ${
              m === lookbackMonths
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {m}mo
          </button>
        ))}
      </div>

      {hydrated && scopedEntries.length === 0 && (
        <p className="text-sm text-zinc-500 mb-4">No {filterAssetClass} symbols on the watchlist — add some on the Dashboard tab first.</p>
      )}

      <button
        onClick={runScan}
        disabled={loading || scopedEntries.length === 0}
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
        <div className="mt-8 space-y-6">
          <div className="text-sm text-zinc-500">
            {summary.tickersScanned} scanned, {summary.tickersWithBreakoutToday} with a breakout today.
          </div>

          {summary.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Opening Range</th>
                  <th className="py-2 pr-4">Breakout Today</th>
                  <th className="py-2 pr-4">Long Hold-to-EOD</th>
                  <th className="py-2 pr-4">Short Hold-to-EOD</th>
                </tr>
              </thead>
              <tbody>
                {summary.results.map((r) => {
                  const longEod = r.orb?.horizons.find((h) => h.direction === "long" && h.horizonLabel === "holdToEod");
                  const shortEod = r.orb?.horizons.find((h) => h.direction === "short" && h.horizonLabel === "holdToEod");
                  return (
                    <tr key={r.symbol} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-medium">{r.symbol}</td>
                      {r.error ? (
                        <td className="py-2 pr-4 text-zinc-500 text-xs" colSpan={4}>
                          {r.error}
                        </td>
                      ) : (
                        <>
                          <td className="py-2 pr-4 text-zinc-500">
                            {fmtPrice(r.orb?.todaySnapshot?.openingRangeLow ?? null)} -{" "}
                            {fmtPrice(r.orb?.todaySnapshot?.openingRangeHigh ?? null)}
                          </td>
                          <td className="py-2 pr-4">
                            {r.orb?.todaySnapshot?.breakoutDirection && r.orb.todaySnapshot.breakoutDirection !== "none-yet" ? (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                                  r.orb.todaySnapshot.breakoutDirection === "long"
                                    ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                                    : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
                                }`}
                              >
                                {r.orb.todaySnapshot.breakoutDirection}
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-500">
                                {r.orb?.todaySnapshot?.breakoutDirection === "none-yet" ? "none yet" : "N/A"}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-zinc-500">
                            {longEod ? `${fmtPct(longEod.meanReturnPct)} (n=${longEod.sampleSize}, pass=${longEod.passesAllThreeBars ? "yes" : "no"})` : "N/A"}
                          </td>
                          <td className="py-2 pr-4 text-zinc-500">
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
