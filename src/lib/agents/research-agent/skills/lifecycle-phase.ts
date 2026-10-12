import type { AnnualFinancials, FinancialHistory, PeriodFinancials } from "@/lib/data/sec-financials";

/**
 * Business-phase classifier. Three questions, answered from the company's own
 * filings:
 *   1. Is revenue growing?
 *   2. Is it profitable? (judged on the profit measure that suits the business)
 *   3. Is it returning capital to shareholders?
 * The answers place the company in one of five phases. Every threshold is a
 * named constant below, shown to the user and adjustable, because the phase
 * lines are judgement calls, not facts.
 *
 * Pure functions over a FinancialHistory, so every result can be checked by hand.
 * This describes where a business is today. It does not predict anything and
 * does not say whether to buy or sell.
 */

export type Phase = 1 | 2 | 3 | 4 | 5;

export const PHASE_NAMES: Record<Phase, string> = {
  1: "Start-up",
  2: "Hyper growth",
  3: "Operating leverage",
  4: "Capital return",
  5: "Decline",
};

export const PHASE_PLAIN: Record<Phase, string> = {
  1: "Revenue is growing but the business is not yet making money. It is still proving the model.",
  2: "Revenue is growing very fast and the business is already profitable. Most of the cash goes back into growth.",
  3: "Growth is steady and profit grows faster than sales as the business gets more efficient.",
  4: "Growth has slowed and most of the cash is handed back to shareholders.",
  5: "Revenue is shrinking.",
};

export interface PhaseThresholds {
  /** Revenue growth at or above this is "fast", in percent. */
  fastGrowthPct: number;
  /** Growth at or above this (and below fast) is "growing". */
  growingPct: number;
  /** Growth below this is "shrinking". Small dips above it count as flat. */
  shrinkingPct: number;
  /** Profit margin below this (but above zero) is "thin". */
  thinMarginPct: number;
  /** Profit margin at or above this is "strong". */
  strongMarginPct: number;
  /** Share of free cash flow returned at or above this is "some". */
  returnSomePct: number;
  /** Share of free cash flow returned at or above this is "heavy". */
  returnHeavyPct: number;
  /** Capex as a share of revenue below this makes the business asset-light. */
  assetLightCapexPct: number;
  /** Capex as a share of revenue at or above this makes the business capital-heavy. */
  capitalHeavyCapexPct: number;
}

