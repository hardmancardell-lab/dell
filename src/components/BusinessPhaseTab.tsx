"use client";

import { ResearchNotice } from "./ResearchNotice";
import { useState } from "react";
import { StatCard } from "./StatCard";
import { PhaseLadder, RatingGauge, RevenueProfitChart, SeriesLegend, ValueCurveChart, ratingColor } from "./PhaseCharts";
import type { SeriesKey } from "./PhaseCharts";
import { PHASE_NAMES, PHASE_PLAIN, PHASE_RULE_LABEL } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import type { LifecycleAnalysis, Phase, PhaseRule, PhaseThresholds } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import type { LensMetric, PhaseValuation } from "@/lib/agents/research-agent/skills/phase-valuation";
import { RATING_MEANING } from "@/lib/agents/research-agent/skills/valuation-rating";
import type { RatingBands, ValuationRating } from "@/lib/agents/research-agent/skills/valuation-rating";

interface ApiResult {
  ticker: string;
  analysis: LifecycleAnalysis;
  valuation: PhaseValuation | null;
  rating: ValuationRating | null;
  valuationNote: string | null;
  historySource: "market-data" | "entered" | "none";
  historyNote: string | null;
  ratingBands: RatingBands;
  computedPhase: Phase | null;
  valuedAsPhase: Phase | null;
  overridden: boolean;
  price: { value: number | null; source: "provided" | "market-data" | "unavailable" };
  riskFreePct: number | null;
  thresholds: PhaseThresholds;
  disclaimer: string;
  error?: string;
}

