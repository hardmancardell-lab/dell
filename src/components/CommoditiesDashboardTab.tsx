"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TradingDashboardTab } from "./TradingDashboardTab";
import { PriceChart } from "./PriceChart";
import { TickerNewsPanel } from "./TickerNewsPanel";
import { TOP_TRADED_COMMODITIES } from "@/lib/agents/trading-agent/skills/top-traded-commodities";
import type { AssetRatesSummary } from "@/lib/agents/trading-agent/types";

const POLL_INTERVAL_MS = 15_000;

export function CommoditiesDashboardTab() {
  const [rates, setRates] = useState<AssetRatesSummary | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRates = useCallback(async () => {
    try {
      const res = await fetch("/api/commodity-rates");
      const json = await res.json();
      if (!res.ok) {
        setRatesError(json.error ?? "Unknown error");
      } else {
        setRatesError(null);
        setRates(json as AssetRatesSummary);
      }
    } catch (err) {
      setRatesError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  // Client-side polling — same pattern as CurrencyDashboardTab.tsx: this app
  // is request-driven with no background server process, so "live" here
  // means refetching on an interval while this tab is mounted.
  useEffect(() => {
    loadRates();
    pollRef.current = setInterval(loadRates, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadRates]);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Live Rates</h2>
          <span className="text-xs text-zinc-400">
            {rates ? `Updated ${new Date(rates.asOf).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <p className="text-sm text-zinc-500 mb-4">
          The 10 most-traded commodity ETF proxies, polling every 15 seconds while this tab is open (not a real
          push/websocket stream — see note below). Click one for a chart.
        </p>
        {ratesError && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
            {ratesError}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {TOP_TRADED_COMMODITIES.map((symbol) => {
            const rate = rates?.rates.find((r) => r.symbol === symbol);
            return (
              <button
                key={symbol}
                onClick={() => setSelectedSymbol(symbol)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selectedSymbol === symbol
                    ? "border-zinc-900 dark:border-zinc-100"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                <div className="text-xs font-medium text-zinc-500">{symbol}</div>
                <div className="text-sm font-semibold mt-0.5">
                  {rate?.error ? (
                    <span className="text-xs text-zinc-400 font-normal">N/A</span>
                  ) : rate?.price !== null && rate?.price !== undefined ? (
                    rate.price.toFixed(2)
                  ) : (
                    "…"
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {rates?.dataLimitations.map((d) => (
          <div
            key={d.slice(0, 30)}
            className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400 mb-2"
          >
            {d}
          </div>
        ))}
        {selectedSymbol && (
          <div className="mt-4">
            <PriceChart symbol={selectedSymbol} />
            <TickerNewsPanel symbol={selectedSymbol} assetClass="commodity" />
          </div>
        )}
      </section>

      <TradingDashboardTab filterAssetClass="commodity" />
    </div>
  );
}
