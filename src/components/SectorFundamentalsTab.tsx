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
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="jv-label">{label}</div>
      <div className="jv-cond c-neutral" style={{ fontSize: 20 }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          {sub}
        </div>
      )}
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
      <p className="jv-lede" style={{ marginBottom: 20 }}>
        Debt-to-Equity, Interest Coverage, CapEx/Depreciation, and margin variance across a curated set
        of large-cap bellwethers &mdash; closes the gaps FRED can&apos;t fill. Not a live market-cap
        screen (see Data Limitations below). Every sector also shows a broader, real sub-industry
        breakdown even where full ratios aren&apos;t available.
      </p>

      <form onSubmit={runAnalysis} className="flex gap-3">
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="flex-1 px-4 py-2 text-sm"
          style={{
            background: "var(--ink-900)",
            border: "1px solid var(--line)",
            color: "var(--text-0)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {UNAVAILABLE_SECTORS.has(s) ? `${s} (no full ratios on free plan)` : s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--signal)", color: "var(--ink-950)" }}
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {error && (
        <div className="jv-card mt-8" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="font-medium">Could not load data</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {data && (
        <div className="mt-8 flex flex-col gap-10">
          <section>
            <div className="jv-strip-title">
              {data.sector} &mdash; Medians ({data.sampleNote})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="jv-strip-title">Data Limitations</div>
            <div className="flex flex-col gap-2">
              {data.dataLimitations.map((d) => (
                <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                  <div className="text-sm" style={{ color: "var(--verdict)" }}>
                    {d}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="jv-strip-title">Companies in Sample (Full Ratios)</div>
            {data.companiesAnalyzed.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>
                No companies in this sector have accessible full financial statements on the free FMP
                plan — see &quot;Also Tracked in This Sector&quot; below for real company/sub-industry
                coverage instead.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr
                      className="text-left"
                      style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }}
                    >
                      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Ticker</th>
                      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Company</th>
                      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">
                        Sub-Industry
                      </th>
                      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">D/E</th>
                      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">
                        Int. Coverage
                      </th>
                      <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">
                        CapEx/Dep
                      </th>
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                    {data.companiesAnalyzed.map((c) => (
                      <tr key={c.ticker} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                        <td className="py-2 pr-4 font-medium font-mono" style={{ color: "var(--text-0)" }}>
                          {c.ticker}
                        </td>
                        <td className="py-2 pr-4" style={{ color: "var(--text-1)" }}>
                          {c.companyName}
                        </td>
                        <td className="py-2 pr-4" style={{ color: "var(--text-2)" }}>
                          {c.industry ?? "—"}
                        </td>
                        <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-1)" }}>
                          {c.debtToEquity?.toFixed(2) ?? "N/A"}
                        </td>
                        <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-1)" }}>
                          {c.interestCoverage !== null ? `${c.interestCoverage.toFixed(1)}x` : "N/A"}
                        </td>
                        <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-1)" }}>
                          {c.capexToDepreciation?.toFixed(2) ?? "N/A"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.broaderCoverage.length > 0 && (
            <section>
              <div className="jv-strip-title">
                Also Tracked in This Sector ({data.broaderCoverage.length} companies, name/sub-industry only)
              </div>
              <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
                Real companies and real sub-industry classifications from FMP, but no financial ratios
                &mdash; that data is gated by the same free-tier allowlist as above.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.broaderCoverage.map((c) => (
                  <div key={c.ticker} className="jv-card">
                    <div className="jv-br-b" />
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono font-medium" style={{ color: "var(--text-0)" }}>
                        {c.ticker}
                      </span>
                      <span className="text-xs font-mono" style={{ color: "var(--text-2)" }}>
                        {c.marketCap > 0 ? `$${(c.marketCap / 1e9).toFixed(1)}B` : ""}
                      </span>
                    </div>
                    <div className="text-sm" style={{ color: "var(--text-1)" }}>
                      {c.companyName}
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                      {c.industry ?? "Sub-industry unavailable"}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
