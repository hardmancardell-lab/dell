"use client";

import { useEffect, useState } from "react";
import { GlossaryTerm } from "./GlossaryTerm";
import { classifyEntropyRegime } from "@/lib/agents/trading-agent/skills/entropy-analyzer";
import type { StrategyHypothesis } from "@/lib/agents/trading-agent/types";

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${n.toFixed(1)}%`;
}

const ENTROPY_REGIME_COLOR: Record<"low" | "medium" | "high", string> = {
  low: "var(--signal)",
  medium: "var(--verdict)",
  high: "var(--danger)",
};

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
    <div className="jarvis flex flex-col gap-8">
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
          <table className="jv-table">
            <thead>
              <tr>
                {["Ticker", "Strategy", "Horizon", "Entry Rule", "Exit", "Win Rate", "Entropy", "Sample", "Status"].map((h) => (
                  <th key={h}>
                    {h === "Entropy" ? (
                      <GlossaryTerm term="entropyScore">{h}</GlossaryTerm>
                    ) : (
                      h
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hypotheses.map((h) => (
                <tr key={h.id}>
                  <td className="font-medium">{h.ticker}</td>
                  <td>{h.strategyType}</td>
                  <td>{h.horizonLabel}</td>
                  <td className="text-xs" style={{ color: "var(--text-2)", maxWidth: 260, whiteSpace: "normal" }}>
                    {h.entryRule}
                  </td>
                  <td>
                    <span className={`jv-badge ${h.exitType === "time" ? "c-neutral" : "c-signal"}`}>
                      {h.exitType === "time" ? "Time-based" : "Price-based"}
                    </span>
                    <div className="text-xs mt-1" style={{ color: "var(--text-2)", whiteSpace: "normal" }}>
                      {h.exitRule}
                    </div>
                  </td>
                  <td className="jv-num">{fmtPct(h.winRatePct)}</td>
                  <td>
                    {(() => {
                      const regime = classifyEntropyRegime(h.entropyScore);
                      if (!regime || h.entropyScore === null) return "N/A";
                      return (
                        <span style={{ color: ENTROPY_REGIME_COLOR[regime] }}>
                          {h.entropyScore.toFixed(2)} ({regime})
                        </span>
                      );
                    })()}
                  </td>
                  <td className="jv-num">{h.sampleSize}</td>
                  <td>
                    {h.status === "validated" ? (
                      <span className="jv-badge c-signal">Validated</span>
                    ) : (
                      <div>
                        <span className="jv-badge c-danger">Rejected</span>
                        {h.rejectionReason && (
                          <div className="text-xs mt-1" style={{ color: "var(--text-2)", whiteSpace: "normal" }}>
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
