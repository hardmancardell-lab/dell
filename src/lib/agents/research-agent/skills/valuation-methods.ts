import { fetchFredSeries, latest } from "@/lib/data/fred";
import type { FmpCashFlowStatement, FmpDividendRecord, FmpIncomeStatement } from "@/lib/data/fmp";
import type { ValuationResult, ValuationVerdict } from "../types";

const DEFAULT_AAA_YIELD_PCT = 5.5; // used only if the live FRED fetch fails
const DISCOUNT_RATE_PCT = 9; // assumed required return for EPV/DCF/DDM — flagged explicitly in each result
const TERMINAL_GROWTH_PCT = 2.5; // assumed long-run terminal growth for DCF
const DCF_PROJECTION_YEARS = 5;
const MAX_GROWTH_ASSUMPTION_PCT = 15; // caps extrapolated historical growth to avoid absurd projections

function classify(impliedValue: number | null, marketPrice: number): {
  percentDifference: number | null;
  verdict: ValuationVerdict;
} {
  if (impliedValue === null || impliedValue <= 0) return { percentDifference: null, verdict: "not applicable" };
  const pct = ((impliedValue - marketPrice) / marketPrice) * 100;
  const verdict: ValuationVerdict = pct > 10 ? "undervalued" : pct < -10 ? "overvalued" : "fairly valued";
  return { percentDifference: pct, verdict };
}

/** CAGR between the oldest and newest value in a most-recent-first array, capped to a sane range. */
function cappedHistoricalGrowthPct(valuesMostRecentFirst: number[]): number | null {
  const clean = valuesMostRecentFirst.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const newest = clean[0];
  const oldest = clean[clean.length - 1];
  const years = clean.length - 1;
  if (oldest <= 0 || newest <= 0) return null;
  const cagr = (Math.pow(newest / oldest, 1 / years) - 1) * 100;
  return Math.max(0, Math.min(MAX_GROWTH_ASSUMPTION_PCT, cagr));
}

async function fetchAaaYieldPct(): Promise<{ value: number; isLive: boolean }> {
  try {
    const observations = await fetchFredSeries("AAA", 3);
    const latestObs = latest(observations);
    if (latestObs) return { value: latestObs.value, isLive: true };
  } catch {
    // fall through to default
  }
  return { value: DEFAULT_AAA_YIELD_PCT, isLive: false };
}

interface ValuationInputs {
  price: number;
  sharesOutstanding: number;
  incomeStatements: FmpIncomeStatement[]; // most recent first
  cashFlowStatements: FmpCashFlowStatement[]; // most recent first
  bookValuePerShare: number;
  averageNetIncome: number;
  dividendHistory: FmpDividendRecord[];
}

