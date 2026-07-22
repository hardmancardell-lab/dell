"use client";

import { useState, type ReactNode } from "react";
import { useResearchWatchlist } from "@/lib/agents/research-agent/watchlist-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { getResearchGlossaryEntry } from "@/lib/agents/research-agent/skills/glossary";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import type { SecurityAnalysis, SectorPeerRanking, ValuationVerdict } from "@/lib/agents/research-agent/types";

type QualityTier = "Strong" | "Moderate" | "Weak";

const QUALITY_TIER_STYLES: Record<QualityTier, string> = {
  Strong: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  Moderate: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  Weak: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
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

function StatCard({
  label,
  value,
  sub,
}: {
  label: ReactNode;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

function PassFailBadge({ passed }: { passed: boolean | null }) {
  const className =
    passed === null
      ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      : passed
        ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
        : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${className}`}>
      {passed === null ? "N/A" : passed ? "Pass" : "Fail"}
    </span>
  );
}

const VERDICT_STYLES: Record<ValuationVerdict, string> = {
  undervalued: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  overvalued: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
  "fairly valued": "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  "not applicable": "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
};

function VerdictBadge({ verdict }: { verdict: ValuationVerdict }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${VERDICT_STYLES[verdict]}`}>
      {verdict}
    </span>
  );
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
      <p className="text-zinc-500 mb-6">
        A cold-blooded interrogation of one company&apos;s financial
        statements &mdash; NCAV, earnings stability, debt coverage, and the
        Graham multiplier.
      </p>

      <form onSubmit={runAnalysis} className="flex gap-3">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
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
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {data.companyName} ({data.ticker})
                </h2>
                <p className="text-sm text-zinc-500 mt-1">
                  {data.sector} &middot; {data.industry}
                </p>
              </div>
              <button
                onClick={() => addSymbol(data.ticker)}
                disabled={watchlist.some((w) => w.symbol === data.ticker)}
                className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 px-3 py-1 text-xs font-medium"
              >
                {watchlist.some((w) => w.symbol === data.ticker) ? "On Watchlist" : "+ Save to Watchlist"}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <div className="text-2xl font-semibold">
                {passedCount} / {data.checklist.length} Graham criteria passed
              </div>
              <GlossaryTerm term="qualityTier" getEntry={getResearchGlossaryEntry}>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${QUALITY_TIER_STYLES[qualityTier(passedCount, data.checklist.length)]}`}
                >
                  {qualityTier(passedCount, data.checklist.length)}
                </span>
              </GlossaryTerm>
            </div>
          </section>

          {data.dataLimitations.length > 0 && (
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
          )}

          <section>
            <h2 className="text-xl font-semibold mb-3">The Graham Checklist</h2>
            <div className="space-y-3">
              {data.checklist.map((c) => (
                <div
                  key={c.criterion}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{c.criterion}</div>
                    <PassFailBadge passed={c.passed} />
                  </div>
                  <div className="text-sm text-zinc-500 mt-1">{c.detail}</div>
                </div>
              ))}
            </div>
          </section>

          {data.sectorPanel && (
            <section>
              <h2 className="text-xl font-semibold mb-1">
                Sector-Specific: {data.sectorPanel.subSector}
              </h2>
              <p className="text-sm text-zinc-500 mb-3">{data.sectorPanel.classificationNote}</p>
              <div className="space-y-3">
                {data.sectorPanel.ratios.map((r) => (
                  <div
                    key={r.label}
                    className={`rounded-lg border p-4 ${
                      r.available
                        ? "border-zinc-200 dark:border-zinc-800"
                        : "border-dashed border-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">{r.label}</div>
                      {r.available ? (
                        <PassFailBadge passed={r.passed} />
                      ) : (
                        <span className="text-xs text-zinc-500">Not available</span>
                      )}
                    </div>
                    {r.available && (
                      <div className="text-lg font-semibold mt-1">{r.value}</div>
                    )}
                    <div className="text-sm text-zinc-500 mt-1">{r.benchmark}</div>
                    {r.note && (
                      <div className="text-xs text-zinc-400 mt-1">{r.note}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xl font-semibold mb-3">
              1. Earning Power ({data.earningPower.yearsAvailable}/
              {data.earningPower.yearsRequested} years)
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="Average Net Income"
                value={`$${(data.earningPower.averageNetIncome / 1_000_000).toFixed(1)}M`}
                sub={data.earningPower.warning ?? undefined}
              />
              <StatCard
                label="Deficit Years"
                value={String(data.earningPower.deficitYears)}
              />
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              2. Net-Current-Asset Value (Liquidation Floor)
            </h2>
            <div className="grid grid-cols-2 gap-4">
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
                value={
                  data.ncav.priceToNcav !== null
                    ? `${(data.ncav.priceToNcav * 100).toFixed(0)}%`
                    : "N/A"
                }
                sub={data.ncav.isBargain ? "Below 2/3 of NCAV — Graham bargain" : undefined}
              />
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">
              3. Liquidity &amp; Solvency
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="Current Ratio"
                value={data.liquidity.currentRatio.toFixed(2)}
                sub="Graham floor: 2.0"
              />
              <StatCard
                label={
                  <GlossaryTerm term="fixedChargeCoverage" getEntry={getResearchGlossaryEntry}>
                    Fixed-Charge Coverage
                  </GlossaryTerm>
                }
                value={
                  data.solvency.fixedChargeCoverage !== null
                    ? `${data.solvency.fixedChargeCoverage.toFixed(1)}x`
                    : "No debt"
                }
                sub="Graham floor: 4x"
              />
              <StatCard
                label="Debt / Equity"
                value={
                  data.solvency.debtToEquity !== null
                    ? data.solvency.debtToEquity.toFixed(2)
                    : "N/A"
                }
                sub={data.solvency.topHeavy ? "Top-heavy capital structure" : undefined}
              />
              <StatCard
                label="Dividend Record"
                value={`${data.dividends.consecutiveYearsPaid} yrs`}
                sub={`Graham floor: ${data.dividends.yearsRequested} yrs`}
              />
            </div>
            {data.dividends.growthTrend && (
              <p className="text-sm text-zinc-500 mt-3">
                Dividend total per year has been{" "}
                <span
                  className={
                    data.dividends.growthTrend === "growing"
                      ? "text-green-700 dark:text-green-400 font-medium"
                      : data.dividends.growthTrend === "declining"
                        ? "text-red-700 dark:text-red-400 font-medium"
                        : "font-medium"
                  }
                >
                  {data.dividends.growthTrend}
                </span>{" "}
                over the available history (comparing the most recent full year to ~5 years earlier, or as far back
                as data allows) — supplements the {data.dividends.yearsRequested}-year record criterion above,
                doesn&apos;t change it.
              </p>
            )}
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Valuation</h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="PE (3yr avg EPS)"
                value={data.valuation.peRatio !== null ? data.valuation.peRatio.toFixed(1) : "N/A"}
              />
              <StatCard
                label="PB (book value)"
                value={data.valuation.pbRatio !== null ? data.valuation.pbRatio.toFixed(1) : "N/A"}
              />
              <StatCard
                label={
                  <GlossaryTerm term="grahamMultiplier" getEntry={getResearchGlossaryEntry}>
                    Graham Multiplier (PE x PB)
                  </GlossaryTerm>
                }
                value={
                  data.valuation.grahamMultiplier !== null
                    ? data.valuation.grahamMultiplier.toFixed(1)
                    : "N/A"
                }
                sub="Graham ceiling: 22.5"
              />
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-1">5. Valuation Methods vs. Market Price</h2>
            <p className="text-sm text-zinc-500 mb-3">
              Every method compared against the current market price of ${data.valuation.price.toFixed(2)}.
              Each has its own assumptions listed underneath — these are scenarios, not a single answer.
            </p>
            <div className="space-y-3">
              {data.valuationMethods.map((v) => (
                <div key={v.method} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">{v.method}</div>
                    <VerdictBadge verdict={v.verdict} />
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <StatCard
                      label="Implied Value / Share"
                      value={v.impliedValuePerShare !== null ? `$${v.impliedValuePerShare.toFixed(2)}` : "N/A"}
                    />
                    <StatCard
                      label="vs. Market Price"
                      value={v.percentDifference !== null ? `${v.percentDifference > 0 ? "+" : ""}${v.percentDifference.toFixed(1)}%` : "N/A"}
                    />
                  </div>
                  <div className="text-xs text-zinc-500 mt-2">{v.assumptions}</div>
                  {v.note && <div className="text-xs text-zinc-400 mt-1">{v.note}</div>}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-1">6. Sector Peer Ranking</h2>
            <p className="text-sm text-zinc-500 mb-3">
              Opt-in — fetches several peer companies&apos; statements, which
              spends real FMP API quota. Grouped by FMP&apos;s own
              sector/industry taxonomy (FMP&apos;s free tier doesn&apos;t
              expose NAICS codes).
            </p>
            {!peerRanking && (
              <button
                onClick={runPeerRanking}
                disabled={peerLoading}
                className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {peerLoading ? "Ranking…" : "Rank against sector peers"}
              </button>
            )}
            {peerError && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
                {peerError}
              </div>
            )}
            {peerRanking && (
              <div className="mt-2 space-y-4">
                <p className="text-xs text-zinc-500">{peerRanking.classificationNote}</p>
                {peerRanking.dataLimitations.map((d) => (
                  <div
                    key={d.slice(0, 30)}
                    className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
                  >
                    {d}
                  </div>
                ))}
                <div className="space-y-3">
                  {peerRanking.rankings.map((r) => (
                    <div key={r.ratioLabel} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm">{r.ratioLabel}</div>
                        <span className="text-xs text-zinc-500">
                          {r.higherIsBetter ? "Higher is better" : "Lower is better"}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-4 mt-2">
                        <StatCard
                          label={`${peerRanking.ticker} Value`}
                          value={r.targetValue !== null ? `${r.targetValue.toFixed(2)}${r.unit === "%" ? "%" : r.unit === "x" ? "x" : ""}` : "N/A"}
                        />
                        <StatCard
                          label="Rank"
                          value={r.rank !== null ? `#${r.rank} of ${r.totalRanked}` : "N/A"}
                        />
                        <StatCard
                          label="Percentile"
                          value={r.percentile !== null ? `${r.percentile.toFixed(0)}th` : "N/A"}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-1">7. Financial Statements</h2>
            <p className="text-sm text-zinc-500 mb-3">
              Raw line items behind every ratio above, most recent year first.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Fiscal Year</th>
                    <th className="py-2 pr-4">Revenue</th>
                    <th className="py-2 pr-4">Gross Profit</th>
                    <th className="py-2 pr-4">Operating Income</th>
                    <th className="py-2 pr-4">Net Income</th>
                    <th className="py-2 pr-4">EPS</th>
                    <th className="py-2 pr-4">Total Assets (Current)</th>
                    <th className="py-2 pr-4">Total Liabilities</th>
                    <th className="py-2 pr-4">Stockholders&apos; Equity</th>
                    <th className="py-2 pr-4">Total Debt</th>
                    <th className="py-2 pr-4">Cash</th>
                    <th className="py-2 pr-4">Operating Cash Flow</th>
                    <th className="py-2 pr-4">CapEx</th>
                    <th className="py-2 pr-4">Free Cash Flow</th>
                  </tr>
                </thead>
                <tbody>
                  {data.financialStatements.map((y) => (
                    <tr key={y.fiscalYear} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-medium">{y.fiscalYear}</td>
                      <td className="py-2 pr-4">{formatMoney(y.revenue)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.grossProfit)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.operatingIncome)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.netIncome)}</td>
                      <td className="py-2 pr-4">${y.eps.toFixed(2)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.totalCurrentAssets)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.totalLiabilities)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.totalStockholdersEquity)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.totalDebt)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.cashAndCashEquivalents)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.operatingCashFlow)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.capitalExpenditure)}</td>
                      <td className="py-2 pr-4">{formatMoney(y.freeCashFlow)}</td>
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
