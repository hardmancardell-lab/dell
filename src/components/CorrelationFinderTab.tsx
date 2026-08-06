"use client";

import { useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { CorrelationFinderResult } from "@/lib/agents/trading-agent/types";

function fmtCorrelation(v: number | null): string {
  return v !== null ? v.toFixed(3) : "N/A";
}

function correlationStyle(v: number | null): { color: string; fontWeight?: number } {
  if (v === null) return { color: "var(--text-2)" };
  if (v <= -0.3) return { color: "var(--danger)", fontWeight: 600 };
  if (v < 0) return { color: "var(--danger)" };
  if (v >= 0.3) return { color: "var(--signal)" };
  return { color: "var(--text-1)" };
}

export function CorrelationFinderTab() {
  const [base, setBase] = useState("");
  const [candidates, setCandidates] = useState("");
  const [result, setResult] = useState<CorrelationFinderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!base.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ base });
      if (candidates.trim()) params.set("candidates", candidates);
      const res = await fetch(`/api/correlation-finder?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Correlation Finder", symbol: base, metadata: { endpoint: "correlation-finder", status: res.status } });
      } else {
        setResult(json as CorrelationFinderResult);
        track("correlation_finder_run", { tab: "Correlation Finder", symbol: base, metadata: { hasCustomCandidates: candidates.trim().length > 0 } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Correlation Finder", symbol: base, metadata: { endpoint: "correlation-finder", status: 0 } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Find what actually moves opposite (or alongside) a ticker, computed from real daily returns —
        not a guess. Leave the candidate list blank to check a default cross-asset set (gold, Treasuries,
        utilities, staples, energy, financials, tech, volatility, oil, the dollar) so the first run says
        something real even without a hand-picked list.
      </p>

      <form onSubmit={runSearch} className="flex flex-wrap gap-3 mb-6">
        <input
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="Base ticker, e.g. GOOGL"
          className="jv-input w-40"
        />
        <input
          value={candidates}
          onChange={(e) => setCandidates(e.target.value)}
          placeholder="Candidates, comma-separated (optional)"
          className="jv-input flex-1 min-w-[240px]"
        />
        <button
          type="submit"
          disabled={loading}
          className="jv-btn"
        >
          {loading ? "Computing…" : "Find Correlations"}
        </button>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {result.baseSymbol} vs. {result.results.length} candidate(s), ~{Math.round(result.lookbackDays / 30.44)} month(s) of daily returns. Sorted most negative first.
          </div>
          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
              <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
            </div>
          ))}
          <div className="overflow-x-auto">
            <table className="jv-table">
              <thead>
                <tr>
                  <th className="text-left">Symbol</th>
                  <th className="text-right">Correlation to {result.baseSymbol}</th>
                  <th className="text-right">Sample Size</th>
                  <th className="text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.symbol}>
                    <td className="font-medium">{r.symbol}</td>
                    <td className="jv-num" style={correlationStyle(r.correlation)}>{fmtCorrelation(r.correlation)}</td>
                    <td className="jv-num" style={{ color: "var(--text-2)" }}>{r.sampleSize}</td>
                    <td className="text-xs" style={{ color: "var(--text-2)" }}>{r.error ?? ""}</td>
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
