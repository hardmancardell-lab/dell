"use client";

import { useEffect, useState } from "react";
import type { StrategyHypothesis } from "@/lib/agents/trading-agent/types";

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${n.toFixed(1)}%`;
}

export function StrategyLedgerTab() {
  const [hypotheses, setHypotheses] = useState<StrategyHypothesis[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/strategy-hypotheses?limit=200");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load strategy ledger.");
        if (!cancelled) setHypotheses(data.hypotheses as StrategyHypothesis[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Every row here is a real result from this app&apos;s own backtest engines, swept automatically once a week
        against a fixed ticker universe — validated rows passed real BH-FDR significance, a bootstrap confidence
        interval excluding zero, and an out-of-sample sign check; rejected rows failed one of those and say which.
        No illustrative numbers, no invented win rates.
      </p>

      {loading && <p style={{ color: "var(--text-2)" }}>Loading strategy ledger…</p>}

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="font-medium">Could not load strategy ledger</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {hypotheses && hypotheses.length === 0 && (
        <p style={{ color: "var(--text-2)" }}>
          No hypotheses logged yet — the sweep runs once a week (Mondays). Check back after the next run.
        </p>
      )}

      {hypotheses && hypotheses.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)" }}>
                {["Ticker", "Strategy", "Horizon", "Entry Rule", "Exit", "Win Rate", "Sample", "Status"].map((h) => (
                  <th key={h} className="text-left py-2 px-2" style={{ color: "var(--text-2)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hypotheses.map((h) => (
                <tr key={h.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td className="py-2 px-2 font-medium">{h.ticker}</td>
                  <td className="py-2 px-2">{h.strategyType}</td>
                  <td className="py-2 px-2">{h.horizonLabel}</td>
                  <td className="py-2 px-2 text-xs" style={{ color: "var(--text-2)", maxWidth: 260 }}>
                    {h.entryRule}
                  </td>
                  <td className="py-2 px-2">
                    <span
                      className="text-xs px-2 py-0.5"
                      style={{
                        border: "1px solid var(--line-bright)",
                        color: h.exitType === "time" ? "var(--text-1)" : "var(--signal)",
                      }}
                    >
                      {h.exitType === "time" ? "Time-based" : "Price-based"}
                    </span>
                    <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                      {h.exitRule}
                    </div>
                  </td>
                  <td className="py-2 px-2">{fmtPct(h.winRatePct)}</td>
                  <td className="py-2 px-2">{h.sampleSize}</td>
                  <td className="py-2 px-2">
                    {h.status === "validated" ? (
                      <span className="text-xs px-2 py-0.5" style={{ border: "1px solid var(--signal)", color: "var(--signal)" }}>
                        Validated
                      </span>
                    ) : (
                      <div>
                        <span className="text-xs px-2 py-0.5" style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}>
                          Rejected
                        </span>
                        {h.rejectionReason && (
                          <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                            {h.rejectionReason}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
