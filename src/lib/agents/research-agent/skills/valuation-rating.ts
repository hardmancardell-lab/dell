import type { PhaseValuation } from "./phase-valuation";
import type { HistorySummary, MultipleKey } from "./multiple-history";
import type { AnnualFinancials, TtmFinancials } from "@/lib/data/sec-financials";

/**
 * A five-level reading of where a stock's price sits against ITS OWN recent
 * trading range, using the multiples that suit its business phase.
 *
 *   very expensive | expensive | fair value | attractive | very attractive
 *
 * "Attractive" here is a defined, narrow thing: the stock's multiple is below
 * its own past-year average by the stated amount. It says nothing about whether
 * the price will rise, and it is not a recommendation. The bands are named
 * constants so they can be shown and changed. Cross-checks are listed beside the
 * rating, never blended into it, because they can disagree with it.
 */

export type Rating = "very expensive" | "expensive" | "fair value" | "attractive" | "very attractive";
export const RATING_ORDER: Rating[] = ["very expensive", "expensive", "fair value", "attractive", "very attractive"];

export interface RatingBands {
  /** Premium to the past-year average at or above this is "very expensive", in percent. */
  veryExpensivePct: number;
  /** Premium at or above this (below very expensive) is "expensive". */
  expensivePct: number;
  /** Discount at or beyond this (a negative number) is "attractive". */
  attractivePct: number;
  /** Discount at or beyond this is "very attractive". */
  veryAttractivePct: number;
}

export const DEFAULT_RATING_BANDS: RatingBands = { veryExpensivePct: 30, expensivePct: 10, attractivePct: -10, veryAttractivePct: -30 };

export function ratingFromPremium(premiumPct: number, b: RatingBands = DEFAULT_RATING_BANDS): Rating {
  if (premiumPct >= b.veryExpensivePct) return "very expensive";
  if (premiumPct >= b.expensivePct) return "expensive";
  if (premiumPct <= b.veryAttractivePct) return "very attractive";
  if (premiumPct <= b.attractivePct) return "attractive";
  return "fair value";
}

export const RATING_MEANING: Record<Rating, string> = {
  "very expensive": "Trading at least 30% above its own past-year average on this measure.",
  expensive: "Trading 10% to 30% above its own past-year average.",
  "fair value": "Trading within 10% of its own past-year average.",
  attractive: "Trading 10% to 30% below its own past-year average.",
  "very attractive": "Trading at least 30% below its own past-year average.",
};

export interface MultipleRating {
  key: MultipleKey;
  label: string;
  current: number;
  average: number;
  /** Current versus the past-year average: positive = above (more expensive), negative = below. */
  premiumPct: number;
  rating: Rating;
  low: number | null;
  high: number | null;
  /** Share of the past year the multiple was at or below today's level. */
  percentile: number | null;
  /** Where the average came from. */
  basis: "computed" | "entered";
  points: number;
}

const LABELS: Record<MultipleKey, string> = {
  priceToSales: "Price / sales",
  priceToGrossProfit: "Price / gross profit",
  priceToEarnings: "Price / earnings",
  priceToFcf: "Price / free cash flow",
};

/** Which valuation metric key from the lens maps to which history key. */
const LENS_TO_HISTORY: Record<string, MultipleKey> = { ps: "priceToSales", pgp: "priceToGrossProfit", pe: "priceToEarnings", pfcf: "priceToFcf" };

export interface CrossCheck {
  title: string;
  detail: string;
  /** "supports" the rating, "tempers" it, or just "context". */
  direction: "supports" | "tempers" | "context";
}

export interface ValuationRating {
  headline: Rating | null;
  /** Average premium across the phase's primary multiples that have history. */
  averagePremiumPct: number | null;
  perMultiple: MultipleRating[];
  crossChecks: CrossCheck[];
  window: string;
  definition: string;
  note: string | null;
}

