"use client";

import { useState } from "react";
import { PriceChart } from "./PriceChart";
import { GlossaryTerm } from "./GlossaryTerm";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { HodLodResult, PremarketGapDay } from "@/lib/agents/trading-agent/skills/premarket-gap-hodlod";

const LOOKBACK_OPTIONS = [90, 180, 365];
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

export function PremarketGapHodLodTab({ defaultTicker = "AAPL" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [lookbackDays, setLookbackDays] = useState(365);
  const [dropThresholdPct, setDropThresholdPct] = useState(4.5);
  const [result, setResult] = useState<HodLodResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const { track } = useTrackEvent();

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFocusedDate(null);
    try {
      const res = await fetch(
        `/api/premarket-gap-hodlod?ticker=${encodeURIComponent(ticker)}&lookbackDays=${lookbackDays}&dropThresholdPct=${dropThresholdPct}`
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Premarket Gaps", symbol: ticker, metadata: { endpoint: "premarket-gap-hodlod", status: res.status } });
      } else {
        setResult(json as HodLodResult);
        track("backtest_run", { tab: "Premarket Gaps", symbol: ticker, metadata: { lookbackDays, dropThresholdPct } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Premarket Gaps", symbol: ticker, metadata: { endpoint: "premarket-gap-hodlod", status: 0 } });
    } finally {
      setLoading(false);
    }
  }

  function renderDropTable(rows: PremarketGapDay[], mode: "low" | "open") {
    return (
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
              <th className={TH_CLASS}>Date</th>
              <th className={TH_CLASS}>Prior Close</th>
              <th className={TH_CLASS}>{mode === "low" ? "Premarket Low" : "9:30am Open"}</th>
              <th className={TH_CLASS}>Drop</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const value = mode === "low" ? row.premarketLow : row.openPrice;
              const drop = mode === "low" ? row.dropToPremarketLowPct : row.dropToOpenPct;
              return (
                <tr
                  key={row.dateKey}
                  onClick={() => setFocusedDate(row.dateKey)}
                  style={{
                    borderBottom: "1px solid var(--ink-800)",
                    cursor: "pointer",
                    background: focusedDate === row.dateKey ? "var(--ink-800)" : undefined,
                  }}
                >
                  <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.priorClose.toFixed(2)}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{value !== null ? `$${value.toFixed(2)}` : "N/A"}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--danger)" }}>{fmtPct(drop)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Real premarket gap-down frequency plus high-of-day/low-of-day timing stats, computed from
        actual minute bars (Alpaca free-tier IEX feed for equities — single-exchange, weakest in
        premarket; see the disclosure below). Click any row to jump the chart to that date.
      </p>

      <form onSubmit={runScan} className="jv-card flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="jv-label block mb-1">Ticker</label>
          <input
            className="jv-input"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="AAPL"
          />
        </div>
        <div>
          <label className="jv-label block mb-1">Lookback (days)</label>
          <select className="jv-select" value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))}>
            {LOOKBACK_OPTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="jv-label block mb-1">Drop threshold %</label>
          <input
            type="number"
            step="0.1"
            className="jv-input"
            style={{ width: 90 }}
            value={dropThresholdPct}
            onChange={(e) => setDropThresholdPct(Number(e.target.value))}
          />
        </div>
        <button type="submit" disabled={loading} className="jv-btn" style={{ padding: "8px 16px" }}>
          {loading ? "Scanning…" : "Run Scan"}
        </button>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{error}</div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="jv-card">
            <div className="jv-br-b" />
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
              {result.ticker} — {result.tradingDaysAnalyzed} trading days analyzed
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="jv-label">Prior Close → PM Low ≥{result.dropThresholdPct}%</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{result.premarketDropDays.length} days</div>
              </div>
              <div>
                <div className="jv-label">Prior Close → Open ≥{result.dropThresholdPct}%</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{result.gapDownAtOpenDays.length} days</div>
              </div>
              <div>
                <div className="jv-label">
                  <GlossaryTerm term="highOfDay">% High-of-Day before 10:30am ET</GlossaryTerm>
                </div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{result.pctHighBefore1030Et?.toFixed(1) ?? "N/A"}%</div>
              </div>
              <div>
                <div className="jv-label">% Low-of-Day before 10:30am ET</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{result.pctLowBefore1030Et?.toFixed(1) ?? "N/A"}%</div>
              </div>
              <div>
                <div className="jv-label">Avg Intraday Range (% of close)</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{result.avgIntradayRangePctOfClose?.toFixed(2) ?? "N/A"}%</div>
              </div>
              <div>
                <div className="jv-label">Median Intraday Range (% of close)</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{result.medianIntradayRangePctOfClose?.toFixed(2) ?? "N/A"}%</div>
              </div>
            </div>
          </div>

          {focusedDate && (
            <div className="jv-card">
              <div className="jv-br-b" />
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                  Chart — {result.ticker} around {focusedDate}
                </div>
                <button onClick={() => setFocusedDate(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
                  ✕ Close
                </button>
              </div>
              <PriceChart key={focusedDate} symbol={result.ticker} focusDate={focusedDate} assetClass="equity" />
            </div>
          )}

          <div className="jv-card">
            <div className="jv-br-b" />
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
              Premarket Drop Days (prior close → premarket low) — click to chart
            </div>
            {result.premarketDropDays.length > 0 ? renderDropTable(result.premarketDropDays, "low") : (
              <div className="text-sm" style={{ color: "var(--text-2)" }}>None in this window.</div>
            )}
          </div>

          <div className="jv-card">
            <div className="jv-br-b" />
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
              Gap-Down-At-Open Days (prior close → 9:30am open) — click to chart
            </div>
            {result.gapDownAtOpenDays.length > 0 ? renderDropTable(result.gapDownAtOpenDays, "open") : (
              <div className="text-sm" style={{ color: "var(--text-2)" }}>None in this window.</div>
            )}
          </div>

          <div className="jv-card">
            <div className="jv-br-b" />
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>High-of-Day / Low-of-Day Time Distribution</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="jv-label mb-1">High-of-Day</div>
                {result.highOfDayTimeDistribution.map((b) => (
                  <div key={b.bucketLabel} className="flex justify-between text-xs font-mono" style={{ color: "var(--text-2)" }}>
                    <span>{b.bucketLabel}</span>
                    <span>{b.count} ({b.pctOfTotal.toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="jv-label mb-1">Low-of-Day</div>
                {result.lowOfDayTimeDistribution.map((b) => (
                  <div key={b.bucketLabel} className="flex justify-between text-xs font-mono" style={{ color: "var(--text-2)" }}>
                    <span>{b.bucketLabel}</span>
                    <span>{b.count} ({b.pctOfTotal.toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
