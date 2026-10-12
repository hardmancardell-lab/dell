import type { TtmFinancials } from "@/lib/data/sec-financials";
import { PHASE_NAMES } from "./lifecycle-phase";
import type { Phase } from "./lifecycle-phase";

/**
 * Valuation lenses matched to a business phase.
 *
 * Different phases call for different questions about price:
 *   1 Start-up           price / sales and price / gross profit, plus cash runway
 *   2 Hyper growth       price / sales and price / gross profit, plus what growth the price assumes
 *   3 Operating leverage price / earnings and price / free cash flow
 *   4 Capital return     price / earnings and price / free cash flow, plus the yield paid to shareholders
 *   5 Decline            price / free cash flow and what shrinkage the price assumes (a suggestion, not a set rule)
 * Phases 1 to 4 follow the founder's mapping. The reverse DCF (what growth the price assumes) is shown
 * alongside for phases 2 to 5 because a multiple alone has nothing to be held against.
 *
 * Everything here is arithmetic on the company's filings and a price the caller
 * supplies. It is not a forecast and not a recommendation. The reverse DCF asks
 * "what must be true for this price to earn the discount rate" and leaves the
 * judgement of whether that is plausible to the reader.
 */

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// ------------------------------------------------------------------- DCF math

/** Value today of a cash flow growing at `g` for `years`, then at `terminalG` forever, discounted at `r` (all in percent). */
export function dcfValue(cf0: number, g: number, r: number, terminalG: number, years: number): number | null {
  const rr = r / 100;
  const gg = g / 100;
  const tg = terminalG / 100;
  if (!finite(cf0) || rr <= tg || years < 1) return null;
  let pv = 0;
  let cf = cf0;
  for (let t = 1; t <= years; t++) {
    cf *= 1 + gg;
    pv += cf / Math.pow(1 + rr, t);
  }
  const terminal = (cf * (1 + tg)) / (rr - tg);
  return pv + terminal / Math.pow(1 + rr, years);
}

/** Same, but growth fades in a straight line from `g0` in year 1 down to `terminalG` in the last year. */
export function dcfValueFade(cf0: number, g0: number, r: number, terminalG: number, years: number): number | null {
  const rr = r / 100;
  const tg = terminalG / 100;
  if (!finite(cf0) || rr <= tg || years < 1) return null;
  let pv = 0;
  let cf = cf0;
  for (let t = 1; t <= years; t++) {
    const g = years === 1 ? g0 : g0 + (terminalG - g0) * ((t - 1) / (years - 1));
    cf *= 1 + g / 100;
    pv += cf / Math.pow(1 + rr, t);
  }
  const terminal = (cf * (1 + tg)) / (rr - tg);
  return pv + terminal / Math.pow(1 + rr, years);
}