export const DEFAULT_THRESHOLDS: PhaseThresholds = {
  fastGrowthPct: 25,
  growingPct: 5,
  shrinkingPct: -2,
  thinMarginPct: 5,
  strongMarginPct: 20,
  returnSomePct: 10,
  returnHeavyPct: 60,
  assetLightCapexPct: 8,
  capitalHeavyCapexPct: 15,
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const freeCashFlow = (p: PeriodFinancials): number | null =>
  finite(p.operatingCashFlow) && finite(p.capex) ? p.operatingCashFlow - p.capex : finite(p.operatingCashFlow) ? p.operatingCashFlow : null;
const pctChange = (now: number | null, before: number | null): number | null =>
  finite(now) && finite(before) && before > 0 ? (now / before - 1) * 100 : null;

// ------------------------------------------------------- business model + metric

export type BusinessModel = "asset_light" | "moderate" | "capital_heavy" | "unknown";
export type ProfitMetricKey = "operatingIncome" | "freeCashFlow" | "netIncome";

export interface ProfitMetric {
  key: ProfitMetricKey;
  label: string;
  reason: string;
}

export function capexIntensityPct(p: PeriodFinancials): number | null {
  return finite(p.capex) && finite(p.revenue) && p.revenue > 0 ? (p.capex / p.revenue) * 100 : null;
}

export function businessModel(p: PeriodFinancials, th: PhaseThresholds = DEFAULT_THRESHOLDS): BusinessModel {
  const c = capexIntensityPct(p);
  if (c === null) return "unknown";
  if (c < th.assetLightCapexPct) return "asset_light";
  if (c >= th.capitalHeavyCapexPct) return "capital_heavy";
  return "moderate";
}

/**
 * The profit measure that best answers "is it profitable?" for this kind of
 * business. Asset-light companies spend little to build their product, so
 * operating profit is the clean signal. Capital-heavy ones must keep spending
 * on plant and equipment, so operating profit flatters them and free cash flow
 * (cash left after that spending) is the honest one. If operating profit is
 * not reported (banks, insurers), net income is the fallback.
 */
export function chooseProfitMetric(p: PeriodFinancials, th: PhaseThresholds = DEFAULT_THRESHOLDS): ProfitMetric & { model: BusinessModel; capexPct: number | null } {
  const model = businessModel(p, th);
  const capexPct = capexIntensityPct(p);
  if (!finite(p.operatingIncome)) {
    return { key: "netIncome", label: "Net income", reason: "Operating profit is not reported for this company, so net income is used.", model, capexPct };
  }
  if (model === "capital_heavy") {
    return {
      key: "freeCashFlow",
      label: "Free cash flow",
      reason: `Capital spending is ${capexPct?.toFixed(1)}% of revenue, so operating profit overstates what is left over. Free cash flow counts that spending.`,
      model,
      capexPct,
    };
  }
  return {
    key: "operatingIncome",
    label: "Operating profit",
    reason:
      model === "asset_light"
        ? `Capital spending is only ${capexPct?.toFixed(1)}% of revenue (asset-light), so operating profit is the cleanest signal of whether the business model works.`
        : `Capital spending is ${capexPct?.toFixed(1)}% of revenue, so operating profit is used, with free cash flow shown alongside.`,
    model,
    capexPct,
  };
}

function profitValue(key: ProfitMetricKey, p: PeriodFinancials): number | null {
  if (key === "operatingIncome") return finite(p.operatingIncome) ? p.operatingIncome : null;
  if (key === "netIncome") return finite(p.netIncome) ? p.netIncome : null;
  return freeCashFlow(p);
}

// ------------------------------------------------------------------ the answers

export type GrowthClass = "fast" | "growing" | "slow" | "shrinking" | "unknown";
export type ProfitClass = "strong" | "profitable" | "thin" | "unprofitable" | "unknown";
export type ReturnClass = "heavy" | "some" | "none" | "unknown";

export interface RevenueAnswer {
  answer: "yes" | "no" | "unknown";
  growthClass: GrowthClass;
  /** Growth used to classify: trailing twelve months vs the year before when available, otherwise the last fiscal year. */
  growthPct: number | null;
  basis: "ttm" | "fiscal-year" | "none";
  lastFiscalYearGrowthPct: number | null;
  threeYearCagrPct: number | null;
  headline: string;
}

export interface ProfitAnswer {
  answer: "yes" | "no" | "unknown";
  profitClass: ProfitClass;
  metric: ProfitMetric;
  model: BusinessModel;
  capexPct: number | null;
  value: number | null;
  marginPct: number | null;
  /** Same margin two fiscal years earlier, for direction. */
  marginTwoYearsAgoPct: number | null;
  trend: "improving" | "steady" | "weakening" | "unknown";
  /** Other margins for context. */
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  fcfMarginPct: number | null;
  headline: string;
}

export interface CapitalReturnAnswer {
  answer: "yes" | "no" | "unknown";
  returnClass: ReturnClass;
  buybacks: number | null;
  dividends: number | null;
  returned: number | null;
  freeCashFlow: number | null;
  /** (buybacks + dividends) / free cash flow, in percent. */
  payoutPct: number | null;
  /** The same after subtracting stock-based pay, which buybacks often just offset. */
  payoutNetOfStockCompPct: number | null;
  /** Change in diluted share count over the last fiscal year, in percent (negative = shrinking). */
  shareCountChangePct: number | null;
  headline: string;
}

export function answerRevenue(h: FinancialHistory, th: PhaseThresholds = DEFAULT_THRESHOLDS): RevenueAnswer {
  const a = h.annual;
  const last = a[a.length - 1];
  const prev = a[a.length - 2];
  const fyGrowth = last && prev ? pctChange(last.revenue, prev.revenue) : null;
  const first3 = a.length >= 4 ? a[a.length - 4] : null;
  const cagr =
    last && first3 && finite(last.revenue) && finite(first3.revenue) && first3.revenue > 0 && last.revenue > 0
      ? (Math.pow(last.revenue / first3.revenue, 1 / 3) - 1) * 100
      : null;
  const ttmGrowth = h.ttm && h.ttmYearAgo ? pctChange(h.ttm.revenue, h.ttmYearAgo.revenue) : null;
  const growth = ttmGrowth ?? fyGrowth;
  const basis: RevenueAnswer["basis"] = ttmGrowth !== null ? "ttm" : fyGrowth !== null ? "fiscal-year" : "none";
  let growthClass: GrowthClass = "unknown";
  if (growth !== null) {
    growthClass = growth >= th.fastGrowthPct ? "fast" : growth >= th.growingPct ? "growing" : growth >= th.shrinkingPct ? "slow" : "shrinking";
  }
  const answer: RevenueAnswer["answer"] = growth === null ? "unknown" : growth >= th.growingPct ? "yes" : "no";
  const when = basis === "ttm" ? "over the last twelve months" : "in the last fiscal year";
  const headline =
    growth === null
      ? "Not enough revenue history to tell."
      : growthClass === "shrinking"
        ? `Revenue fell ${Math.abs(growth).toFixed(0)}% ${when}.`
        : growthClass === "slow"
          ? `Revenue was roughly flat (${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%) ${when}.`
          : `Revenue grew ${growth.toFixed(0)}% ${when}.`;
  return { answer, growthClass, growthPct: growth, basis, lastFiscalYearGrowthPct: fyGrowth, threeYearCagrPct: cagr, headline };
}

function classifyProfit(marginPct: number | null, th: PhaseThresholds): ProfitClass {
  if (marginPct === null) return "unknown";
  if (marginPct <= 0) return "unprofitable";
  if (marginPct < th.thinMarginPct) return "thin";
  if (marginPct >= th.strongMarginPct) return "strong";
  return "profitable";
}

export function answerProfit(h: FinancialHistory, th: PhaseThresholds = DEFAULT_THRESHOLDS, forcedMetric?: ProfitMetricKey): ProfitAnswer {
  const base: PeriodFinancials | null = h.ttm ?? h.annual[h.annual.length - 1] ?? null;
  if (!base) {
    return {
      answer: "unknown", profitClass: "unknown", metric: { key: "operatingIncome", label: "Operating profit", reason: "No financial data." }, model: "unknown", capexPct: null,
      value: null, marginPct: null, marginTwoYearsAgoPct: null, trend: "unknown", operatingMarginPct: null, netMarginPct: null, fcfMarginPct: null, headline: "No financial data found.",
    };
  }
  const chosen = chooseProfitMetric(base, th);
  const metric: ProfitMetric = forcedMetric
    ? { key: forcedMetric, label: forcedMetric === "operatingIncome" ? "Operating profit" : forcedMetric === "freeCashFlow" ? "Free cash flow" : "Net income", reason: "Chosen manually." }
    : { key: chosen.key, label: chosen.label, reason: chosen.reason };
  const value = profitValue(metric.key, base);
  const rev = base.revenue;
  const margin = value !== null && finite(rev) && rev > 0 ? (value / rev) * 100 : null;
  const old = h.annual.length >= 3 ? h.annual[h.annual.length - 3] : null;
  const oldValue = old ? profitValue(metric.key, old) : null;
  const oldMargin = old && oldValue !== null && finite(old.revenue) && old.revenue > 0 ? (oldValue / old.revenue) * 100 : null;
  let trend: ProfitAnswer["trend"] = "unknown";
  if (margin !== null && oldMargin !== null) trend = margin - oldMargin >= 3 ? "improving" : margin - oldMargin <= -3 ? "weakening" : "steady";
  const profitClass = classifyProfit(margin, th);
  const answer: ProfitAnswer["answer"] = profitClass === "unknown" ? "unknown" : profitClass === "unprofitable" ? "no" : "yes";
  const headline =
    margin === null
      ? `${metric.label} is not available.`
      : profitClass === "unprofitable"
        ? `${metric.label} is negative (${margin.toFixed(0)}% of revenue).`
        : `${metric.label} is ${margin.toFixed(0)}% of revenue${trend === "improving" ? ", up from " + (oldMargin as number).toFixed(0) + "% two years ago" : trend === "weakening" ? ", down from " + (oldMargin as number).toFixed(0) + "% two years ago" : ""}.`;
  return {
    answer, profitClass, metric, model: chosen.model, capexPct: chosen.capexPct, value, marginPct: margin, marginTwoYearsAgoPct: oldMargin, trend,
    operatingMarginPct: finite(base.operatingIncome) && finite(rev) && rev > 0 ? (base.operatingIncome / rev) * 100 : null,
    netMarginPct: finite(base.netIncome) && finite(rev) && rev > 0 ? (base.netIncome / rev) * 100 : null,
    fcfMarginPct: freeCashFlow(base) !== null && finite(rev) && rev > 0 ? ((freeCashFlow(base) as number) / rev) * 100 : null,
    headline,
  };
}

export function answerCapitalReturn(h: FinancialHistory, th: PhaseThresholds = DEFAULT_THRESHOLDS): CapitalReturnAnswer {
  const base: PeriodFinancials | null = h.ttm ?? h.annual[h.annual.length - 1] ?? null;
  const empty: CapitalReturnAnswer = {
    answer: "unknown", returnClass: "unknown", buybacks: null, dividends: null, returned: null, freeCashFlow: null, payoutPct: null,
    payoutNetOfStockCompPct: null, shareCountChangePct: null, headline: "Not enough cash-flow data to tell.",
  };
  if (!base) return empty;
  const buybacks = finite(base.buybacks) ? base.buybacks : 0;
  const dividends = finite(base.dividends) ? base.dividends : 0;
  const returned = buybacks + dividends;
  const fcf = freeCashFlow(base);
  const sbc = finite(base.stockBasedComp) ? base.stockBasedComp : 0;
  const a = h.annual;
  const sc = a.length >= 2 && finite(a[a.length - 1].dilutedShares) && finite(a[a.length - 2].dilutedShares) && (a[a.length - 2].dilutedShares as number) > 0
    ? ((a[a.length - 1].dilutedShares as number) / (a[a.length - 2].dilutedShares as number) - 1) * 100
    : null;
  if (fcf === null) return { ...empty, buybacks, dividends, returned };
  if (fcf <= 0) {
    const yes = returned > 0;
    return {
      answer: yes ? "yes" : "no", returnClass: yes ? "heavy" : "none", buybacks, dividends, returned, freeCashFlow: fcf, payoutPct: null, payoutNetOfStockCompPct: null, shareCountChangePct: sc,
      headline: yes ? "Returning cash even though free cash flow is not positive." : "No cash returned, and free cash flow is not positive.",
    };
  }
  const payout = (returned / fcf) * 100;
  const net = ((returned - sbc) / fcf) * 100;
  const returnClass: ReturnClass = payout >= th.returnHeavyPct ? "heavy" : payout >= th.returnSomePct ? "some" : "none";
  return {
    answer: returned > 0 && payout >= th.returnSomePct ? "yes" : "no",
    returnClass, buybacks, dividends, returned, freeCashFlow: fcf, payoutPct: payout, payoutNetOfStockCompPct: net, shareCountChangePct: sc,
    headline: returned > 0 ? `Returned ${payout.toFixed(0)}% of free cash flow through buybacks and dividends.` : "No buybacks or dividends.",
  };
}

// ------------------------------------------------------------------ phase rule

export interface PhaseResult {
  phase: Phase | null;
  name: string;
  /** Which questions actually decided the phase, in plain words. */
  decidedBy: string[];
  /** How close the deciding answers sit to a threshold. */
  confidence: "high" | "medium" | "low" | "unknown";
  /** A plain sentence about nearby phases and any transition under way. */
  note: string;
  /** Phases that are also plausible, with the reason. */
  alsoConsistentWith: { phase: Phase; reason: string }[];
}

/**
 * Which question breaks the tie when a company is profitable AND returning capital AND growing.
 *
 * "capital-return-first" (the founder's current choice, 2026-10-05): a profitable company
 *   that returns a meaningful share of its free cash flow to shareholders is phase 4, however
 *   fast it is growing. Growth is recorded as the alternative reading.
 * "growth-first" (the earlier rule, kept for comparison): revenue growth decides, and returning
 *   capital is only a sign of transition for a fast grower.
 *
 * The choice is under review. The founder wants to look at the phase question "from other angles"
 * before settling it, so both rules stay selectable and the page says which one is in use.
 */
export type PhaseRule = "capital-return-first" | "growth-first";
export const DEFAULT_PHASE_RULE: PhaseRule = "capital-return-first";
export const PHASE_RULE_LABEL: Record<PhaseRule, string> = {
  "capital-return-first": "Capital return first (current)",
  "growth-first": "Growth first",
};

/**
 * The rule, in order (both rules):
 *   shrinking revenue                          -> 5 Decline
 *   not profitable                             -> 1 Start-up
 * then, for a profitable company:
 *   capital-return-first:
 *     returns a meaningful share of its cash   -> 4 Capital return (growth noted as the alternative)
 *     returns little or none                   -> 2 if growth is fast, 3 if steady, 4 if slow
 *   growth-first:
 *     fast growth                              -> 2 Hyper growth (returning cash noted as a transition sign)
 *     steady growth                            -> 3 Operating leverage, or 4 if it returns most of its cash
 *     slow growth                              -> 4 Capital return
 */
export function decidePhase(
  r: Pick<RevenueAnswer, "growthClass" | "growthPct">,
  p: Pick<ProfitAnswer, "profitClass" | "marginPct" | "trend">,
  c: Pick<CapitalReturnAnswer, "returnClass" | "payoutPct">,
  th: PhaseThresholds = DEFAULT_THRESHOLDS,
  rule: PhaseRule = DEFAULT_PHASE_RULE
): PhaseResult {
  const none = (note: string): PhaseResult => ({ phase: null, name: "Not enough data", decidedBy: [], confidence: "unknown", note, alsoConsistentWith: [] });
  if (r.growthClass === "unknown" || p.profitClass === "unknown") return none("Revenue growth or profit could not be worked out from the filings.");

  const g = r.growthPct as number;
  const alt: PhaseResult["alsoConsistentWith"] = [];
  let phase: Phase;
  let decidedBy: string[];
  let distance: number; // distance of the deciding answer from its nearest threshold, in percentage points
  let note = "";

  if (r.growthClass === "shrinking") {
    phase = 5;
    decidedBy = ["Revenue is shrinking"];
    distance = th.shrinkingPct - g;
    if (c.returnClass === "heavy") alt.push({ phase: 4, reason: "It is also handing most of its cash back, which is how a mature business behaves." });
    note = "Revenue is below the level of a year ago. A single bad year in a cyclical business can look like this; check the multi-year chart.";
  } else if (p.profitClass === "unprofitable") {
    phase = 1;
    decidedBy = ["Not yet profitable"];
    distance = Math.abs(p.marginPct ?? 0);
    if (r.growthClass === "fast") note = "Growing fast but not yet profitable: an early-stage company, sometimes called pre-profit hyper growth.";
  } else if (rule === "capital-return-first" && (c.returnClass === "some" || c.returnClass === "heavy")) {
    phase = 4;
    decidedBy = [
      "Profitable",
      c.payoutPct !== null ? `Returns ${c.payoutPct.toFixed(0)}% of its free cash flow to shareholders (the line for returning capital is ${th.returnSomePct}%)` : "Returns cash to shareholders even though free cash flow is not positive",
    ];
    distance = c.payoutPct !== null ? c.payoutPct - th.returnSomePct : 100;
    if (r.growthClass === "fast") {
      alt.push({ phase: 2, reason: `Revenue is still growing ${g.toFixed(0)}%, far above the ${th.fastGrowthPct}% hyper-growth line. A growth-first reading would call it hyper growth.` });
      note = "Placed in phase 4 because it returns capital (the current rule), even though revenue is still growing very fast. Treat the capital-return measures with care: they understate what the price is paying for.";
    } else if (r.growthClass === "growing") {
      alt.push({ phase: 3, reason: "Growth is still steady, so a growth-first reading could put it late in the operating-leverage phase." });
    }
  } else if (r.growthClass === "fast") {
    phase = 2;
    decidedBy = [`Revenue growing ${g.toFixed(0)}% (the hyper-growth line is ${th.fastGrowthPct}%)`, "Already profitable"];
    distance = g - th.fastGrowthPct;
    if (c.returnClass === "some" || c.returnClass === "heavy") {
      alt.push({ phase: 3, reason: `It already returns ${c.payoutPct !== null ? c.payoutPct.toFixed(0) + "% of its free cash flow" : "cash"} and ${p.trend === "improving" ? "margins are still widening" : "is highly profitable"}, which is how companies look as they move toward operating leverage.` });
      note = "Returning capital is a sign of transition, not the phase itself. Growth is still well above the hyper-growth line.";
    }
  } else if (r.growthClass === "growing") {
    if (c.returnClass === "heavy") {
      phase = 4;
      // payout is null when free cash flow is not positive and cash is still being returned: that is as heavy as it gets.
      decidedBy = ["Profitable with steady growth", c.payoutPct !== null ? `Returns most of its cash (${c.payoutPct.toFixed(0)}% of free cash flow)` : "Returns cash even though free cash flow is not positive"];
      distance = c.payoutPct !== null ? c.payoutPct - th.returnHeavyPct : 100;
      alt.push({ phase: 3, reason: "Growth is still steady, so it could be late in the operating-leverage phase." });
    } else {
      phase = 3;
      decidedBy = ["Profitable with steady growth", p.trend === "improving" ? "Margins are widening" : "Returns only part of its cash"];
      distance = Math.min(g - th.growingPct, th.fastGrowthPct - g);
      if (c.returnClass === "some") alt.push({ phase: 4, reason: "It already returns part of its cash; more of that and slower growth would make it phase 4." });
    }
  } else {
    phase = 4;
    decidedBy = ["Profitable with slow growth", c.returnClass === "none" ? "Not yet returning much cash" : "Returns cash to shareholders"];
    distance = Math.min(th.growingPct - g, g - th.shrinkingPct);
    if (c.returnClass === "none") note = "Mature and profitable but not yet returning much cash, so confidence is lower.";
  }

  const confidence: PhaseResult["confidence"] = distance >= 10 ? "high" : distance >= 4 ? "medium" : "low";
  return { phase, name: PHASE_NAMES[phase], decidedBy, confidence: phase === 4 && c.returnClass === "none" ? "low" : confidence, note, alsoConsistentWith: alt };
}

// --------------------------------------------------------------- trajectory

export interface TrajectoryPoint {
  label: string;
  phase: Phase | null;
  growthPct: number | null;
  marginPct: number | null;
  payoutPct: number | null;
}

/** The same rule applied to each fiscal year, so the page can show how the phase has moved. Single years are noisy for cyclical companies. */
export function phaseTrajectory(h: FinancialHistory, key: ProfitMetricKey, th: PhaseThresholds = DEFAULT_THRESHOLDS, rule: PhaseRule = DEFAULT_PHASE_RULE): TrajectoryPoint[] {
  const out: TrajectoryPoint[] = [];
  for (let i = 1; i < h.annual.length; i++) {
    const cur: AnnualFinancials = h.annual[i];
    const prev = h.annual[i - 1];
    const growth = pctChange(cur.revenue, prev.revenue);
    const value = profitValue(key, cur);
    const margin = value !== null && finite(cur.revenue) && cur.revenue > 0 ? (value / cur.revenue) * 100 : null;
    const fcf = freeCashFlow(cur);
    const returned = (finite(cur.buybacks) ? cur.buybacks : 0) + (finite(cur.dividends) ? cur.dividends : 0);
    const payout = fcf !== null && fcf > 0 ? (returned / fcf) * 100 : null;
    const growthClass: GrowthClass = growth === null ? "unknown" : growth >= th.fastGrowthPct ? "fast" : growth >= th.growingPct ? "growing" : growth >= th.shrinkingPct ? "slow" : "shrinking";
    const profitClass = classifyProfit(margin, th);
    const returnClass: ReturnClass = payout === null ? (returned > 0 ? "heavy" : "none") : payout >= th.returnHeavyPct ? "heavy" : payout >= th.returnSomePct ? "some" : "none";
    const res = decidePhase({ growthClass, growthPct: growth }, { profitClass, marginPct: margin, trend: "unknown" }, { returnClass, payoutPct: payout }, th, rule);
    out.push({ label: "FY" + cur.fiscalYearEnd.slice(0, 4), phase: res.phase, growthPct: growth, marginPct: margin, payoutPct: payout });
  }
  return out;
}

// -------------------------------------------------------------- chart series

export interface ChartPoint {
  label: string;
  isTtm: boolean;
  revenue: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
}

/** Revenue and the profit lines for each fiscal year plus the latest twelve months, in dollars. */
export function chartSeries(h: FinancialHistory): ChartPoint[] {
  const pt = (label: string, p: PeriodFinancials, isTtm: boolean): ChartPoint => ({
    label, isTtm, revenue: p.revenue, grossProfit: p.grossProfit, operatingProfit: p.operatingIncome, netIncome: p.netIncome, freeCashFlow: freeCashFlow(p),
  });
  const rows = h.annual.map((a) => pt("FY" + a.fiscalYearEnd.slice(2, 4), a, false));
  if (h.ttm && h.annual.length && h.ttm.periodEnd !== h.annual[h.annual.length - 1].fiscalYearEnd) rows.push(pt("TTM", h.ttm, true));
  return rows;
}

// ------------------------------------------------------------------ top level

export interface LifecycleAnalysis {
  company: string;
  asOf: string | null;
  revenue: RevenueAnswer;
  profit: ProfitAnswer;
  capitalReturn: CapitalReturnAnswer;
  phase: PhaseResult;
  /** Which tie-break rule produced the phase. */
  rule: PhaseRule;
  trajectory: TrajectoryPoint[];
  chart: ChartPoint[];
  thresholds: PhaseThresholds;
  warnings: string[];
}

export function analyzeLifecycle(h: FinancialHistory, th: PhaseThresholds = DEFAULT_THRESHOLDS, forcedMetric?: ProfitMetricKey, rule: PhaseRule = DEFAULT_PHASE_RULE): LifecycleAnalysis {
  const revenue = answerRevenue(h, th);
  const profit = answerProfit(h, th, forcedMetric);
  const capitalReturn = answerCapitalReturn(h, th);
  const phase = decidePhase(revenue, profit, capitalReturn, th, rule);
  return {
    company: h.entityName,
    asOf: h.ttm?.periodEnd ?? h.annual[h.annual.length - 1]?.fiscalYearEnd ?? null,
    revenue, profit, capitalReturn, phase,
    rule,
    trajectory: phaseTrajectory(h, profit.metric.key, th, rule),
    chart: chartSeries(h),
    thresholds: th,
    warnings: h.warnings,
  };
}

