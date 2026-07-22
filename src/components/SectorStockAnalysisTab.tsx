"use client";

import { useState } from "react";
import type { SectorStockAnalysisResult } from "@/lib/agents/research-agent/types";

// Hardcoded rather than imported from sector-fundamentals.ts, same
// bundling-boundary rationale as SectorFundamentalsTab.tsx's own local
// SECTORS list — keeps server-only FMP client code out of the client bundle.
const UNAVAILABLE_SECTORS = new Set(["Basic Materials", "Real Estate", "Utilities"]);
const SECTORS = [
  "Basic Materials",
  "Communication Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Energy",
  "Financial Services",
  "Healthcare",
  "Industrials",
  "Real Estate",
  "Technology",
  "Utilities",
];

const CYCLE_TAG_STYLES: Record<string, string> = {
  "early-cycle": "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
  expansion: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  "late-cycle": "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  contraction: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
};

function qualityStyle(passCount: number | null, total: number): string {
  if (passCount === null) return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500";
  if (passCount >= total - 1) return "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400";
  if (passCount >= total / 2) return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400";
  return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400";
}

export function SectorStockAnalysisTab() {
  const [sector, setSector] = useState("Technology");
  const [forecast, setForecast] = useState(false);
  const [data, setData] = useState<SectorStockAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/sector-stock-analysis?sector=${encodeURIComponent(sector)}&forecast=${forecast}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setData(json as SectorStockAnalysisResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        Real fundamentals for the curated companies in one sector, tagged by where the current
        macro read places that sector in the business cycle. Optional forecast mode adds an
        AI-generated narrative synthesis per company, written as a PhD finance professor
        specializing in security analysis — grounded strictly in the real data shown, never a
        buy/sell directive.
      </p>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Sector</label>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
          >
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
                {UNAVAILABLE_SECTORS.has(s) ? " (unavailable on free plan)" : ""}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="checkbox" checked={forecast} onChange={(e) => setForecast(e.target.checked)} />
          Forecasted (AI narrative synthesis)
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Running…" : "Run Analysis"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {data && (
        <div>
          <div className="text-sm text-zinc-500 mb-4">{data.sampleNote}</div>

          {data.candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm text-zinc-500">
              No companies available for this sector on the free data plan.
            </div>
          ) : (
            <div className="space-y-3">
              {data.candidates.map((c) => (
                <div key={c.ticker} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-semibold">{c.ticker}</span>
                      <span className="text-zinc-500 text-sm ml-2">{c.companyName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${CYCLE_TAG_STYLES[c.cycleTag]}`}>
                        {c.cycleTag}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${qualityStyle(c.checklistPassCount, c.checklistTotal)}`}>
                        {c.checklistPassCount !== null ? `${c.checklistPassCount}/${c.checklistTotal} Graham` : "N/A"}
                      </span>
                    </div>
                  </div>

                  {c.error ? (
                    <div className="text-sm text-red-600 dark:text-red-400">{c.error}</div>
                  ) : (
                    <>
                      <p className="text-xs text-zinc-500 mb-2">{c.cycleRationale}</p>
                      {c.ownTrendSupportsRead !== null && (
                        <div
                          className={`text-xs mb-2 ${
                            c.ownTrendSupportsRead
                              ? "text-green-700 dark:text-green-400"
                              : "text-amber-700 dark:text-amber-400"
                          }`}
                        >
                          This company&apos;s own margin trend {c.ownTrendSupportsRead ? "agrees with" : "diverges from"} the
                          sector-level cycle read.
                        </div>
                      )}
                      {c.forecast && (
                        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 text-sm mt-2 whitespace-pre-wrap">
                          {c.forecast}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {data.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400 mt-3"
            >
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
