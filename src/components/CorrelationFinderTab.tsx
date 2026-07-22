"use client";

import { useState } from "react";
import type { CorrelationFinderResult } from "@/lib/agents/trading-agent/types";

function fmtCorrelation(v: number | null): string {
  return v !== null ? v.toFixed(3) : "N/A";
}

function correlationTone(v: number | null): string {
  if (v === null) return "text-zinc-400";
  if (v <= -0.3) return "text-red-600 dark:text-red-400 font-semibold";
  if (v < 0) return "text-red-600 dark:text-red-400";
  if (v >= 0.3) return "text-green-600 dark:text-green-400";
  return "text-zinc-500";
}

export function CorrelationFinderTab() {
  const [base, setBase] = useState("");
  const [candidates, setCandidates] = useState("");
  const [result, setResult] = useState<CorrelationFinderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as CorrelationFinderResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-zinc-500 mb-6">
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
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm w-40"
        />
        <input
          value={candidates}
          onChange={(e) => setCandidates(e.target.value)}
          placeholder="Candidates, comma-separated (optional)"
          className="flex-1 min-w-[240px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Computing…" : "Find Correlations"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="text-sm text-zinc-500">
            {result.baseSymbol} vs. {result.results.length} candidate(s), ~{Math.round(result.lookbackDays / 30.44)} month(s) of daily returns. Sorted most negative first.
          </div>
          {result.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Correlation to {result.baseSymbol}</th>
                  <th className="py-2 pr-4">Sample Size</th>
                  <th className="py-2 pr-4">Notes</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.symbol} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-medium">{r.symbol}</td>
                    <td className={`py-2 pr-4 ${correlationTone(r.correlation)}`}>{fmtCorrelation(r.correlation)}</td>
                    <td className="py-2 pr-4 text-zinc-500">{r.sampleSize}</td>
                    <td className="py-2 pr-4 text-zinc-500 text-xs">{r.error ?? ""}</td>
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