const B = (v: number | null | undefined) => (v == null ? "n/a" : Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const P = (v: number | null | undefined, dp = 1) => (v == null ? "n/a" : `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(dp)}%`);
const signed = (v: number | null | undefined, dp = 1) => (v == null ? "n/a" : `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(dp)}%`);

function metricText(m: LensMetric): string {
  if (m.value === null) return "n/a";
  if (m.format === "x") return `${m.value.toFixed(1)}x`;
  if (m.format === "pct") return `${m.value.toFixed(2)}%`;
  return B(m.value);
}

const PROFIT_KEY: Record<string, SeriesKey> = { operatingIncome: "operatingProfit", freeCashFlow: "freeCashFlow", netIncome: "netIncome" };

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm" style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
      <span style={{ color: "var(--text-1)" }}>{label}</span>
      <span className="jv-num" style={{ color: "var(--text-0)", fontWeight: strong ? 600 : 400, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function QuestionCard({ number, question, answer, tone, detail, headline, source, children }: {
  number: number;
  question: string;
  answer: "yes" | "no" | "unknown";
  tone: "up" | "down" | "neutral";
  detail: string;
  headline: string;
  source: string;
  children: React.ReactNode;
}) {
  const color = tone === "up" ? "var(--signal)" : tone === "down" ? "var(--danger)" : "var(--text-1)";
  return (
    <section className="jv-card flex flex-col gap-3" aria-label={question} style={{ minWidth: 0 }}>
      <div className="jv-br-b" />
      <div className="jv-label" style={{ marginBottom: 0 }}>Question {number}</div>
      <h3 className="text-base font-semibold" style={{ color: "var(--text-0)" }}>{question}</h3>
      <div>
        <span className="jv-cond" style={{ fontSize: 34, lineHeight: 1.1, color, display: "inline-block", marginBottom: 0 }}>{answer === "yes" ? "Yes" : answer === "no" ? "No" : "Unclear"}</span>
        <span className="text-xs" style={{ color: "var(--text-2)", marginLeft: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{detail}</span>
      </div>
      <p className="text-sm" style={{ color: "var(--text-1)" }}>{headline}</p>
      <div>{children}</div>
      <p className="text-xs" style={{ color: "var(--text-2)" }}>{source}</p>
    </section>
  );
}

export function BusinessPhaseTab() {
  const [ticker, setTicker] = useState("NVDA");
  const [price, setPrice] = useState("");
  const [avgs, setAvgs] = useState({ avgPE: "", avgPS: "", avgPGP: "", avgPFCF: "" });
  const [phaseChoice, setPhaseChoice] = useState("");
  // How a profitable company that is both growing and returning cash is placed. Under review by the founder.
  const [phaseRule, setPhaseRule] = useState<PhaseRule>("capital-return-first");
  const [rate, setRate] = useState("10");
  const [terminal, setTerminal] = useState("3");
  const [years, setYears] = useState("10");
  const [basis, setBasis] = useState<"fcf" | "fcfAfterStockPay">("fcf");
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ revenue: true, operatingProfit: true, netIncome: true, freeCashFlow: true });

  async function run(overridePhase?: string, overrideRule?: PhaseRule) {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ ticker: sym, rate, terminal, years, basis, rule: overrideRule ?? phaseRule });
    if (price.trim()) qs.set("price", price.trim());
    const phase = overridePhase !== undefined ? overridePhase : phaseChoice;
    if (phase) qs.set("phase", phase);
    for (const [k, v] of Object.entries(avgs)) if (v.trim()) qs.set(k, v.trim());
    try {
      const res = await fetch(`/api/company-lifecycle?${qs}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) throw new Error("The app returned a non-JSON response. If you are signed out, sign in and try again.");
      const json = (await res.json()) as ApiResult;
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const a = data?.analysis;
  const v = data?.valuation ?? null;
  const rt = data?.rating ?? null;
  const emphasize: SeriesKey = a ? PROFIT_KEY[a.profit.metric.key] ?? "operatingProfit" : "operatingProfit";
  const rev = a?.revenue;
  const pr = a?.profit;
  const cr = a?.capitalReturn;
  const ttmPoint = a?.chart.find((c) => c.isTtm) ?? a?.chart[a.chart.length - 1];

  return (
    <div className="jarvis flex flex-col gap-8">
      <ResearchNotice source="SEC EDGAR company filings, Alpaca daily prices and FRED" hypothetical={false}>
        The phase and the valuation rating come from fixed rules applied to the filings. They place a company in its life cycle; they are not a forecast of its price.
      </ResearchNotice>
      <div>
        <div className="jv-eyebrow">Business phase</div>
        <h1 className="jv-title">Where is the business in its life, and what does that say about its price?</h1>
        <p className="jv-lede" style={{ maxWidth: "70ch" }}>
          Three questions, answered from the company&apos;s own filings with the SEC, place it in one of five phases. The phase decides which way of valuing it makes sense.
        </p>
      </div>

      <form
        className="jv-card flex flex-wrap gap-4 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="jv-br-b" />
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Stock symbol</span>
          <input className="jv-input" value={ticker} maxLength={10} onChange={(e) => setTicker(e.target.value.toUpperCase())} style={{ width: 130 }} aria-label="Stock symbol" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Price ($, optional)</span>
          <input className="jv-input" type="number" step="any" min={0} value={price} placeholder="live price" onChange={(e) => setPrice(e.target.value)} style={{ width: 150 }} aria-label="Price" />
        </label>
        <button type="submit" className="jv-btn" disabled={loading || !ticker.trim()}>{loading ? "Reading the filings…" : "Analyze"}</button>
        {!data && !loading && <button type="button" className="jv-btn-outline" onClick={() => { setTicker("NVDA"); setPrice("239.10"); }}>Use the NVIDIA example ($239.10)</button>}
        <p className="text-xs" style={{ color: "var(--text-2)", flexBasis: "100%", maxWidth: "75ch" }}>
          Leave the price blank to use the app&apos;s live quote. Financial figures come from the company&apos;s 10-K and 10-Q filings, so they are as current as its latest filing.
        </p>
      </form>

      {error && <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{error}</div>}

      {data && a && rev && pr && cr && (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{a.company || data.ticker}: the three questions</h2>
              <span className="text-xs" style={{ color: "var(--text-2)" }}>Filings through {a.asOf}</span>
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))" }}>
              <QuestionCard
                number={1} question="Is revenue growing?" answer={rev.answer} tone={rev.answer === "yes" ? "up" : "down"}
                detail={rev.growthClass === "fast" ? "Fast growth" : rev.growthClass === "growing" ? "Steady growth" : rev.growthClass === "slow" ? "Flat" : rev.growthClass === "shrinking" ? "Shrinking" : ""}
                headline={rev.headline} source={`From ${rev.basis === "ttm" ? "the last four reported quarters compared with the four before" : "the last two fiscal years"} in the 10-K and 10-Q filings.`}
              >
                <Row label="Revenue, last twelve months" value={B(ttmPoint?.revenue)} strong />
                <Row label="Growth vs a year earlier" value={signed(rev.basis === "ttm" ? rev.growthPct : null)} />
                <Row label="Last fiscal year" value={signed(rev.lastFiscalYearGrowthPct)} />
                <Row label="Average yearly growth, 3 years" value={signed(rev.threeYearCagrPct, 0)} />
              </QuestionCard>

              <QuestionCard
                number={2} question="Is it profitable?" answer={pr.answer} tone={pr.answer === "yes" ? "up" : "down"}
                detail={pr.profitClass === "strong" ? "Highly profitable" : pr.profitClass === "profitable" ? "Profitable" : pr.profitClass === "thin" ? "Thin margin" : pr.profitClass === "unprofitable" ? "Losing money" : ""}
                headline={pr.headline} source={`Judged on ${pr.metric.label.toLowerCase()}. ${pr.metric.reason}`}
              >
                <Row label={`${pr.metric.label} margin`} value={P(pr.marginPct, 0)} strong />
                <Row label="Two fiscal years ago" value={P(pr.marginTwoYearsAgoPct, 0)} />
                <Row label="Direction" value={pr.trend === "improving" ? "Improving" : pr.trend === "weakening" ? "Weakening" : pr.trend === "steady" ? "Steady" : "n/a"} />
                <Row label="Net income margin" value={P(pr.netMarginPct, 0)} />
                <Row label="Free cash flow margin" value={P(pr.fcfMarginPct, 0)} />
              </QuestionCard>

              <QuestionCard
                number={3} question="Is it returning capital to shareholders?" answer={cr.answer} tone={cr.answer === "yes" ? "up" : "neutral"}
                detail={cr.returnClass === "heavy" ? "Most of its cash" : cr.returnClass === "some" ? "Part of its cash" : cr.returnClass === "none" ? "Little or none" : ""}
                headline={cr.headline} source="Share buybacks and dividends paid, compared with free cash flow (cash from operations minus capital spending), last twelve months."
              >
                <Row label="Share buybacks" value={B(cr.buybacks)} />
                <Row label="Dividends" value={B(cr.dividends)} />
                <Row label="Total returned" value={B(cr.returned)} strong />
                <Row label="Share of free cash flow" value={P(cr.payoutPct, 0)} />
                <Row label="After subtracting stock pay" value={P(cr.payoutNetOfStockCompPct, 0)} />
                <Row label="Share count, last fiscal year" value={signed(cr.shareCountChangePct)} />
              </QuestionCard>
            </div>
          </section>

          <section className="jv-card flex flex-col gap-4">
            <div className="jv-br-b" />
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>
                {a.phase.phase ? `Phase ${a.phase.phase}: ${PHASE_NAMES[a.phase.phase]}` : "Phase could not be worked out"}
              </h2>
              {a.phase.phase && <span className="jv-badge c-signal">{a.phase.confidence} confidence</span>}
            </div>
            <PhaseLadder phase={a.phase.phase} valuedAs={data.valuedAsPhase} />
            {a.phase.phase && (
              <p className="text-sm" style={{ color: "var(--text-1)", maxWidth: "75ch" }}>
                {a.phase.phase === 4 && (rev.growthClass === "fast" || rev.growthClass === "growing")
                  ? "The business is profitable and returns a meaningful share of its cash to shareholders. Its revenue is still growing, so this is not the usual slow-growth version of this phase."
                  : PHASE_PLAIN[a.phase.phase]}
              </p>
            )}
            {a.phase.decidedBy.length > 0 && (
              <ul className="text-sm" style={{ color: "var(--text-1)", paddingLeft: 18 }}>
                {a.phase.decidedBy.map((d) => <li key={d}>{d}</li>)}
              </ul>
            )}
            {a.phase.note && <p className="text-sm" style={{ color: "var(--text-1)", maxWidth: "75ch" }}>{a.phase.note}</p>}
            {a.phase.alsoConsistentWith.map((x) => (
              <p key={x.phase} className="text-sm" style={{ color: "var(--text-1)", maxWidth: "75ch" }}>
                <b style={{ color: "var(--text-0)" }}>Also consistent with phase {x.phase} ({PHASE_NAMES[x.phase]}):</b> {x.reason}
              </p>
            ))}
            <div className="p-3 rounded" style={{ background: "var(--ink-800)", border: "1px solid var(--verdict)" }}>
              <div className="text-xs" style={{ color: "var(--verdict)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Note: the phase rule is under review</div>
              <p className="text-sm mt-1" style={{ color: "var(--text-1)", maxWidth: "80ch" }}>
                Right now a profitable company that returns a meaningful share of its free cash flow to shareholders is placed in phase 4, even when revenue is still growing fast. The earlier rule let growth decide. Both are kept so they can be compared while the question is looked at from other angles.
              </p>
              <label className="flex flex-wrap items-center gap-2 text-sm mt-2" style={{ color: "var(--text-1)" }}>
                Phase rule
                <select
                  className="jv-select"
                  value={phaseRule}
                  onChange={(e) => { const r = e.target.value as PhaseRule; setPhaseRule(r); run(undefined, r); }}
                  aria-label="Phase rule"
                >
                  {(Object.keys(PHASE_RULE_LABEL) as PhaseRule[]).map((r) => <option key={r} value={r}>{PHASE_RULE_LABEL[r]}</option>)}
                </select>
                <span className="text-xs" style={{ color: "var(--text-2)" }}>In use: {PHASE_RULE_LABEL[a.rule]}</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-1)" }}>
                Value it as
                <select
                  className="jv-select"
                  value={phaseChoice}
                  onChange={(e) => { setPhaseChoice(e.target.value); run(e.target.value); }}
                  aria-label="Value it as phase"
                >
                  <option value="">The computed phase{a.phase.phase ? ` (${a.phase.phase})` : ""}</option>
                  {([1, 2, 3, 4, 5] as Phase[]).map((p) => <option key={p} value={p}>Phase {p}: {PHASE_NAMES[p]}</option>)}
                </select>
              </label>
              <span className="text-xs" style={{ color: "var(--text-2)" }}>Pick another phase to see how its valuation measures would read this company.</span>
            </div>
            {a.trajectory.length > 0 && (
              <div>
                <div className="jv-label">The same rule applied to each fiscal year</div>
                <div className="flex flex-wrap gap-2">
                  {a.trajectory.map((t) => (
                    <span key={t.label} className="text-xs" style={{ padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 3, color: "var(--text-1)" }} title={`Growth ${signed(t.growthPct, 0)}, margin ${P(t.marginPct, 0)}, cash returned ${t.payoutPct === null ? "n/a" : P(t.payoutPct, 0)} of free cash flow`}>
                      {t.label}: {t.phase ?? "?"} {t.phase ? PHASE_NAMES[t.phase] : ""}
                    </span>
                  ))}
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-2)", maxWidth: "75ch" }}>A single year is noisy for a business that goes through cycles. A year of flat sales can read as a different phase and then reverse.</p>
              </div>
            )}
            <details className="text-sm" style={{ color: "var(--text-1)" }}>
              <summary style={{ cursor: "pointer", color: "var(--signal)" }}>How the phase is decided, and the lines used</summary>
              <div className="mt-2 flex flex-col gap-1" style={{ maxWidth: "75ch" }}>
                <p>Both rules: revenue shrinking is phase 5, and not profitable is phase 1. For a profitable company, <b>capital return first</b> (current): it returns a meaningful share of its free cash flow, phase 4; otherwise fast growth is phase 2, steady growth phase 3, slow growth phase 4. <b>Growth first</b>: fast growth is phase 2, steady growth phase 3 (or 4 if it returns most of its cash), slow growth phase 4.</p>
                <p>Lines used (judgement calls, not facts): growth of {data.thresholds.fastGrowthPct}% or more is fast, {data.thresholds.growingPct}% or more is steady, below {data.thresholds.shrinkingPct}% is shrinking. A profit margin under {data.thresholds.thinMarginPct}% is thin and {data.thresholds.strongMarginPct}% or more is strong. Returning {data.thresholds.returnSomePct}% of free cash flow is some, {data.thresholds.returnHeavyPct}% or more is most of it.</p>
                <p>Under growth first, returning capital on its own does not move a fast grower to phase 4; it is shown as a sign the company may be heading toward phase 3 or 4. Under capital return first, growth is shown as the alternative reading instead.</p>
                <p>Capital-heavy businesses are judged on free cash flow because operating profit hides what they must keep spending. Asset-light ones are judged on operating profit.</p>
              </div>
            </details>
          </section>

          <section className="jv-card flex flex-col gap-3">
            <div className="jv-br-b" />
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>Revenue and profit</h2>
            <p className="text-sm" style={{ color: "var(--text-1)", maxWidth: "75ch" }}>
              Each fiscal year, plus the last twelve months (hollow dot). The highlighted line, <b style={{ color: "var(--signal)" }}>{pr.metric.label.toLowerCase()}</b>, is the profit measure used for the question above. {pr.metric.reason}
            </p>
            <SeriesLegend visible={visible} emphasize={emphasize} onToggle={(k) => setVisible((s) => ({ ...s, [k]: !s[k] }))} />
            <RevenueProfitChart points={a.chart} visible={visible} emphasize={emphasize} />
            <p className="text-xs" style={{ color: "var(--text-2)" }}>Source: the company&apos;s 10-K and 10-Q filings. Hover a dot for its exact value.</p>
          </section>

          {v && rt ? (
            <section className="jv-card flex flex-col gap-5">
              <div className="jv-br-b" />
              <div>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>Is it cheap or expensive at {data.price.value ? `$${data.price.value.toFixed(2)}` : "this price"}?</h2>
                <p className="text-sm" style={{ color: "var(--text-1)", maxWidth: "75ch" }}>
                  Valued as phase {v.phase}, {v.phaseName.toLowerCase()}. The question for this phase: {v.question.toLowerCase()}
                  {data.overridden && " (You chose this phase; the computed one is " + (data.computedPhase ?? "unknown") + ".)"}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  {rt.headline ? (
                    <span className="jv-cond" style={{ fontSize: 28, margin: 0, color: ratingColor(rt.headline), textTransform: "capitalize" }}>{rt.headline}</span>
                  ) : (
                    <span className="jv-cond c-neutral" style={{ fontSize: 22, margin: 0 }}>No rating yet</span>
                  )}
                  {rt.headline && <span className="text-sm" style={{ color: "var(--text-1)" }}>{RATING_MEANING[rt.headline]}</span>}
                </div>
                <RatingGauge premiumPct={rt.averagePremiumPct} bands={data.ratingBands} headline={rt.headline} />
                <p className="text-xs" style={{ color: "var(--text-2)", maxWidth: "75ch" }}>{rt.definition}</p>
                {rt.note && <p className="text-sm" style={{ color: "var(--verdict)", maxWidth: "75ch" }}>{rt.note}</p>}
                {data.historyNote && data.historySource === "none" && <p className="text-xs" style={{ color: "var(--text-2)", maxWidth: "75ch" }}>{data.historyNote}</p>}
              </div>

              <div>
                <div className="jv-label">The measures for this phase</div>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
                  {v.metrics.filter((m) => m.tier === "primary").map((m) => (
                    <StatCard key={m.key} label={m.label} value={metricText(m)} sub={m.note} />
                  ))}
                </div>
                <div className="grid gap-x-6 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                  {v.metrics.filter((m) => m.tier === "supporting").map((m) => (
                    <div key={m.key} title={m.note}><Row label={m.label} value={metricText(m)} /></div>
                  ))}
                </div>
              </div>

              {rt.perMultiple.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <div className="jv-label">Against its own past year</div>
                  <table className="jv-table" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th className="text-left">Measure</th>
                        <th className="text-right">Now</th>
                        <th className="text-right">Past-year average</th>
                        <th className="text-right">Difference</th>
                        <th className="text-right">Past-year range</th>
                        <th className="text-left">Reading</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rt.perMultiple.map((m) => (
                        <tr key={m.key}>
                          <td>{m.label}</td>
                          <td className="jv-num">{m.current.toFixed(1)}x</td>
                          <td className="jv-num">{m.average.toFixed(1)}x{m.basis === "entered" ? " (you entered)" : ""}</td>
                          <td className="jv-num" style={{ color: m.premiumPct <= 0 ? "var(--signal)" : "var(--verdict)" }}>{signed(m.premiumPct)}</td>
                          <td className="jv-num" style={{ color: "var(--text-2)" }}>{m.low !== null && m.high !== null ? `${m.low.toFixed(1)}x to ${m.high.toFixed(1)}x` : "n/a"}</td>
                          <td style={{ color: ratingColor(m.rating), textTransform: "capitalize" }}>{m.rating}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                    {data.historySource === "market-data" ? "Averages come from month-end prices over the past 12 months, each paired with the earnings the market had been shown by that date." : "At least one average was entered by you rather than computed."}
                  </p>
                </div>
              )}

              <details className="text-sm" style={{ color: "var(--text-1)" }}>
                <summary style={{ cursor: "pointer", color: "var(--signal)" }}>Compare against a one-year average you already know</summary>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {([["avgPE", "Price / earnings"], ["avgPS", "Price / sales"], ["avgPGP", "Price / gross profit"], ["avgPFCF", "Price / free cash flow"]] as const).map(([k, label]) => (
                    <label key={k} className="flex flex-col gap-1">
                      <span className="jv-label" style={{ marginBottom: 0 }}>{label}</span>
                      <input className="jv-input" type="number" step="any" min={0} value={avgs[k]} placeholder="e.g. 48.7" onChange={(e) => setAvgs((s) => ({ ...s, [k]: e.target.value }))} style={{ width: 120 }} aria-label={`Average ${label}`} />
                    </label>
                  ))}
                  <button type="button" className="jv-btn-outline" onClick={() => run()}>Update rating</button>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-2)", maxWidth: "75ch" }}>A value you enter replaces the computed average for that measure and is labelled as entered.</p>
              </details>

              <div>
                <div className="jv-label">Cross-checks (shown beside the rating, not blended into it)</div>
                <ul className="flex flex-col gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {rt.crossChecks.map((c) => (
                    <li key={c.title} className="text-sm" style={{ color: "var(--text-1)", maxWidth: "80ch" }}>
                      <span className="jv-badge" style={{ marginRight: 8 }}>{c.direction === "supports" ? "Supports it" : c.direction === "tempers" ? "Tempers it" : "Context"}</span>
                      <b style={{ color: "var(--text-0)" }}>{c.title}.</b> {c.detail}
                    </li>
                  ))}
                </ul>
              </div>

              {v.statements.length > 0 && (
                <div>
                  <div className="jv-label">What the price is assuming</div>
                  <ul className="text-sm flex flex-col gap-2" style={{ color: "var(--text-1)", paddingLeft: 18, maxWidth: "80ch" }}>
                    {v.statements.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              )}

              {v.reverseDcf && v.reverseDcf.baseCashFlow > 0 && data.price.value && (
                <div>
                  <div className="jv-label">What one share is worth under each growth path</div>
                  <ValueCurveChart curve={v.curve} price={data.price.value} impliedGrowth={v.reverseDcf.impliedGrowthPct} />
                  <p className="text-xs" style={{ color: "var(--text-2)", maxWidth: "75ch" }}>Where the curve crosses today&apos;s price is the growth the market is paying for. Discount rate {v.inputs.discountRatePct}%, {v.inputs.years} years, then {v.inputs.terminalGrowthPct}% a year.</p>
                </div>
              )}

              <div style={{ overflowX: "auto" }}>
                <div className="jv-label">How the assumed growth changes with the assumptions</div>
                <table className="jv-table" style={{ minWidth: 420 }}>
                  <thead>
                    <tr>
                      <th className="text-left">Discount rate</th>
                      {[2, 3, 4].map((g) => <th key={g} className="text-right">Terminal growth {g}%</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[8, 10, 12].map((r) => (
                      <tr key={r}>
                        <td>{r}%</td>
                        {[2, 3, 4].map((g) => {
                          const cell = v.sensitivity.find((c) => c.discountRatePct === r && c.terminalGrowthPct === g);
                          return <td key={g} className="jv-num">{cell?.impliedGrowthPct == null ? "n/a" : `${cell.impliedGrowthPct.toFixed(1)}% a year`}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="text-sm" style={{ color: "var(--text-1)" }}>
                <summary style={{ cursor: "pointer", color: "var(--signal)" }}>Change the assumptions</summary>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1"><span className="jv-label" style={{ marginBottom: 0 }}>Discount rate (%)</span><input className="jv-input" type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 110 }} aria-label="Discount rate" /></label>
                  <label className="flex flex-col gap-1"><span className="jv-label" style={{ marginBottom: 0 }}>Terminal growth (%)</span><input className="jv-input" type="number" step="any" value={terminal} onChange={(e) => setTerminal(e.target.value)} style={{ width: 110 }} aria-label="Terminal growth" /></label>
                  <label className="flex flex-col gap-1"><span className="jv-label" style={{ marginBottom: 0 }}>Years</span><input className="jv-input" type="number" value={years} onChange={(e) => setYears(e.target.value)} style={{ width: 90 }} aria-label="Years" /></label>
                  <label className="flex flex-col gap-1">
                    <span className="jv-label" style={{ marginBottom: 0 }}>Cash flow used</span>
                    <select className="jv-select" value={basis} onChange={(e) => setBasis(e.target.value as "fcf" | "fcfAfterStockPay")} aria-label="Cash flow used">
                      <option value="fcf">Free cash flow</option>
                      <option value="fcfAfterStockPay">Free cash flow after stock pay</option>
                    </select>
                  </label>
                  <button type="button" className="jv-btn-outline" onClick={() => run()}>Recalculate</button>
                </div>
              </details>

              <ul className="text-xs flex flex-col gap-1" style={{ color: "var(--text-2)", paddingLeft: 18, maxWidth: "80ch" }}>
                {v.caveats.map((c) => <li key={c}>{c}</li>)}
                <li>{data.disclaimer}</li>
              </ul>
            </section>
          ) : (
            <section className="jv-card">
              <div className="jv-br-b" />
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>Valuation</h2>
              <p className="text-sm mt-1" style={{ color: "var(--text-1)", maxWidth: "75ch" }}>{data.valuationNote ?? "No valuation could be produced."}</p>
              <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>Type a price in the box above and analyze again to value it at that price.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