export async function getValuationMethods(inputs: ValuationInputs): Promise<ValuationResult[]> {
  const {
    price,
    sharesOutstanding,
    incomeStatements,
    cashFlowStatements,
    bookValuePerShare,
    averageNetIncome,
    dividendHistory,
  } = inputs;

  const results: ValuationResult[] = [];
  const { value: aaaYieldPct, isLive: aaaYieldIsLive } = await fetchAaaYieldPct();
  const aaaYieldNote = aaaYieldIsLive
    ? `Live Moody's Aaa corporate bond yield: ${aaaYieldPct.toFixed(2)}%.`
    : `Could not fetch live Aaa corporate bond yield — used a fallback estimate of ${DEFAULT_AAA_YIELD_PCT}%.`;

  const latestEps = incomeStatements[0]?.eps ?? 0;

  // --- 1. Graham Number: sqrt(22.5 * EPS * BVPS) ---
  if (latestEps > 0 && bookValuePerShare > 0) {
    const grahamNumber = Math.sqrt(22.5 * latestEps * bookValuePerShare);
    const { percentDifference, verdict } = classify(grahamNumber, price);
    results.push({
      method: "Graham Number",
      available: true,
      impliedValuePerShare: grahamNumber,
      currentMarketPrice: price,
      percentDifference,
      verdict,
      assumptions: "sqrt(22.5 x EPS x Book Value per Share) — Graham's original conservative ceiling, no growth assumption.",
      note: null,
    });
  } else {
    results.push({
      method: "Graham Number",
      available: false,
      impliedValuePerShare: null,
      currentMarketPrice: price,
      percentDifference: null,
      verdict: "not applicable",
      assumptions: "sqrt(22.5 x EPS x Book Value per Share)",
      note: "Requires positive EPS and positive book value per share.",
    });
  }

  // --- 2. Graham Growth Formula: V = EPS x (8.5 + 2g) x 4.4 / Y ---
  const epsHistory = incomeStatements.map((s) => s.eps);
  const growthPct = cappedHistoricalGrowthPct(epsHistory);
  if (latestEps > 0 && growthPct !== null && aaaYieldPct > 0) {
    const grahamGrowthValue = (latestEps * (8.5 + 2 * growthPct) * 4.4) / aaaYieldPct;
    const { percentDifference, verdict } = classify(grahamGrowthValue, price);
    results.push({
      method: "Graham Growth Formula",
      available: true,
      impliedValuePerShare: grahamGrowthValue,
      currentMarketPrice: price,
      percentDifference,
      verdict,
      assumptions: `EPS x (8.5 + 2g) x 4.4 / Y, where g = ${growthPct.toFixed(1)}% (historical EPS CAGR, capped at ${MAX_GROWTH_ASSUMPTION_PCT}%) and Y = ${aaaYieldPct.toFixed(2)}% (Aaa corporate bond yield). ${aaaYieldNote}`,
      note: `Based on ${epsHistory.length} years of EPS history, not Graham's original 7-10 year window (FMP free tier caps at 5 years).`,
    });
  } else {
    results.push({
      method: "Graham Growth Formula",
      available: false,
      impliedValuePerShare: null,
      currentMarketPrice: price,
      percentDifference: null,
      verdict: "not applicable",
      assumptions: "EPS x (8.5 + 2g) x 4.4 / Y",
      note: "Requires positive current EPS and at least 2 years of EPS history to estimate a growth rate.",
    });
  }

  // --- 3. Earnings Power Value (Greenwald-style): normalized earnings / discount rate, no growth ---
  if (averageNetIncome > 0 && sharesOutstanding > 0) {
    const epvTotal = averageNetIncome / (DISCOUNT_RATE_PCT / 100);
    const epvPerShare = epvTotal / sharesOutstanding;
    const { percentDifference, verdict } = classify(epvPerShare, price);
    results.push({
      method: "Earnings Power Value (EPV)",
      available: true,
      impliedValuePerShare: epvPerShare,
      currentMarketPrice: price,
      percentDifference,
      verdict,
      assumptions: `Multi-year average net income / ${DISCOUNT_RATE_PCT}% assumed discount rate. Deliberately assumes zero growth (Bruce Greenwald's approach) — a conservative floor, not a target.`,
      note: null,
    });
  } else {
    results.push({
      method: "Earnings Power Value (EPV)",
      available: false,
      impliedValuePerShare: null,
      currentMarketPrice: price,
      percentDifference: null,
      verdict: "not applicable",
      assumptions: `Multi-year average net income / ${DISCOUNT_RATE_PCT}% discount rate`,
      note: "Requires positive average net income across available history.",
    });
  }

  // --- 4. Simple DCF (5yr FCF projection + terminal value) ---
  const fcfHistory = cashFlowStatements.map((s) => s.freeCashFlow).filter((v) => Number.isFinite(v));
  const avgFcf = fcfHistory.length > 0 ? fcfHistory.reduce((s, v) => s + v, 0) / fcfHistory.length : 0;
  const fcfGrowthPct = cappedHistoricalGrowthPct(fcfHistory); // fcfHistory is already most-recent-first
  const dcfGrowthPct = fcfGrowthPct ?? 3; // conservative default if growth can't be estimated

  if (avgFcf > 0 && sharesOutstanding > 0) {
    const r = DISCOUNT_RATE_PCT / 100;
    const g = dcfGrowthPct / 100;
    const terminalG = TERMINAL_GROWTH_PCT / 100;
    let pvSum = 0;
    let projectedFcf = avgFcf;
    for (let year = 1; year <= DCF_PROJECTION_YEARS; year++) {
      projectedFcf = year === 1 ? avgFcf * (1 + g) : projectedFcf * (1 + g);
      pvSum += projectedFcf / Math.pow(1 + r, year);
    }
    const terminalValue = (projectedFcf * (1 + terminalG)) / (r - terminalG);
    const pvTerminal = terminalValue / Math.pow(1 + r, DCF_PROJECTION_YEARS);
    const enterpriseValue = pvSum + pvTerminal;
    const dcfPerShare = enterpriseValue / sharesOutstanding;
    const { percentDifference, verdict } = classify(dcfPerShare, price);
    results.push({
      method: "Discounted Cash Flow (5yr + terminal value)",
      available: true,
      impliedValuePerShare: dcfPerShare,
      currentMarketPrice: price,
      percentDifference,
      verdict,
      assumptions: `${DISCOUNT_RATE_PCT}% discount rate, ${dcfGrowthPct.toFixed(1)}% projected FCF growth (${fcfGrowthPct !== null ? "historical FCF CAGR, capped" : "no reliable historical growth signal — used a conservative 3% default"}), ${TERMINAL_GROWTH_PCT}% terminal growth. Based on ${fcfHistory.length} years of FCF history.`,
      note: "The most assumption-sensitive method here — small changes in the growth/discount rate materially move the output. Treat as a scenario, not a precise target.",
    });
  } else {
    results.push({
      method: "Discounted Cash Flow (5yr + terminal value)",
      available: false,
      impliedValuePerShare: null,
      currentMarketPrice: price,
      percentDifference: null,
      verdict: "not applicable",
      assumptions: `${DISCOUNT_RATE_PCT}% discount rate, terminal growth ${TERMINAL_GROWTH_PCT}%`,
      note: "Requires positive average free cash flow across available history.",
    });
  }

  // --- 5. Dividend Discount Model (Gordon Growth) ---
  const dividendsByYear = new Map<number, number>();
  for (const d of dividendHistory) {
    const year = new Date(d.date).getFullYear();
    dividendsByYear.set(year, (dividendsByYear.get(year) ?? 0) + d.adjDividend);
  }
  const annualDividends = Array.from(dividendsByYear.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, total]) => total);

  if (annualDividends.length >= 2 && annualDividends[0] > 0) {
    const divGrowthPct = cappedHistoricalGrowthPct(annualDividends) ?? 0;
    const r = DISCOUNT_RATE_PCT / 100;
    const g = Math.min(divGrowthPct, DISCOUNT_RATE_PCT - 1) / 100; // keep g strictly below r
    const d1 = annualDividends[0] * (1 + g);
    const ddmValue = r > g ? d1 / (r - g) : null;
    const { percentDifference, verdict } = classify(ddmValue, price);
    results.push({
      method: "Dividend Discount Model (Gordon Growth)",
      available: ddmValue !== null,
      impliedValuePerShare: ddmValue,
      currentMarketPrice: price,
      percentDifference,
      verdict,
      assumptions: `Next dividend = last annual dividend x (1 + ${(g * 100).toFixed(1)}%), discounted at ${DISCOUNT_RATE_PCT}% required return.`,
      note: ddmValue === null ? "Estimated dividend growth rate exceeds the discount rate — formula breaks down, not shown." : null,
    });
  } else {
    results.push({
      method: "Dividend Discount Model (Gordon Growth)",
      available: false,
      impliedValuePerShare: null,
      currentMarketPrice: price,
      percentDifference: null,
      verdict: "not applicable",
      assumptions: `Next dividend / (${DISCOUNT_RATE_PCT}% required return - dividend growth rate)`,
      note: "Requires at least 2 years of dividend history — not a dividend payer, or FMP didn't return enough records.",
    });
  }

  return results;
}
