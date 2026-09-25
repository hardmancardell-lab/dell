"use client";

import { useEffect, useState } from "react";

type Zone = "at-or-below-short" | "short-to-first-long" | "between-longs" | "above-far-long";

interface Occurrence {
  witchingDate: string;
  entryDate: string;
  entryClose: number;
  exitClose: number;
  changePct: number;
  outcome: "within-range" | "dropped-below-entry" | "exceeded-upper-wing";
  zone: Zone;
  intrinsicPayoffPct: number;
  intrinsicPayoffPerShare: number;
}

interface Result {
  ticker: string;
  lowerBoundPct: number;
  upperBoundPct: number;
  lookbackYears: number;
  shortStrikePct: number;
  longStrike1Pct: number;
  longStrike2Pct: number;
  shortContracts: number;
  maxProfitCondition: string;
  maxProfitPayoffPct: number;
  maxLossCondition: string;
  maxLossPayoffPct: number;
  occurrences: Occurrence[];
  withinRangeCount: number;
  droppedBelowCount: number;
  exceededAboveCount: number;
  pctWithinRange: number | null;
  dataLimitations: string[];
  error?: string;
}

const ZONE_LABEL: Record<Zone, string> = {
  "at-or-below-short": "At/below short strike",
  "short-to-first-long": "Short strike → 1st long",
  "between-longs": "Between the two longs",
  "above-far-long": "Above far long (capped)",
};

/** Colored by real intrinsic economics (0 = best/max-profit, more negative = worse), not by the old "stayed in range" framing — for this 2-short/1-long/1-long structure those are opposite things. */
function payoffClass(payoffPct: number): string {
  if (payoffPct >= 0) return "c-signal";
  if (payoffPct >= -10) return "c-neutral";
  return "c-danger";
}

export function WitchingRangeContainmentTab() {
  const [ticker, setTicker] = useState("NVDA");
  const [lowerBoundPct, setLowerBoundPct] = useState(0);
  const [upperBoundPct, setUpperBoundPct] = useState(15);
  const [lookbackYears, setLookbackYears] = useState(3);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url = `/api/witching-range-containment?ticker=${encodeURIComponent(ticker)}&lowerBoundPct=${lowerBoundPct}&upperBoundPct=${upperBoundPct}&lookbackYears=${lookbackYears}`;
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
        Real per-occurrence payoff breakdown for a witching-day spread: sell {result?.shortContracts ?? 2} call(s) @{" "}
        {result?.shortStrikePct ?? 100}% of entry, buy 1 call @ {result?.longStrike1Pct ?? 105}%, buy 1 call @{" "}
        {result?.longStrike2Pct ?? 115}%. Entry at the prior trading day&apos;s close, exit at the witching day&apos;s own
        close. Shows the intrinsic payoff-at-expiration only — real P&amp;L also depends on the premium paid/received
        at entry, which no free historical options-pricing source can supply (see TRADIER_INTEGRATION_NOTES.md).
      </p>

      <form onSubmit={run} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="jv-label block mb-1">Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="jv-input" style={{ width: 100 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Lower bound %</label>
          <input
            type="number"
            value={lowerBoundPct}
            onChange={(e) => setLowerBoundPct(Number(e.target.value))}
            className="jv-input"
            style={{ width: 90 }}
          />
        </div>
        <div>
          <label className="jv-label block mb-1">Upper bound %</label>
          <input
            type="number"
            value={upperBoundPct}
            onChange={(e) => setUpperBoundPct(Number(e.target.value))}
            className="jv-input"
            style={{ width: 90 }}
          />
        </div>
        <div>
          <label className="jv-label block mb-1">Lookback years</label>
          <input
            type="number"
            value={lookbackYears}
            onChange={(e) => setLookbackYears(Number(e.target.value))}
            className="jv-input"
            style={{ width: 90 }}
          />
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
                {result.maxProfitPayoffPct.toFixed(2)} pts (intrinsic)
              </div>
            </div>
            <div className="jv-card" style={{ borderColor: "var(--danger)" }}>
              <div className="jv-label mb-1">Max Loss Condition</div>
              <div className="text-sm mb-2" style={{ color: "var(--text-0)" }}>{result.maxLossCondition}</div>
              <div className="font-mono text-lg" style={{ color: "var(--danger)" }}>
                {result.maxLossPayoffPct.toFixed(2)} pts (intrinsic, capped)
              </div>
            </div>
          </div>

          <div className="jv-card grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="jv-br-b" />
            <div>
              <div className="jv-label">Occurrences</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>{result.occurrences.length}</div>
            </div>
            <div>
              <div className="jv-label">Within Range</div>
              <div className="font-mono" style={{ color: "var(--text-1)" }}>
                {result.withinRangeCount} ({result.pctWithinRange !== null ? result.pctWithinRange.toFixed(0) : "N/A"}%)
              </div>
            </div>
            <div>
              <div className="jv-label">Dropped Below Entry</div>
              <div className="font-mono" style={{ color: "var(--text-1)" }}>{result.droppedBelowCount}</div>
            </div>
            <div>
              <div className="jv-label">Exceeded Upper Wing</div>
              <div className="font-mono" style={{ color: "var(--text-1)" }}>{result.exceededAboveCount}</div>
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
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Intrinsic Payoff</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Payoff $/sh</th>
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
                    <td className="py-2 pr-4 text-xs" style={{ color: "var(--text-2)" }}>{ZONE_LABEL[o.zone]}</td>
                    <td className="py-2 pr-4">
                      <span className={`jv-badge ${payoffClass(o.intrinsicPayoffPct)}`}>
                        {o.intrinsicPayoffPct >= 0 ? "+" : ""}
                        {o.intrinsicPayoffPct.toFixed(2)} pts
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono" style={{ color: o.intrinsicPayoffPerShare >= 0 ? "var(--verdict)" : "var(--text-1)" }}>
                      {o.intrinsicPayoffPerShare >= 0 ? "+" : "-"}${Math.abs(o.intrinsicPayoffPerShare).toFixed(2)}
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
