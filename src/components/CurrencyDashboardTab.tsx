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
    <div className="jarvis flex flex-col gap-10">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="jv-title" style={{ fontSize: 16, marginBottom: 0 }}>Live Rates</h2>
          <span className="text-xs" style={{ color: "var(--text-2)" }}>
            {rates ? `Updated ${new Date(rates.asOf).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <p className="jv-lede" style={{ marginBottom: 16 }}>
          The 10 most-traded currency pairs, polling every 15 seconds while
          this tab is open (not a real push/websocket stream — see note
          below). Click a pair for a chart.
        </p>
        {ratesError && (
          <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            <div className="text-sm">{ratesError}</div>
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
                className="text-left p-3"
                style={{
                  border: "1px solid",
                  borderColor: selectedPair === pair ? "var(--line-bright)" : "var(--line)",
                  background: "var(--ink-900)",
                }}
              >
                <div className="text-xs font-medium" style={{ color: "var(--text-2)" }}>{pair}</div>
                <div className="text-sm font-semibold mt-0.5" style={{ color: "var(--text-0)", fontFamily: "var(--font-mono)" }}>
                  {rate?.error ? (
                    <span className="text-xs font-normal" style={{ color: "var(--text-2)" }}>N/A</span>
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
          <div key={d.slice(0, 30)} className="jv-card text-xs mb-2" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
            {d}
          </div>
        ))}
        {selectedPair && (
          <div className="mt-4">
            <PriceChart symbol={selectedPair} assetClass="forex" />
            <TickerNewsPanel symbol={selectedPair} assetClass="forex" />

            <div className="mt-4 jv-card">
              <div className="jv-br-b" />
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>Expert Read &mdash; {selectedPair}</h3>
                <button
                  onClick={runExpertAnalysis}
                  disabled={expertLoading}
                  className="jv-btn"
                  style={{ padding: "6px 14px", fontSize: 12 }}
                >
                  {expertLoading ? "Analyzing… (~10s)" : "Get Expert Read"}
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                Real GDELT news headlines + real US rate context, synthesized by a PhD
                international-finance/macro persona &mdash; see the Macro Drivers tab for the
                underlying reference framework.
              </p>
              {expertError && (
                <div className="jv-card mb-3" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                  <div className="text-xs">{expertError}</div>
                </div>
              )}
              {expertAnalysis && (
                <div className="flex flex-col gap-3">
                  {expertAnalysis.news.mechanismNote && (
                    <p className="text-xs italic" style={{ color: "var(--text-2)" }}>{expertAnalysis.news.mechanismNote}</p>
                  )}
                  {expertAnalysis.expertRead && (
                    <div className="text-sm whitespace-pre-wrap p-3" style={{ background: "var(--ink-800)", color: "var(--text-0)" }}>
                      {expertAnalysis.expertRead}
                    </div>
                  )}
                  {expertAnalysis.news.articles.length > 0 && (
                    <div>
                      <div className="jv-label" style={{ marginBottom: 4 }}>Recent Headlines</div>
                      <ul className="text-xs flex flex-col gap-1" style={{ color: "var(--text-1)" }}>
                        {expertAnalysis.news.articles.slice(0, 8).map((a) => (
                          <li key={a.url}>
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {a.title}
                            </a>
                            <span style={{ color: "var(--text-2)" }}> &mdash; {a.domain}, {a.date}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div style={{ color: "var(--text-2)" }}>3-Month Treasury Yield</div>
                      <div className="font-medium" style={{ color: "var(--text-0)", fontFamily: "var(--font-mono)" }}>
                        {expertAnalysis.usRateContext.threeMonthYield
                          ? `${expertAnalysis.usRateContext.threeMonthYield.value.toFixed(2)}%`
                          : "N/A"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-2)" }}>10Y-2Y Spread</div>
                      <div className="font-medium" style={{ color: "var(--text-0)", fontFamily: "var(--font-mono)" }}>
                        {expertAnalysis.usRateContext.yieldCurveSpread
                          ? `${expertAnalysis.usRateContext.yieldCurveSpread.value.toFixed(2)} pp`
                          : "N/A"}
                      </div>
                    </div>
                  </div>
                  {expertAnalysis.dataLimitations.map((d) => (
                    <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
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
          <h2 className="jv-title" style={{ fontSize: 16, marginBottom: 0 }}>FX News Coverage Spike Check</h2>
          <button
            onClick={runCheck}
            disabled={loading}
            className="jv-btn"
            style={{ padding: "6px 14px", fontSize: 12 }}
          >
            {loading ? "Checking… (~30s)" : "Check FX News Signals"}
          </button>
        </div>
        <p className="jv-lede" style={{ marginBottom: 16 }}>
          Checks each major pair&apos;s GDELT news-coverage volume against its
          7-day average, flagging a spike (&ge;3x) as a signal something is
          actively moving that pair. Runs on demand, not automatically on
          load — six sequential GDELT calls take roughly 30 seconds because
          of its rate limit.
        </p>
        {error && (
          <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            <div className="text-sm">{error}</div>
          </div>
        )}
        {results && (
          <div className="flex flex-col gap-2">
            {results.map((r) => (
              <div key={r.pair} className="jv-card flex items-center justify-between">
                <div className="font-medium text-sm" style={{ color: "var(--text-0)" }}>{r.pair}</div>
                {r.error ? (
                  <div className="text-sm" style={{ color: "var(--text-2)" }}>{r.error}</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: "var(--text-2)" }}>
                      {r.multiple !== null ? `${r.multiple.toFixed(1)}x avg` : "N/A"}
                    </span>
                    <span className={`jv-badge ${r.triggered ? "c-signal" : "c-neutral"}`}>
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
