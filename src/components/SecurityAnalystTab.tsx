"use client";

import { useState, type ReactNode } from "react";
import { useResearchWatchlist } from "@/lib/agents/research-agent/watchlist-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { getResearchGlossaryEntry } from "@/lib/agents/research-agent/skills/glossary";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import type { SecurityAnalysis, SectorPeerRanking, ValuationVerdict } from "@/lib/agents/research-agent/types";

type QualityTier = "Strong" | "Moderate" | "Weak";

const QUALITY_TIER_CLASS: Record<QualityTier, string> = {
  Strong: "jv-badge c-signal",
  Moderate: "jv-badge c-neutral",
  Weak: "jv-badge c-danger",
};

// A skimmable summary on top of the full 7-item checklist below — the
// checklist itself is unchanged, this is purely an additional at-a-glance
// read, same tradeoff the competitive analysis recommended (most
// competitors lead with a single blended score; this app's checklist stays
// the source of truth).
function qualityTier(passedCount: number, total: number): QualityTier {
  if (total === 0) return "Weak";
  if (passedCount >= 6) return "Strong";
  if (passedCount >= 4) return "Moderate";
  return "Weak";
}

function StatCard({ label, value, sub }: { label: ReactNode; value: string; sub?: string }) {
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

function PassFailBadge({ passed }: { passed: boolean | null }) {
  const cls = passed === null ? "jv-badge c-neutral" : passed ? "jv-badge c-signal" : "jv-badge c-danger";
  return <span className={cls}>{passed === null ? "N/A" : passed ? "Pass" : "Fail"}</span>;
}

const VERDICT_CLASS: Record<ValuationVerdict, string> = {
  undervalued: "jv-badge c-signal",
  overvalued: "jv-badge c-danger",
  "fairly valued": "jv-badge c-neutral",
  "not applicable": "jv-badge c-neutral",
};

function VerdictBadge({ verdict }: { verdict: ValuationVerdict }) {
  return <span className={VERDICT_CLASS[verdict]}>{verdict}</span>;
}

function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${value.toFixed(2)}`;
}

export function SecurityAnalystTab() {
  const { symbols: watchlist, addSymbol } = useResearchWatchlist();
  const { track } = useTrackEvent();
  const [ticker, setTicker] = useState("");
  const [data, setData] = useState<SecurityAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [peerRanking, setPeerRanking] = useState<SectorPeerRanking | null>(null);
  const [peerError, setPeerError] = useState<string | null>(null);
  const [peerLoading, setPeerLoading] = useState(false);

  async function runAnalysis(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setPeerRanking(null);
    setPeerError(null);
    track("ticker_analyzed", { agent: "research", tab: "Analyze Ticker", symbol: ticker.trim().toUpperCase() });
    try {
      const res = await fetch(`/api/security-analysis?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setData(json as SecurityAnalysis);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runPeerRanking() {
    if (!data) return;
    setPeerLoading(true);
    setPeerError(null);
    setPeerRanking(null);
    try {
      const res = await fetch(`/api/sector-peer-ranking?ticker=${encodeURIComponent(data.ticker)}`);
      const json = await res.json();
      if (!res.ok) {
        setPeerError(json.error ?? "Unknown error");
      } else {
        setPeerRanking(json as SectorPeerRanking);
      }
    } catch (err) {
      setPeerError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPeerLoading(false);
    }
  }

  const passedCount = data?.checklist.filter((c) => c.passed).length ?? 0;

  return (
    <div>
      <p className="jv-lede" style={{ marginBottom: 20 }}>
        A cold-blooded interrogation of one company&apos;s financial statements &mdash; NCAV, earnings
        stability, debt coverage, and the Graham multiplier.
      </p>

      <form onSubmit={runAnalysis} className="flex gap-3">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="flex-1 px-4 py-2 text-sm"
          style={{
            background: "var(--ink-900)",
            border: "1px solid var(--line)",
            color: "var(--text-0)",
            fontFamily: "var(--font-mono)",
          }}
        />
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
          <div className="jv-verdict-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="jv-vp-label">
                  <span className="jv-dot" aria-hidden="true" />
                  {data.sector} &middot; {data.industry}
                </div>
                <h3>
                  {data.companyName} ({data.ticker})
                </h3>
              </div>
              <button
                onClick={() => addSymbol(data.ticker)}
                disabled={watchlist.some((w) => w.symbol === data.ticker)}
                className="shrink-0 px-3 py-1 text-xs font-medium disabled:opacity-50"
                style={{ border: "1px solid var(--line-bright)", color: "var(--text-1)" }}
              >
                {watchlist.some((w) => w.symbol === data.ticker) ? "On Watchlist" : "+ Save to Watchlist"}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <p style={{ marginBottom: 0 }}>
                <b>
                  {passedCount} / {data.checklist.length}
                </b>{" "}
                Graham criteria passed
              </p>
              <GlossaryTerm term="qualityTier" getEntry={getResearchGlossaryEntry}>
                <span className={QUALITY_TIER_CLASS[qualityTier(passedCount, data.checklist.length)]}>
                  {qualityTier(passedCount, data.checklist.length)}
                </span>
              </GlossaryTerm>
            </div>
          </div>

          {data.dataLimitations.length > 0 && (
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
          )}

          <section>
            <div className="jv-strip-title">The Graham Checklist</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.checklist.map((c) => (
                <div key={c.criterion} className="jv-card">
                  <div className="jv-br-b" />
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                      {c.criterion}
                    </div>
                    <PassFailBadge passed={c.passed} />
                  </div>
                  <div className="text-sm" style={{ color: "var(--text-2)" }}>
                    {c.detail}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {data.sectorPanel && (
            <section>
              <div className="jv-strip-title">Sector-Specific: {data.sectorPanel.subSector}</div>
              <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
                {data.sectorPanel.classificationNote}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.sectorPanel.ratios.map((r) => (
                  <div key={r.label} className="jv-card" style={!r.available ? { borderStyle: "dashed" } : undefined}>
                    <div className="jv-br-b" />
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                        {r.label}
                      </div>
                      {r.available ? (
                        <PassFailBadge passed={r.passed} />
                      ) : (
                        <span className="text-xs" style={{ color: "var(--text-2)" }}>
                          Not available
                        </span>
                      )}
                    </div>
                    {r.available && (
                      <div className="jv-cond c-neutral" style={{ fontSize: 18 }}>
                        {r.value}
                      </div>
                    )}
                    <div className="text-xs" style={{ color: "var(--text-2)" }}>
                      {r.benchmark}
                    </div>
                    {r.note && (
                      <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                        {r.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="jv-strip-title">
              1. Earning Power ({data.earningPower.yearsAvailable}/{data.earningPower.yearsRequested} years)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard
                label="Average Net Income"
                value={`$${(data.earningPower.averageNetIncome / 1_000_000).toFixed(1)}M`}
                sub={data.earningPower.warning ?? undefined}
              />
              <StatCard label="Deficit Years" value={String(data.earningPower.deficitYears)} />
            </div>
          </section>

          <section>
            <div className="jv-strip-title">2. Net-Current-Asset Value (Liquidation Floor)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard
                label={
                  <GlossaryTerm term="ncav" getEntry={getResearchGlossaryEntry}>
                    NCAV per Share
                  </GlossaryTerm>
                }
                value={`$${data.ncav.ncavPerShare.toFixed(2)}`}
              />
              <StatCard
                label="Price vs NCAV"
                value={data.ncav.priceToNcav !== null ? `${(data.ncav.priceToNcav * 100).toFixed(0)}%` : "N/A"}
                sub={data.ncav.isBargain ? "Below 2/3 of NCAV — Graham bargain" : undefined}
              />
            </div>
          </section>

          <section>
            <div className="jv-strip-title">3. Liquidity &amp; Solvency</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard label="Current Ratio" value={data.liquidity.currentRatio.toFixed(2)} sub="Graham floor: 2.0" />
              <StatCard
                label={
                  <GlossaryTerm term="fixedChargeCoverage" getEntry={getResearchGlossaryEntry}>
                    Fixed-Charge Coverage
                  </GlossaryTerm>
                }
                value={data.solvency.fixedChargeCoverage !== null ? `${data.solvency.fixedChargeCoverage.toFixed(1)}x` : "No debt"}
                sub="Graham floor: 4x"
              />
              <StatCard
                label="Debt / Equity"
                value={data.solvency.debtToEquity !== null ? data.solvency.debtToEquity.toFixed(2) : "N/A"}
                sub={data.solvency.topHeavy ? "Top-heavy capital structure" : undefined}
              />
              <StatCard label="Dividend Record" value={`${data.dividends.consecutiveYearsPaid} yrs`} sub={`Graham floor: ${data.dividends.yearsRequested} yrs`} />
            </div>
            {data.dividends.growthTrend && (
              <p className="text-sm mt-3" style={{ color: "var(--text-2)" }}>
                Dividend total per year has been{" "}
                <b
                  style={{
                    fontFamily: "inherit",
                    color:
                      data.dividends.growthTrend === "growing"
                        ? "var(--signal)"
                        : data.dividends.growthTrend === "declining"
                          ? "var(--danger)"
                          : "var(--text-1)",
                  }}
                >
                  {data.dividends.growthTrend}
                </b>{" "}
                over the available history (comparing the most recent full year to ~5 years earlier, or as far back
                as data allows) — supplements the {data.dividends.yearsRequested}-year record criterion above,
                doesn&apos;t change it.
              </p>
            )}
          </section>

          <section>
            <div className="jv-strip-title">4. Valuation</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard label="PE (3yr avg EPS)" value={data.valuation.peRatio !== null ? data.valuation.peRatio.toFixed(1) : "N/A"} />
              <StatCard label="PB (book value)" value={data.valuation.pbRatio !== null ? data.valuation.pbRatio.toFixed(1) : "N/A"} />
              <StatCard
                label={
                  <GlossaryTerm term="grahamMultiplier" getEntry={getResearchGlossaryEntry}>
                    Graham Multiplier (PE x PB)
                  </GlossaryTerm>
                }
                value={data.valuation.grahamMultiplier !== null ? data.valuation.grahamMultiplier.toFixed(1) : "N/A"}
                sub="Graham ceiling: 22.5"
              />
            </div>
          </section>

          <section>
            <div className="jv-strip-title">5. Valuation Methods vs. Market Price</div>
            <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
              Every method compared against the current market price of ${data.valuation.price.toFixed(2)}. Each
              has its own assumptions listed underneath — these are scenarios, not a single answer.
            </p>
            <div className="flex flex-col gap-3">
              {data.valuationMethods.map((v) => (
                <div key={v.method} className="jv-card">
                  <div className="jv-br-b" />
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                      {v.method}
                    </div>
                    <VerdictBadge verdict={v.verdict} />
                  </div>
                  <div className="jv-stat">
                    <span>Implied value / share</span>
                    <b>{v.impliedValuePerShare !== null ? `$${v.impliedValuePerShare.toFixed(2)}` : "N/A"}</b>
                  </div>
                  <div className="jv-stat">
                    <span>vs. market price</span>
                    <b>{v.percentDifference !== null ? `${v.percentDifference > 0 ? "+" : ""}${v.percentDifference.toFixed(1)}%` : "N/A"}</b>
                  </div>
                  <div className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                    {v.assumptions}
                  </div>
                  {v.note && (
                    <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                      {v.note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="jv-strip-title">6. Sector Peer Ranking</div>
            <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
              Opt-in — fetches several peer companies&apos; statements, which spends real FMP API quota. Grouped
              by FMP&apos;s own sector/industry taxonomy (FMP&apos;s free tier doesn&apos;t expose NAICS codes).
            </p>
            {!peerRanking && (
              <button
                onClick={runPeerRanking}
                disabled={peerLoading}
                className="px-5 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--signal)", color: "var(--ink-950)" }}
              >
                {peerLoading ? "Ranking…" : "Rank against sector peers"}
              </button>
            )}
            {peerError && (
              <div className="jv-card mt-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                {peerError}
              </div>
            )}
            {peerRanking && (
              <div className="mt-2 flex flex-col gap-4">
                <p className="text-xs" style={{ color: "var(--text-2)" }}>
                  {peerRanking.classificationNote}
                </p>
                {peerRanking.dataLimitations.map((d) => (
                  <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                    {d}
                  </div>
                ))}
                <div className="flex flex-col gap-3">
                  {peerRanking.rankings.map((r) => (
                    <div key={r.ratioLabel} className="jv-card">
                      <div className="jv-br-b" />
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                          {r.ratioLabel}
                        </div>
                        <span className="text-xs" style={{ color: "var(--text-2)" }}>
                          {r.higherIsBetter ? "Higher is better" : "Lower is better"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <StatCard
                          label={`${peerRanking.ticker} Value`}
                          value={r.targetValue !== null ? `${r.targetValue.toFixed(2)}${r.unit === "%" ? "%" : r.unit === "x" ? "x" : ""}` : "N/A"}
                        />
                        <StatCard label="Rank" value={r.rank !== null ? `#${r.rank} of ${r.totalRanked}` : "N/A"} />
                        <StatCard label="Percentile" value={r.percentile !== null ? `${r.percentile.toFixed(0)}th` : "N/A"} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section>
            <div className="jv-strip-title">7. Financial Statements</div>
            <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
              Raw line items behind every ratio above, most recent year first.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    {[
                      "Fiscal Year",
                      "Revenue",
                      "Gross Profit",
                      "Operating Income",
                      "Net Income",
                      "EPS",
                      "Total Assets (Current)",
                      "Total Liabilities",
                      "Stockholders' Equity",
                      "Total Debt",
                      "Cash",
                      "Operating Cash Flow",
                      "CapEx",
                      "Free Cash Flow",
                    ].map((h) => (
                      <th key={h} className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                  {data.financialStatements.map((y) => (
                    <tr key={y.fiscalYear} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className="py-2 pr-4 font-medium font-mono" style={{ color: "var(--text-0)" }}>
                        {y.fiscalYear}
                      </td>
                      {[
                        formatMoney(y.revenue),
                        formatMoney(y.grossProfit),
                        formatMoney(y.operatingIncome),
                        formatMoney(y.netIncome),
                        `$${y.eps.toFixed(2)}`,
                        formatMoney(y.totalCurrentAssets),
                        formatMoney(y.totalLiabilities),
                        formatMoney(y.totalStockholdersEquity),
                        formatMoney(y.totalDebt),
                        formatMoney(y.cashAndCashEquivalents),
                        formatMoney(y.operatingCashFlow),
                        formatMoney(y.capitalExpenditure),
                        formatMoney(y.freeCashFlow),
                      ].map((v, i) => (
                        <td key={i} className="py-2 pr-4 font-mono whitespace-nowrap" style={{ color: "var(--text-1)" }}>
                          {v}
                        </td>
                      ))}
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