function solve(f: (g: number) => number | null, target: number, lo = -30, hi = 150): number | null {
  const flo = f(lo);
  const fhi = f(hi);
  if (flo === null || fhi === null || target < flo || target > fhi) return null;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 80; i++) {
    const mid = (a + b) / 2;
    const v = f(mid);
    if (v === null) return null;
    if (v < target) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/** The constant yearly growth for `years` that makes the cash flow worth exactly `ev` today. Null if no growth in range gets there. */
export function impliedGrowth(ev: number, cf0: number, r: number, terminalG: number, years: number): number | null {
  if (!finite(ev) || ev <= 0 || !finite(cf0) || cf0 <= 0) return null;
  return solve((g) => dcfValue(cf0, g, r, terminalG, years), ev);
}

/** The first-year growth that, fading in a straight line to the terminal rate, makes the cash flow worth exactly `ev`. */
export function impliedFadeStart(ev: number, cf0: number, r: number, terminalG: number, years: number): number | null {
  if (!finite(ev) || ev <= 0 || !finite(cf0) || cf0 <= 0) return null;
  return solve((g) => dcfValueFade(cf0, g, r, terminalG, years), ev);
}

// --------------------------------------------------------------------- inputs

export interface ValuationInputs {
  price: number;
  sharesOutstanding: number;
  /** Cash plus securities minus debt. Null counts as zero. */
  netCash: number | null;
  ttm: TtmFinancials;
  ttmYearAgo: TtmFinancials | null;
  /** 10-year Treasury yield in percent, if known. */
  riskFreePct: number | null;
  discountRatePct: number;
  terminalGrowthPct: number;
  years: number;
  /** "fcf" uses free cash flow; "fcfAfterStockPay" subtracts stock-based pay, treating it as a real cost. */
  cashFlowBasis: "fcf" | "fcfAfterStockPay";
}

export const DEFAULT_VALUATION_SETTINGS = {
  discountRatePct: 10,
  terminalGrowthPct: 3,
  years: 10,
  cashFlowBasis: "fcf" as const,
};

export interface Multiples {
  marketCap: number;
  enterpriseValue: number;
  priceToSales: number | null;
  priceToGrossProfit: number | null;
  priceToFcf: number | null;
  evToSales: number | null;
  priceToEarnings: number | null;
  earningsYieldPct: number | null;
  evToOperatingProfit: number | null;
  evToFcf: number | null;
  fcfYieldPct: number | null;
  fcfAfterStockPayYieldPct: number | null;
  shareholderYieldPct: number | null;
  dividendYieldPct: number | null;
  buybackYieldPct: number | null;
}

const ratio = (a: number | null, b: number | null) => (finite(a) && finite(b) && b !== 0 ? a / b : null);
const pct = (a: number | null, b: number | null) => (finite(a) && finite(b) && b !== 0 ? (a / b) * 100 : null);

export function freeCashFlowOf(p: { operatingCashFlow: number | null; capex: number | null }): number | null {
  return finite(p.operatingCashFlow) ? p.operatingCashFlow - (finite(p.capex) ? p.capex : 0) : null;
}

export function multiples(i: ValuationInputs): Multiples {
  const marketCap = i.price * i.sharesOutstanding;
  const ev = marketCap - (i.netCash ?? 0);
  const t = i.ttm;
  const fcf = freeCashFlowOf(t);
  const fcfAfter = fcf !== null ? fcf - (finite(t.stockBasedComp) ? t.stockBasedComp : 0) : null;
  const ret = (finite(t.buybacks) ? t.buybacks : 0) + (finite(t.dividends) ? t.dividends : 0);
  return {
    marketCap,
    enterpriseValue: ev,
    priceToSales: ratio(marketCap, t.revenue),
    priceToGrossProfit: finite(t.grossProfit) && t.grossProfit > 0 ? marketCap / t.grossProfit : null,
    priceToFcf: fcf !== null && fcf > 0 ? marketCap / fcf : null,
    evToSales: ratio(ev, t.revenue),
    priceToEarnings: finite(t.netIncome) && t.netIncome > 0 ? marketCap / t.netIncome : null,
    earningsYieldPct: finite(t.netIncome) ? pct(t.netIncome, marketCap) : null,
    evToOperatingProfit: finite(t.operatingIncome) && t.operatingIncome > 0 ? ev / t.operatingIncome : null,
    evToFcf: fcf !== null && fcf > 0 ? ev / fcf : null,
    fcfYieldPct: pct(fcf, marketCap),
    fcfAfterStockPayYieldPct: pct(fcfAfter, marketCap),
    shareholderYieldPct: pct(ret, marketCap),
    dividendYieldPct: pct(finite(t.dividends) ? t.dividends : 0, marketCap),
    buybackYieldPct: pct(finite(t.buybacks) ? t.buybacks : 0, marketCap),
  };
}

// ------------------------------------------------------------- reverse DCF

export type DemandLevel = "low" | "moderate" | "high" | "very high";

export interface ReverseDcf {
  /** Free cash flow (after stock pay if chosen) the model starts from. */
  baseCashFlow: number;
  basis: ValuationInputs["cashFlowBasis"];
  /** Constant yearly growth for `years` that today's enterprise value implies. */
  impliedGrowthPct: number | null;
  /** First-year growth, fading to the terminal rate, that today's value implies. */
  impliedFadeStartPct: number | null;
  /** The cash flow in the final year at the implied constant growth. */
  finalYearCashFlow: number | null;
  /** That final-year cash flow as a multiple of today's. */
  multipleOfToday: number | null;
  demand: DemandLevel | null;
  /** How the implied growth compares with the growth the business is delivering now. */
  versusCurrent: "below" | "near" | "above" | "unknown";
  currentCashFlowGrowthPct: number | null;
  currentRevenueGrowthPct: number | null;
}

/** Bands for how demanding an implied 10-year growth rate is. Disclosed assumptions, not market facts. */
export function demandLevel(g: number): DemandLevel {
  return g < 6 ? "low" : g < 12 ? "moderate" : g < 20 ? "high" : "very high";
}

export function reverseDcf(i: ValuationInputs): ReverseDcf | null {
  const m = multiples(i);
  const fcf = freeCashFlowOf(i.ttm);
  if (fcf === null) return null;
  const base = i.cashFlowBasis === "fcfAfterStockPay" ? fcf - (finite(i.ttm.stockBasedComp) ? i.ttm.stockBasedComp : 0) : fcf;
  if (base <= 0) {
    return { baseCashFlow: base, basis: i.cashFlowBasis, impliedGrowthPct: null, impliedFadeStartPct: null, finalYearCashFlow: null, multipleOfToday: null, demand: null, versusCurrent: "unknown", currentCashFlowGrowthPct: null, currentRevenueGrowthPct: null };
  }
  const g = impliedGrowth(m.enterpriseValue, base, i.discountRatePct, i.terminalGrowthPct, i.years);
  const g0 = impliedFadeStart(m.enterpriseValue, base, i.discountRatePct, i.terminalGrowthPct, i.years);
  const prevFcf = i.ttmYearAgo ? freeCashFlowOf(i.ttmYearAgo) : null;
  const prevBase = prevFcf !== null ? (i.cashFlowBasis === "fcfAfterStockPay" ? prevFcf - (finite(i.ttmYearAgo?.stockBasedComp) ? (i.ttmYearAgo?.stockBasedComp as number) : 0) : prevFcf) : null;
  const cfGrowth = prevBase !== null && prevBase > 0 ? (base / prevBase - 1) * 100 : null;
  const revGrowth = i.ttmYearAgo && finite(i.ttm.revenue) && finite(i.ttmYearAgo.revenue) && i.ttmYearAgo.revenue > 0 ? (i.ttm.revenue / i.ttmYearAgo.revenue - 1) * 100 : null;
  const finalCf = g !== null ? base * Math.pow(1 + g / 100, i.years) : null;
  // Compare the first-year growth that is needed with the growth being delivered now.
  const ref = g0;
  let versus: ReverseDcf["versusCurrent"] = "unknown";
  if (ref !== null && cfGrowth !== null) versus = ref < cfGrowth * 0.67 ? "below" : ref <= cfGrowth * 1.15 ? "near" : "above";
  return {
    baseCashFlow: base, basis: i.cashFlowBasis, impliedGrowthPct: g, impliedFadeStartPct: g0, finalYearCashFlow: finalCf,
    multipleOfToday: finalCf !== null ? finalCf / base : null, demand: g !== null ? demandLevel(g) : null, versusCurrent: versus,
    currentCashFlowGrowthPct: cfGrowth, currentRevenueGrowthPct: revGrowth,
  };
}

export interface CurvePoint {
  growthPct: number;
  valuePerShare: number | null;
}

/** What one share would be worth today if cash flow grew at each yearly rate for `years` (then the terminal rate). Price is where this crosses the market. */
export function valueByGrowth(i: ValuationInputs, growths: number[]): CurvePoint[] {
  const fcf = freeCashFlowOf(i.ttm);
  if (fcf === null || fcf <= 0) return growths.map((g) => ({ growthPct: g, valuePerShare: null }));
  const base = i.cashFlowBasis === "fcfAfterStockPay" ? fcf - (finite(i.ttm.stockBasedComp) ? i.ttm.stockBasedComp : 0) : fcf;
  return growths.map((g) => {
    const ev = dcfValue(base, g, i.discountRatePct, i.terminalGrowthPct, i.years);
    return { growthPct: g, valuePerShare: ev === null ? null : (ev + (i.netCash ?? 0)) / i.sharesOutstanding };
  });
}

export interface SensitivityCell {
  discountRatePct: number;
  terminalGrowthPct: number;
  impliedGrowthPct: number | null;
}

export function sensitivity(i: ValuationInputs, rates = [8, 10, 12], terminals = [2, 3, 4]): SensitivityCell[] {
  const ev = multiples(i).enterpriseValue;
  const fcf = freeCashFlowOf(i.ttm);
  const base = fcf === null ? null : i.cashFlowBasis === "fcfAfterStockPay" ? fcf - (finite(i.ttm.stockBasedComp) ? i.ttm.stockBasedComp : 0) : fcf;
  const out: SensitivityCell[] = [];
  for (const r of rates) for (const g of terminals) out.push({ discountRatePct: r, terminalGrowthPct: g, impliedGrowthPct: base !== null && base > 0 ? impliedGrowth(ev, base, r, g, i.years) : null });
  return out;
}

// -------------------------------------------------------------- phase lenses

export interface LensMetric {
  key: string;
  label: string;
  value: number | null;
  format: "x" | "pct" | "usd";
  note: string;
  /** "primary" metrics are the ruler for this phase; "supporting" ones add context. */
  tier: "primary" | "supporting";
}

export interface PhaseValuation {
  phase: Phase;
  phaseName: string;
  /** The question this phase's valuation asks. */
  question: string;
  metrics: LensMetric[];
  /** Plain-language reading with the criteria stated. Never a recommendation. */
  statements: string[];
  caveats: string[];
  multiples: Multiples;
  reverseDcf: ReverseDcf | null;
  curve: CurvePoint[];
  sensitivity: SensitivityCell[];
  inputs: Pick<ValuationInputs, "price" | "discountRatePct" | "terminalGrowthPct" | "years" | "cashFlowBasis" | "riskFreePct">;
}

const usd = (v: number) => (Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const f1 = (v: number) => v.toFixed(1);

export function valuationForPhase(phase: Phase, i: ValuationInputs): PhaseValuation {
  const m = multiples(i);
  const rd = reverseDcf(i);
  const growths = [-5, 0, 3, 5, 8, 10, 12, 15, 20, 25, 30, 40];
  const curve = valueByGrowth(i, growths);
  const sens = sensitivity(i);
  const statements: string[] = [];
  const caveats: string[] = [
    "Valuation is arithmetic on filed numbers and a price, not a forecast.",
    `Discount rate ${i.discountRatePct}%, terminal growth ${i.terminalGrowthPct}% and a ${i.years}-year window are assumptions. Change them and the answer moves; the table shows by how much.`,
  ];
  let question = "";
  let metrics: LensMetric[] = [];

  const reverseStatements = () => {
    if (!rd) return;
    if (rd.baseCashFlow <= 0) {
      statements.push("Free cash flow is not positive, so a growth rate cannot be backed out of the price.");
      return;
    }
    if (rd.impliedGrowthPct === null) {
      statements.push("No growth rate between -30% and 150% a year makes the cash flow worth today's price, so the price cannot be reconciled with this cash flow under these assumptions.");
      return;
    }
    statements.push(
      `At $${i.price.toFixed(2)} the market is paying for free cash flow of ${usd(rd.baseCashFlow)} growing about ${f1(rd.impliedGrowthPct)}% a year for ${i.years} years, then ${i.terminalGrowthPct}% after, discounted at ${i.discountRatePct}%. That path reaches ${usd(rd.finalYearCashFlow as number)} in year ${i.years}, ${f1(rd.multipleOfToday as number)} times today's.`
    );
    if (rd.impliedFadeStartPct !== null) {
      statements.push(`If growth instead fades in a straight line to ${i.terminalGrowthPct}%, the price needs growth to start near ${f1(rd.impliedFadeStartPct)}% in the first year.`);
    }
    if (rd.currentCashFlowGrowthPct !== null) {
      statements.push(
        `For comparison, free cash flow grew ${f1(rd.currentCashFlowGrowthPct)}% over the last twelve months${rd.currentRevenueGrowthPct !== null ? ` and revenue ${f1(rd.currentRevenueGrowthPct)}%` : ""}. The price asks for ${rd.versusCurrent === "below" ? "well below" : rd.versusCurrent === "near" ? "roughly" : rd.versusCurrent === "above" ? "more than" : "an unclear amount relative to"} the growth the business is delivering now, but that growth has to be sustained for ${i.years} years.`
      );
    }
    statements.push(`How demanding is ${f1(rd.impliedGrowthPct)}% a year for ${i.years} years? On this page's bands (under 6% low, 6 to 12% moderate, 12 to 20% high, 20% and up very high): ${rd.demand}.`);
  };

  const num = (key: string, label: string, value: number | null, format: LensMetric["format"], note: string, tier: LensMetric["tier"] = "primary"): LensMetric => ({ key, label, value, format, note, tier });
  const x1 = (v: number | null) => (v === null ? "not available" : `${v.toFixed(1)}x`);

  // Shared building blocks. Which ones lead depends on the phase (see the mapping in the file header).
  const mPS = num("ps", "Price / sales", m.priceToSales, "x", "Market value for each $1 of revenue over the last twelve months.");
  const mPGP = num("pgp", "Price / gross profit", m.priceToGrossProfit, "x", "Market value for each $1 left after the direct cost of the product. Sees through low-margin revenue.");
  const mPE = num("pe", "Price / earnings", m.priceToEarnings, "x", "Market value for each $1 of net income over the last twelve months.");
  const mPFCF = num("pfcf", "Price / free cash flow", m.priceToFcf, "x", "Market value for each $1 of cash left after running the business and reinvesting.");
  const sup = (mt: LensMetric): LensMetric => ({ ...mt, tier: "supporting" });
  const mEvOp = num("evOp", "Enterprise value / operating profit", m.evToOperatingProfit, "x", "Value of the whole business (debt included, cash excluded) per $1 of operating profit.", "supporting");
  const mFcfYield = num("fcfYield", "Free cash flow yield", m.fcfYieldPct, "pct", "Free cash flow as a share of market value. The mirror image of price / free cash flow.", "supporting");

  if (phase === 1) {
    question = "How much is paid per dollar of sales and gross profit, and how long can the business fund itself?";
    const burn = freeCashFlowOf(i.ttm);
    const runwayMonths = burn !== null && burn < 0 && i.netCash !== null && i.netCash > 0 ? (i.netCash / -burn) * 12 : null;
    metrics = [
      mPS,
      mPGP,
      num("burn", "Free cash flow, last twelve months", burn, "usd", "Negative means the business is spending more cash than it brings in.", "supporting"),
      num("runway", "Months of cash at this burn", runwayMonths, "x", "Net cash divided by yearly burn, in months.", "supporting"),
      sup(num("evSales", "Enterprise value / sales", m.evToSales, "x", "Same as price / sales but nets out cash and debt.")),
    ];
    statements.push(`The market pays ${x1(m.priceToSales)} sales and ${x1(m.priceToGrossProfit)} gross profit.`);
    if (runwayMonths !== null) statements.push(`At the current cash burn, net cash lasts about ${runwayMonths.toFixed(0)} months.`);
    caveats.push("With little or no profit, a sales multiple only means something next to similar young companies or this company's own earlier years. This page does not have peer or price-history data, so it cannot say whether the multiple is high or low.");
  } else if (phase === 2) {
    question = "How much is paid per dollar of sales and gross profit, and what growth does that price assume?";
    metrics = [mPS, mPGP, sup(mPE), sup(mPFCF), mEvOp, mFcfYield];
    statements.push(`The market pays ${x1(m.priceToSales)} sales and ${x1(m.priceToGrossProfit)} gross profit.`);
    if (m.priceToEarnings !== null) statements.push(`This company is already profitable, so earnings multiples are shown as supporting context: ${x1(m.priceToEarnings)} earnings and ${x1(m.priceToFcf)} free cash flow.`);
    reverseStatements();
    caveats.push("A fast grower's sales multiple looks high next to slower companies by design, because the price is paying for growth that has not happened yet. The growth the price assumes (above) is the check on that.");
    caveats.push("A multiple on its own is only a ruler. To call it high or low you need something to hold it against: the company's own past, similar companies, or the growth it assumes.");
  } else if (phase === 3) {
    question = "What is paid per dollar of earnings and of free cash flow?";
    metrics = [mPE, mPFCF, mEvOp, mFcfYield, sup(mPS), sup(mPGP)];
    statements.push(`The market pays ${x1(m.priceToEarnings)} earnings and ${x1(m.priceToFcf)} free cash flow.`);
    reverseStatements();
    caveats.push("In this phase profit is growing faster than sales, so today's earnings understate where they are heading and a low multiple can still be fair. The growth the price assumes (above) is the check.");
  } else if (phase === 4) {
    question = "What is paid per dollar of earnings and cash flow, and what yield comes back to shareholders?";
    metrics = [
      mPE,
      mPFCF,
      num("shareholderYield", "Shareholder yield (buybacks + dividends)", m.shareholderYieldPct, "pct", "Cash returned over the last twelve months as a share of market value.", "supporting"),
      num("dividendYield", "Dividend yield", m.dividendYieldPct, "pct", "Dividends paid as a share of market value.", "supporting"),
      num("buybackYield", "Buyback yield", m.buybackYieldPct, "pct", "Share repurchases as a share of market value.", "supporting"),
      mFcfYield,
      num("rf", "10-year Treasury yield", i.riskFreePct, "pct", "What a risk-free government bond pays, for comparison.", "supporting"),
    ];
    statements.push(`The market pays ${x1(m.priceToEarnings)} earnings and ${x1(m.priceToFcf)} free cash flow.`);
    if (m.shareholderYieldPct !== null) statements.push(`The company returned ${f1(m.shareholderYieldPct)}% of its market value to shareholders over the last twelve months (${f1(m.dividendYieldPct ?? 0)}% dividends, ${f1(m.buybackYieldPct ?? 0)}% buybacks).`);
    if (m.fcfYieldPct !== null && i.riskFreePct !== null) {
      statements.push(
        m.fcfYieldPct < i.riskFreePct
          ? `Free cash flow yield (${f1(m.fcfYieldPct)}%) is below the 10-year Treasury yield (${f1(i.riskFreePct)}%). On a yield basis you are paying for growth, not income.`
          : `Free cash flow yield (${f1(m.fcfYieldPct)}%) is at or above the 10-year Treasury yield (${f1(i.riskFreePct)}%).`
      );
    }
    reverseStatements();
    caveats.push("These measures suit a company whose growth has slowed and whose profits are stable. If revenue is still growing fast, they understate what the price is paying for.");
  } else {
    question = "What is paid per dollar of cash flow, and what rate of shrinkage is priced in?";
    metrics = [mPFCF, mFcfYield, mPE, mEvOp, sup(num("shareholderYield", "Shareholder yield", m.shareholderYieldPct, "pct", "Cash returned as a share of market value.")), sup(num("rf", "10-year Treasury yield", i.riskFreePct, "pct", "A risk-free comparison."))];
    statements.push(`The market pays ${x1(m.priceToFcf)} free cash flow.`);
    reverseStatements();
    caveats.push("The phase-5 measures are this page's suggestion, not a set rule: cash flow and what shrinkage the price assumes. A negative implied growth rate is normal for a shrinking business; the question is whether the cash yield is worth the decline.");
  }

  return {
    phase, phaseName: PHASE_NAMES[phase], question, metrics, statements, caveats, multiples: m, reverseDcf: rd, curve, sensitivity: sens,
    inputs: { price: i.price, discountRatePct: i.discountRatePct, terminalGrowthPct: i.terminalGrowthPct, years: i.years, cashFlowBasis: i.cashFlowBasis, riskFreePct: i.riskFreePct },
  };
}