export interface EnteredAverages {
  priceToSales?: number | null;
  priceToGrossProfit?: number | null;
  priceToEarnings?: number | null;
  priceToFcf?: number | null;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function rateValuation(
  v: PhaseValuation,
  computed: HistorySummary[],
  entered: EnteredAverages = {},
  bands: RatingBands = DEFAULT_RATING_BANDS,
  windowLabel = "the past 12 months"
): ValuationRating {
  const per: MultipleRating[] = [];
  for (const m of v.metrics) {
    const key = LENS_TO_HISTORY[m.key];
    if (!key || !finite(m.value)) continue;
    const comp = computed.find((c) => c.key === key && c.average !== null && c.points >= 3);
    const ent = entered[key];
    let average: number | null = null;
    let basis: "computed" | "entered" = "computed";
    // A value the user typed in takes priority over the computed one, and is labelled as entered.
    if (finite(ent) && ent > 0) {
      average = ent;
      basis = "entered";
    } else if (comp) {
      average = comp.average;
    }
    if (average === null) continue;
    const premium = (m.value / average - 1) * 100;
    per.push({
      key, label: LABELS[key], current: m.value, average, premiumPct: premium, rating: ratingFromPremium(premium, bands),
      low: basis === "computed" && comp ? comp.low : null, high: basis === "computed" && comp ? comp.high : null,
      percentile: basis === "computed" && comp ? comp.currentPercentile : null, basis, points: basis === "computed" && comp ? comp.points : 0,
    });
  }
  const primaryKeys = new Set(v.metrics.filter((m) => m.tier === "primary").map((m) => LENS_TO_HISTORY[m.key]).filter(Boolean));
  const primary = per.filter((p) => primaryKeys.has(p.key));
  // If none of this phase's own measures has an average to compare with, fall back to whatever does, and say so.
  const used = primary.length ? primary : per;
  const avg = used.length ? used.reduce((a, b) => a + b.premiumPct, 0) / used.length : null;
  const fellBack = primary.length === 0 && per.length > 0;
  return {
    headline: avg === null ? null : ratingFromPremium(avg, bands),
    averagePremiumPct: avg,
    perMultiple: per,
    crossChecks: [],
    window: windowLabel,
    definition: `A rating compares today's multiple with this stock's own average over ${windowLabel}. It does not say the price will rise, and it is not a recommendation.`,
    note:
      avg === null
        ? "No price history is available and no one-year average was entered, so there is nothing to compare today's multiples with. Enter an average to get a rating."
        : fellBack
          ? `This phase's own measures (${v.metrics.filter((m) => m.tier === "primary").map((m) => m.label.toLowerCase()).join(" and ")}) have no average to compare with, so the rating uses ${used.map((u) => u.label.toLowerCase()).join(" and ")} instead.`
          : null,
  };
}

// ---------------------------------------------------------------- cross-checks

/** Years of margin history used for "normal": the most recent five fiscal years, or fewer if that is all there is (three at least). */
export const NORMAL_MARGIN_YEARS = 5;

/** Average operating margin across the most recent fiscal years provided, in percent. */
export function averageOperatingMarginPct(annual: AnnualFinancials[]): number | null {
  const vals = annual.slice(-NORMAL_MARGIN_YEARS).map((a) => (finite(a.operatingIncome) && finite(a.revenue) && a.revenue > 0 ? (a.operatingIncome / a.revenue) * 100 : null)).filter((x): x is number => x !== null);
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export interface NormalizedEarnings {
  currentMarginPct: number;
  averageMarginPct: number;
  years: number;
  /** Price / earnings if profit margins fell back to their multi-year average, holding revenue where it is. */
  normalizedPriceToEarnings: number | null;
  currentPriceToEarnings: number | null;
}

/**
 * What the P/E would be if the operating margin returned to its average over
 * the years on file. A low P/E on unusually high margins can be a cyclical
 * peak rather than cheapness; this puts a number on that risk. It is a
 * sensitivity, not a forecast.
 */
export function normalizedEarnings(annual: AnnualFinancials[], ttm: TtmFinancials, marketCap: number): NormalizedEarnings | null {
  const avg = averageOperatingMarginPct(annual);
  if (avg === null || !finite(ttm.operatingIncome) || !finite(ttm.revenue) || ttm.revenue <= 0 || !finite(ttm.netIncome) || ttm.netIncome <= 0) return null;
  const cur = (ttm.operatingIncome / ttm.revenue) * 100;
  if (cur <= 0) return null;
  const normalizedNet = ttm.netIncome * (avg / cur);
  return {
    currentMarginPct: cur, averageMarginPct: avg, years: Math.min(annual.length, NORMAL_MARGIN_YEARS),
    normalizedPriceToEarnings: normalizedNet > 0 ? marketCap / normalizedNet : null,
    currentPriceToEarnings: marketCap / ttm.netIncome,
  };
}

export function buildCrossChecks(v: PhaseValuation, rating: ValuationRating, annual: AnnualFinancials[], ttm: TtmFinancials | null): CrossCheck[] {
  const out: CrossCheck[] = [];
  const cheap = rating.headline === "attractive" || rating.headline === "very attractive";
  const rd = v.reverseDcf;
  if (rd && rd.impliedGrowthPct !== null) {
    out.push({
      title: "What growth the price assumes",
      detail: `The price needs about ${rd.impliedGrowthPct.toFixed(1)}% a year of cash-flow growth for ${v.inputs.years} years (${rd.demand} demand on this page's bands). The business is delivering ${rd.currentCashFlowGrowthPct !== null ? rd.currentCashFlowGrowthPct.toFixed(0) + "%" : "an unknown rate"} now, so the price asks for ${rd.versusCurrent === "below" ? "well below" : rd.versusCurrent === "near" ? "about" : rd.versusCurrent === "above" ? "more than" : "an unclear amount relative to"} that, but the growth has to last.`,
      direction: rd.versusCurrent === "below" ? (cheap ? "supports" : "context") : rd.versusCurrent === "above" ? "tempers" : "context",
    });
  }
  if (ttm) {
    const ne = normalizedEarnings(annual, ttm, v.multiples.marketCap);
    if (ne && ne.normalizedPriceToEarnings !== null && ne.currentPriceToEarnings !== null && ne.currentMarginPct > ne.averageMarginPct * 1.1) {
      out.push({
        title: "Margins above their own average",
        detail: `The operating margin is ${ne.currentMarginPct.toFixed(0)}%, against an average of ${ne.averageMarginPct.toFixed(0)}% over the last ${ne.years} fiscal years. If margins fell back to that average, the P/E would be ${ne.normalizedPriceToEarnings.toFixed(1)}x instead of ${ne.currentPriceToEarnings.toFixed(1)}x. A low P/E on peak margins can look cheaper than it is.`,
        direction: cheap ? "tempers" : "context",
      });
    }
    const fcf = finite(ttm.operatingCashFlow) ? ttm.operatingCashFlow - (finite(ttm.capex) ? ttm.capex : 0) : null;
    if (fcf !== null && finite(ttm.netIncome) && ttm.netIncome > 0) {
      const conv = (fcf / ttm.netIncome) * 100;
      if (conv < 80) {
        out.push({
          title: "Cash conversion",
          detail: `Free cash flow is ${conv.toFixed(0)}% of net income. Earnings multiples therefore read cheaper than cash-flow multiples, because part of the profit is tied up in working capital or investment rather than arriving as cash.`,
          direction: "tempers",
        });
      }
    }
  }
  out.push({
    title: "One year is a short window",
    detail: `The comparison covers ${rating.window}. A business whose circumstances changed sharply in that time (a boom, a downturn) can look cheap or dear against a year that was itself unusual.`,
    direction: "context",
  });
  return out;
}

