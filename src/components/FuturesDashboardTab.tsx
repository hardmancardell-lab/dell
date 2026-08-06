"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TradingDashboardTab } from "./TradingDashboardTab";
import { PriceChart } from "./PriceChart";
import { TickerNewsPanel } from "./TickerNewsPanel";
import { TOP_TRADED_FUTURES_PROXIES } from "@/lib/agents/trading-agent/skills/top-traded-futures-proxies";
import type { AssetRatesSummary } from "@/lib/agents/trading-agent/types";

const POLL_INTERVAL_MS = 15_000;

export function FuturesDashboardTab() {
  const [rates, setRates] = useState<AssetRatesSummary | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRates = useCallback(async () => {
    try {
      const res = await fetch("/api/futures-rates");
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
    <div className="jarvis flex flex-col gap-10">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="jv-title" style={{ fontSize: 16, marginBottom: 0 }}>Live Rates</h2>
          <span className="text-xs" style={{ color: "var(--text-2)" }}>
            {rates ? `Updated ${new Date(rates.asOf).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <p className="jv-lede" style={{ marginBottom: 16 }}>
          The 10 most-watched futures-market exposures (equity index, rates, energy, metals, agriculture) via real
          ETF proxies — not literal futures contracts, since no free source exists for those anywhere (see note
          below). Polling every 15 seconds while this tab is open. Click one for a chart.
        </p>
        {ratesError && (
          <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            <div className="text-sm">{ratesError}</div>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {TOP_TRADED_FUTURES_PROXIES.map((symbol) => {
            const rate = rates?.rates.find((r) => r.symbol === symbol);
            return (
              <button
                key={symbol}
                onClick={() => setSelectedSymbol(symbol)}
                className="text-left p-3"
                style={{
                  border: "1px solid",
                  borderColor: selectedSymbol === symbol ? "var(--line-bright)" : "var(--line)",
                  background: "var(--ink-900)",
                }}
              >
                <div className="text-xs font-medium" style={{ color: "var(--text-2)" }}>{symbol}</div>
                <div className="text-sm font-semibold mt-0.5" style={{ color: "var(--text-0)", fontFamily: "var(--font-mono)" }}>
                  {rate?.error ? (
                    <span className="text-xs font-normal" style={{ color: "var(--text-2)" }}>N/A</span>
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
          <div key={d.slice(0, 30)} className="jv-card text-xs mb-2" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
            {d}
          </div>
        ))}
        {selectedSymbol && (
          <div className="mt-4">
            <PriceChart symbol={selectedSymbol} assetClass="future" />
            <TickerNewsPanel symbol={selectedSymbol} assetClass="future" />
          </div>
        )}
      </section>

      <TradingDashboardTab filterAssetClass="future" />
    </div>
  );
}
