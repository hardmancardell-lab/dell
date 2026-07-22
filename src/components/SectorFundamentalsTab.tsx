"use client";

import { useState } from "react";
import type { SectorFundamentals } from "@/lib/agents/research-agent/types";

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

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

export function SectorFundamentalsTab() {
  const [sector, setSector] = useState(SECTORS[0]);
  const [data, setData] = useState<SectorFundamentals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runAnalysis(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/sector-fundamentals?sector=${encodeURIComponent(sector)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setData(json as SectorFundamentals);
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
        Debt-to-Equity, Interest Coverage, CapEx/Depreciation, and margin
        variance across a curated set of large-cap bellwethers &mdash;
        closes the gaps FRED can&apos;t fill. Not a live market-cap screen
        (see Data Limitations below).
      </p>

      <form onSubmit={runAnalysis} className="flex gap-3">
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        >
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {UNAVAILABLE_SECTORS.has(s) ? `${s} (unavailable on free plan)` : s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {error && (
        <div className="mt-8 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400">
          <div className="font-medium">Could not load data</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {data && (
        <div className="mt-8 space-y-10">
          <section>
            <h2 className="text-xl font-semibold mb-3">
              {data.sector} &mdash; Medians ({data.sampleNote})
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="Debt / Equity (median)"
                value={data.medians.debtToEquity !== null ? data.medians.debtToEquity.toFixed(2) : "N/A"}
              />
              <StatCard
                label="Interest Coverage (median)"
                value={
                  data.medians.interestCoverage !== null
                    ? `${data.medians.interestCoverage.toFixed(1)}x`
                    : "N/A"
                }
              />
              <StatCard
                label="CapEx / Depreciation (median)"
                value={
                  data.medians.capexToDepreciation !== null
                    ? data.medians.capexToDepreciation.toFixed(2)
                    : "N/A"
                }
                sub=">1.0 = expanding faster than assets wear out"
              />
              <StatCard
                label="Operating Margin Std Dev (median)"
                value={
                  data.medians.operatingMarginStdDev !== null
                    ? `${data.medians.operatingMarginStdDev.toFixed(1)} pts`
                    : "N/A"
                }
                sub="Higher = less stable, harder to value"
              />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">Data Limitations</h2>
            <div className="space-y-3">
              {data.dataLimitations.map((d) => (
                <div
                  key={d.slice(0, 30)}
                  className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-400"
                >
                  {d}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Companies in Sample</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Ticker</th>
                    <th className="py-2 pr-4">Company</th>
                    <th className="py-2 pr-4">D/E</th>
                    <th className="py-2 pr-4">Int. Coverage</th>
                    <th className="py-2 pr-4">CapEx/Dep</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companiesAnalyzed.map((c) => (
                    <tr key={c.ticker} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-medium">{c.ticker}</td>
                      <td className="py-2 pr-4">{c.companyName}</td>
                      <td className="py-2 pr-4">{c.debtToEquity?.toFixed(2) ?? "N/A"}</td>
                      <td className="py-2 pr-4">
                        {c.interestCoverage !== null ? `${c.interestCoverage.toFixed(1)}x` : "N/A"}
                      </td>
                      <td className="py-2 pr-4">{c.capexToDepreciation?.toFixed(2) ?? "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
