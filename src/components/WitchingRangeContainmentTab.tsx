"use client";

import { useEffect, useState } from "react";

interface Occurrence {
  witchingDate: string;
  entryDate: string;
  entryClose: number;
  exitClose: number;
  changePct: number;
  outcome: "within-range" | "dropped-below-entry" | "exceeded-upper-wing";
  zoneLabel: string;
  intrinsicPayoffPct: number;
  intrinsicPayoffPerShare: number;
  netPLPerShare: number;
  netPLPct: number;
  isWin: boolean;
}

interface Result {
  ticker: string;
  lowerBoundPct: number;
  upperBoundPct: number;
  lookbackYears: number;
  shortStrikePct: number;
  lowerLongPct: number;
  upperLongPct: number;
  shortContracts: number;
  maxProfitCondition: string;
  maxProfitPayoffPct: number;
  maxLossCondition: string;
  maxLossPayoffPct: number;
  lowerLongPremium: number;
  shortPremium: number;
  upperLongPremium: number;
  netDebitPerShare: number;
  occurrences: Occurrence[];
  withinRangeCount: number;
  droppedBelowCount: number;
  exceededAboveCount: number;
  pctWithinRange: number | null;
  winCount: number;
  totalNetPLPerShare: number;
  dataLimitations: string[];
  error?: string;
}

/** Colored by real net-of-premium economics (fixed assumption applied to every date), not the raw "within range" label. */
function plClass(pl: number): string {
  if (pl > 0) return "c-signal";
  if (pl === 0) return "c-neutral";
  return "c-danger";
}

export function WitchingRangeContainmentTab() {
  const [ticker, setTicker] = useState("NVDA");
  const [lowerBoundPct, setLowerBoundPct] = useState(-5);
  const [upperBoundPct, setUpperBoundPct] = useState(5);
  const [lookbackYears, setLookbackYears] = useState(3);
  const [lowerLongPremium, setLowerLongPremium] = useState(7);
  const [shortPremium, setShortPremium] = useState(4);
  const [upperLongPremium, setUpperLongPremium] = useState(2);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url =
        `/api/witching-range-containment?ticker=${encodeURIComponent(ticker)}&lowerBoundPct=${lowerBoundPct}` +
        `&upperBoundPct=${upperBoundPct}&lookbackYears=${lookbackYears}&lowerLongPremium=${lowerLongPremium}` +
        `&shortPremium=${shortPremium}&upperLongPremium=${upperLongPremium}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "Unknown error");
        setResult(null);
      } else {
        setResult(json as Result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="jarvis flex flex-col gap-6">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Real per-occurrence P&amp;L for a witching-day symmetric butterfly: buy 1 call @ {result?.lowerLongPct ?? 95}% of
        entry, sell {result?.shortContracts ?? 2} call(s) @ {result?.shortStrikePct ?? 100}%, buy 1 call @{" "}
        {result?.upperLongPct ?? 105}%. Entry at the prior trading day&apos;s close, exit at the witching day&apos;s own
        close. Applies the SAME fixed premiums below to every historical date — no free source for real historical
        options premiums exists (see TRADIER_INTEGRATION_NOTES.md), so this is a stated assumption, not a real
        historical fill.
      </p>

      <form onSubmit={run} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="jv-label block mb-1">Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="jv-input" style={{ width: 100 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Buy 95 premium $</label>
          <input type="number" step="0.01" value={lowerLongPremium} onChange={(e) => setLowerLongPremium(Number(e.target.value))} className="jv-input" style={{ width: 100 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Sell 100 premium $ (ea)</label>
          <input type="number" step="0.01" value={shortPremium} onChange={(e) => setShortPremium(Number(e.target.value))} className="jv-input" style={{ width: 110 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Buy 105 premium $</label>
          <input type="number" step="0.01" value={upperLongPremium} onChange={(e) => setUpperLongPremium(Number(e.target.value))} className="jv-input" style={{ width: 100 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Lookback years</label>
          <input type="number" value={lookbackYears} onChange={(e) => setLookbackYears(Number(e.target.value))} className="jv-input" style={{ width: 90 }} />
        </div>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Study"}
        </button>
      </form>

      {error && <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="jv-card" style={{ borderColor: "var(--verdict)" }}>
              <div className="jv-label mb-1">Max Profit Condition</div>
              <div className="text-sm mb-2" style={{ color: "var(--text-0)" }}>{result.maxProfitCondition}</div>
              <div className="font-mono text-lg" style={{ color: "var(--verdict)" }}>
                {result.maxProfitPayoffPct >= 0 ? "+" : ""}
                {result.maxProfitPayoffPct.toFixed(2)}% of entry (intrinsic)
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                Net of the ${result.netDebitPerShare.toFixed(2)}/sh debit — see the table for each date&apos;s real dollar figure (varies with that date&apos;s entry price).
              </div>
            </div>
            <div className="jv-card" style={{ borderColor: "var(--danger)" }}>
              <div className="jv-label mb-1">Max Loss Condition</div>
              <div className="text-sm mb-2" style={{ color: "var(--text-0)" }}>{result.maxLossCondition}</div>
              <div className="font-mono text-lg" style={{ color: "var(--danger)" }}>
                -${result.netDebitPerShare.toFixed(2)}/sh (the fixed debit, worst case)
              </div>
            </div>
          </div>

          <div className="jv-card grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="jv-br-b" />
            <div>
              <div className="jv-label">Net Debit</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>${result.netDebitPerShare.toFixed(2)}/sh</div>
            </div>
            <div>
              <div className="jv-label">Occurrences</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>{result.occurrences.length}</div>
            </div>
            <div>
              <div className="jv-label">Wins (net P&amp;L &gt; 0)</div>
              <div className="font-mono" style={{ color: "var(--verdict)" }}>
                {result.winCount} ({result.occurrences.length > 0 ? ((result.winCount / result.occurrences.length) * 100).toFixed(0) : "N/A"}%)
              </div>
            </div>
            <div>
              <div className="jv-label">Total Net P&amp;L</div>
              <div className="font-mono" style={{ color: result.totalNetPLPerShare >= 0 ? "var(--verdict)" : "var(--text-1)" }}>
                {result.totalNetPLPerShare >= 0 ? "+" : "-"}${Math.abs(result.totalNetPLPerShare).toFixed(2)}/sh
              </div>
            </div>
          </div>

          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Witching Date</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Entry Close</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Exit Close</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Change</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Zone</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Intrinsic $/sh</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Net P&amp;L $/sh</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Net P&amp;L %</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {result.occurrences.map((o) => (
                  <tr key={o.witchingDate} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-0)" }}>{o.witchingDate}</td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-2)" }}>${o.entryClose.toFixed(2)}</td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-2)" }}>${o.exitClose.toFixed(2)}</td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-1)" }}>
                      {o.changePct >= 0 ? "+" : ""}
                      {o.changePct.toFixed(2)}%
                    </td>
                    <td className="py-2 pr-4 text-xs" style={{ color: "var(--text-2)" }}>{o.zoneLabel}</td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-2)" }}>
                      {o.intrinsicPayoffPerShare >= 0 ? "+" : "-"}${Math.abs(o.intrinsicPayoffPerShare).toFixed(2)}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`jv-badge ${plClass(o.netPLPerShare)}`}>
                        {o.netPLPerShare >= 0 ? "+" : "-"}${Math.abs(o.netPLPerShare).toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono" style={{ color: o.netPLPct >= 0 ? "var(--verdict)" : "var(--text-1)" }}>
                      {o.netPLPct >= 0 ? "+" : ""}
                      {o.netPLPct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
