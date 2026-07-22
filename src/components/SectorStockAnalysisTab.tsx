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

const CYCLE_TAG_CLASS: Record<string, string> = {
  "early-cycle": "jv-badge c-signal",
  expansion: "jv-badge c-signal",
  "late-cycle": "jv-badge c-neutral",
  contraction: "jv-badge c-danger",
};

function qualityClass(passCount: number | null, total: number): string {
  if (passCount === null) return "jv-badge c-neutral";
  if (passCount >= total - 1) return "jv-badge c-signal";
  if (passCount >= total / 2) return "jv-badge c-neutral";
  return "jv-badge c-danger";
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
      <p className="jv-lede" style={{ marginBottom: 20 }}>
        Real fundamentals for the curated companies in one sector, tagged by where the current
        macro read places that sector in the business cycle. Optional forecast mode adds an
        AI-generated narrative synthesis per company, written as a PhD finance professor
        specializing in security analysis — grounded strictly in the real data shown, never a
        buy/sell directive.
      </p>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="jv-label" style={{ marginBottom: 4 }}>
            Sector
          </label>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="px-3 py-2 text-sm"
            style={{
              background: "var(--ink-900)",
              border: "1px solid var(--line)",
              color: "var(--text-0)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
                {UNAVAILABLE_SECTORS.has(s) ? " (unavailable on free plan)" : ""}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm mb-2" style={{ color: "var(--text-1)" }}>
          <input type="checkbox" checked={forecast} onChange={(e) => setForecast(e.target.checked)} />
          Forecasted (AI narrative synthesis)
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="px-5 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--signal)", color: "var(--ink-950)" }}
        >
          {loading ? "Running…" : "Run Analysis"}
        </button>
      </div>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {data && (
        <div>
          <div className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
            {data.sampleNote}
          </div>

          {data.candidates.length === 0 ? (
            <div className="jv-card text-sm" style={{ borderStyle: "dashed", color: "var(--text-2)" }}>
              No companies available for this sector on the free data plan.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {data.candidates.map((c) => (
                <div key={c.ticker} className="jv-card">
                  <div className="jv-br-b" />
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <div>
                      <span className="font-mono font-semibold" style={{ color: "var(--text-0)" }}>
                        {c.ticker}
                      </span>
                      <span className="text-sm ml-2" style={{ color: "var(--text-2)" }}>
                        {c.companyName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={CYCLE_TAG_CLASS[c.cycleTag]}>{c.cycleTag}</span>
                      <span className={qualityClass(c.checklistPassCount, c.checklistTotal)}>
                        {c.checklistPassCount !== null ? `${c.checklistPassCount}/${c.checklistTotal} Graham` : "N/A"}
                      </span>
                    </div>
                  </div>

                  {c.error ? (
                    <div className="text-sm" style={{ color: "var(--danger)" }}>
                      {c.error}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
                        {c.cycleRationale}
                      </p>
                      {c.ownTrendSupportsRead !== null && (
                        <div
                          className="text-xs mb-2"
                          style={{ color: c.ownTrendSupportsRead ? "var(--signal)" : "var(--verdict)" }}
                        >
                          This company&apos;s own margin trend {c.ownTrendSupportsRead ? "agrees with" : "diverges from"} the
                          sector-level cycle read.
                        </div>
                      )}
                      {c.forecast && (
                        <div
                          className="text-sm mt-2 whitespace-pre-wrap"
                          style={{ background: "var(--ink-800)", border: "1px solid var(--line)", padding: 12, color: "var(--text-1)" }}
                        >
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
            <div key={d.slice(0, 30)} className="jv-card mt-3 text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
