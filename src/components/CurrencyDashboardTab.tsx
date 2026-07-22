"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TradingDashboardTab } from "./TradingDashboardTab";
import { PriceChart } from "./PriceChart";
import { TickerNewsPanel } from "./TickerNewsPanel";
import { TOP_TRADED_PAIRS } from "@/lib/agents/trading-agent/skills/top-traded-pairs";
import type { CurrencyExpertAnalysisResult, ForexRatesSummary, FxCoverageSpikeSignal } from "@/lib/agents/trading-agent/types";

const POLL_INTERVAL_MS = 15_000;

export function CurrencyDashboardTab() {
  const [rates, setRates] = useState<ForexRatesSummary | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRates = useCallback(async () => {
    try {
      const res = await fetch("/api/forex-rates");
      const json = await res.json();
      if (!res.ok) {
        setRatesError(json.error ?? "Unknown error");
      } else {
        setRatesError(null);
        setRates(json as ForexRatesSummary);
      }
    } catch (err) {
      setRatesError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  // Client-side polling — this app is request-driven with no background
  // server process, so "live" here means refetching on an interval while
  // this tab is mounted, not a real push/websocket stream. Cleared on
  // unmount so navigating away stops the polling.
  useEffect(() => {
    loadRates();
    pollRef.current = setInterval(loadRates, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadRates]);

  const [results, setResults] = useState<FxCoverageSpikeSignal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [expertAnalysis, setExpertAnalysis] = useState<CurrencyExpertAnalysisResult | null>(null);
  const [expertLoading, setExpertLoading] = useState(false);
  const [expertError, setExpertError] = useState<string | null>(null);

  async function runExpertAnalysis() {
    if (!selectedPair) return;
    setExpertLoading(true);
    setExpertError(null);
    setExpertAnalysis(null);
    try {
      const res = await fetch(`/api/currency-expert-analysis?pair=${encodeURIComponent(selectedPair)}`);
      const json = await res.json();
      if (!res.ok) {
        setExpertError(json.error ?? "Unknown error");
      } else {
        setExpertAnalysis(json as CurrencyExpertAnalysisResult);
      }
    } catch (err) {
      setExpertError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExpertLoading(false);
    }
  }

  async function runCheck() {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/fx-coverage-spike");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setResults(json.results as FxCoverageSpikeSignal[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

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
          The 10 most-traded currency pairs, polling every 15 seconds while
          this tab is open (not a real push/websocket stream — see note
          below). Click a pair for a chart.
        </p>
        {ratesError && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
            {ratesError}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {TOP_TRADED_PAIRS.map((pair) => {
            const rate = rates?.rates.find((r) => r.pair === pair);
            return (
              <button
                key={pair}
                onClick={() => {
                  setSelectedPair(pair);
                  setExpertAnalysis(null);
                  setExpertError(null);
                }}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selectedPair === pair
                    ? "border-zinc-900 dark:border-zinc-100"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                <div className="text-xs font-medium text-zinc-500">{pair}</div>
                <div className="text-sm font-semibold mt-0.5">
                  {rate?.error ? (
                    <span className="text-xs text-zinc-400 font-normal">N/A</span>
                  ) : rate?.price !== null && rate?.price !== undefined ? (
                    rate.price.toFixed(4)
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
        {selectedPair && (
          <div className="mt-4">
            <PriceChart symbol={selectedPair} />
            <TickerNewsPanel symbol={selectedPair} assetClass="forex" />

            <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Expert Read &mdash; {selectedPair}</h3>
                <button
                  onClick={runExpertAnalysis}
                  disabled={expertLoading}
                  className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {expertLoading ? "Analyzing… (~10s)" : "Get Expert Read"}
                </button>
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                Real GDELT news headlines + real US rate context, synthesized by a PhD
                international-finance/macro persona &mdash; see the Macro Drivers tab for the
                underlying reference framework.
              </p>
              {expertError && (
                <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-red-700 dark:text-red-400 text-xs mb-3">
                  {expertError}
                </div>
              )}
              {expertAnalysis && (
                <div className="space-y-3">
                  {expertAnalysis.news.mechanismNote && (
                    <p className="text-xs text-zinc-500 italic">{expertAnalysis.news.mechanismNote}</p>
                  )}
                  {expertAnalysis.expertRead && (
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 text-sm whitespace-pre-wrap">
                      {expertAnalysis.expertRead}
                    </div>
                  )}
                  {expertAnalysis.news.articles.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-zinc-500 mb-1">Recent Headlines</div>
                      <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                        {expertAnalysis.news.articles.slice(0, 8).map((a) => (
                          <li key={a.url}>
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {a.title}
                            </a>
                            <span className="text-zinc-400"> &mdash; {a.domain}, {a.date}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-zinc-500">3-Month Treasury Yield</div>
                      <div className="font-medium">
                        {expertAnalysis.usRateContext.threeMonthYield
                          ? `${expertAnalysis.usRateContext.threeMonthYield.value.toFixed(2)}%`
                          : "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500">10Y-2Y Spread</div>
                      <div className="font-medium">
                        {expertAnalysis.usRateContext.yieldCurveSpread
                          ? `${expertAnalysis.usRateContext.yieldCurveSpread.value.toFixed(2)} pp`
                          : "N/A"}
                      </div>
                    </div>
                  </div>
                  {expertAnalysis.dataLimitations.map((d) => (
                    <div
                      key={d.slice(0, 30)}
                      className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
                    >
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">FX News Coverage Spike Check</h2>
          <button
            onClick={runCheck}
            disabled={loading}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {loading ? "Checking… (~30s)" : "Check FX News Signals"}
          </button>
        </div>
        <p className="text-sm text-zinc-500 mb-4">
          Checks each major pair&apos;s GDELT news-coverage volume against its
          7-day average, flagging a spike (&ge;3x) as a signal something is
          actively moving that pair. Runs on demand, not automatically on
          load — six sequential GDELT calls take roughly 30 seconds because
          of its rate limit.
        </p>
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
            {error}
          </div>
        )}
        {results && (
          <div className="space-y-2">
            {results.map((r) => (
              <div
                key={r.pair}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between"
              >
                <div className="font-medium text-sm">{r.pair}</div>
                {r.error ? (
                  <div className="text-sm text-zinc-500">{r.error}</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-500">
                      {r.multiple !== null ? `${r.multiple.toFixed(1)}x avg` : "N/A"}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        r.triggered
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {r.triggered ? "Spike" : "Normal"}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <TradingDashboardTab filterAssetClass="forex" />
    </div>
  );
}
