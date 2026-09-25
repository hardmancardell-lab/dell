"use client";

import { useEffect, useState } from "react";

interface Occurrence {
  witchingDate: string;
  entryDate: string;
  entryClose: number;
  exitClose: number;
  changePct: number;
  outcome: "within-range" | "dropped-below-entry" | "exceeded-upper-wing";
}

interface Result {
  ticker: string;
  lowerBoundPct: number;
  upperBoundPct: number;
  lookbackYears: number;
  occurrences: Occurrence[];
  withinRangeCount: number;
  droppedBelowCount: number;
  exceededAboveCount: number;
  pctWithinRange: number | null;
  dataLimitations: string[];
  error?: string;
}

const OUTCOME_LABEL: Record<Occurrence["outcome"], string> = {
  "within-range": "Within range",
  "dropped-below-entry": "Dropped below entry",
  "exceeded-upper-wing": "Exceeded upper wing",
};

const OUTCOME_CLASS: Record<Occurrence["outcome"], string> = {
  "within-range": "c-signal",
  "dropped-below-entry": "c-danger",
  "exceeded-upper-wing": "c-danger",
};

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
        Real price-containment check for a witching-day spread: entry at the prior trading day&apos;s close, exit
        at the witching day&apos;s own close. Checks whether the underlying stayed between the lower bound
        (typically the short strike, 0% = entry price) and the upper bound (the furthest long leg) — e.g. sell
        2C @ 100%, buy 1C @ 105%, buy 1C @ 115% means a 0%&ndash;15% band. This checks price containment only, not
        actual spread P&amp;L — no historical options-pricing data exists anywhere to model the real net debit paid.
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
          <div className="jv-card grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="jv-br-b" />
            <div>
              <div className="jv-label">Occurrences</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>{result.occurrences.length}</div>
            </div>
            <div>
              <div className="jv-label">Within Range</div>
              <div className="font-mono" style={{ color: "var(--verdict)" }}>
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
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Outcome</th>
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
                    <td className="py-2 pr-4">
                      <span className={`jv-badge ${OUTCOME_CLASS[o.outcome]}`}>{OUTCOME_LABEL[o.outcome]}</span>
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
