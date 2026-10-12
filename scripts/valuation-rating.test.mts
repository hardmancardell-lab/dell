// @ts-nocheck -- run with node --experimental-strip-types, not compiled by the app build
import { readFileSync } from "node:fs";
import { normalizeCompanyFacts, ttmHistory, coverShareHistory } from "../src/lib/data/sec-financials.ts";
import * as V from "../src/lib/agents/research-agent/skills/phase-valuation.ts";
import * as H from "../src/lib/agents/research-agent/skills/multiple-history.ts";
import * as R from "../src/lib/agents/research-agent/skills/valuation-rating.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const near = (a: number | null, b: number, tol = 0.05) => a !== null && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- the five bands
const r = (p: number) => R.ratingFromPremium(p);
t("bands: +45% very expensive, +30% very expensive (boundary), +20% expensive, +10% expensive (boundary)", r(45) === "very expensive" && r(30) === "very expensive" && r(20) === "expensive" && r(10) === "expensive");
t("bands: +9.9% fair, 0 fair, -9.9% fair", r(9.9) === "fair value" && r(0) === "fair value" && r(-9.9) === "fair value");
t("bands: -10% attractive (boundary), -20% attractive, -30% very attractive (boundary), -45% very attractive", r(-10) === "attractive" && r(-20) === "attractive" && r(-30) === "very attractive" && r(-45) === "very attractive");
t("bands are adjustable", R.ratingFromPremium(-15, { ...R.DEFAULT_RATING_BANDS, veryAttractivePct: -15 }) === "very attractive");
t("every rating has a plain meaning", R.RATING_ORDER.every((x) => R.RATING_MEANING[x].length > 20));

// ---------------------------------------------------------------- history math by hand
const snaps = [
  { periodEnd: "2025-03-31", firstFiled: "2025-05-01", ttm: { periodEnd: "2025-03-31", revenue: 1000, grossProfit: 500, operatingIncome: 200, netIncome: 100, operatingCashFlow: 150, capex: 30, buybacks: 0, dividends: 0, stockBasedComp: 0, researchAndDevelopment: 0 } },
  { periodEnd: "2025-06-30", firstFiled: "2025-08-01", ttm: { periodEnd: "2025-06-30", revenue: 1200, grossProfit: 600, operatingIncome: 250, netIncome: 150, operatingCashFlow: 200, capex: 40, buybacks: 0, dividends: 0, stockBasedComp: 0, researchAndDevelopment: 0 } },
];
const shares = [{ asOf: "2025-04-20", filed: "2025-05-01", value: 10 }, { asOf: "2025-07-20", filed: "2025-08-01", value: 10 }];
const hist = H.multipleHistory(snaps, shares, [{ date: "2025-04-30", price: 5 }, { date: "2025-05-15", price: 10 }, { date: "2025-07-31", price: 10 }, { date: "2025-08-02", price: 12 }]);
t("a price before any filing gets no multiple (nothing was known yet)", hist.length === 3 && hist[0].date === "2025-05-15", hist.map((h) => h.date).join());
t("2025-05-15: price 10 x 10 shares = 100 cap; P/E = 100/100 = 1.0, P/S 0.1, P/GP 0.2, P/FCF 100/120", near(hist[0].priceToEarnings, 1) && near(hist[0].priceToSales, 0.1) && near(hist[0].priceToGrossProfit, 0.2) && near(hist[0].priceToFcf, 100 / 120, 1e-9) && hist[0].basedOnQuarter === "2025-03-31");
t("2025-07-31 is still before the June quarter was filed (Aug 1), so it uses the March quarter", hist[1].basedOnQuarter === "2025-03-31", hist[1].basedOnQuarter);
t("2025-08-02 uses the June quarter: cap 120, P/E 120/150 = 0.8", hist[2].basedOnQuarter === "2025-06-30" && near(hist[2].priceToEarnings, 0.8));
const s = H.summarize(hist, "priceToEarnings", 0.9);
t("summary: average (1.0 + 1.0 + 0.8)/3 = 0.9333, low 0.8, high 1.0, 0.9 sits above 1 of 3 points -> 33rd percentile", near(s.average, 0.9333, 1e-4) && s.low === 0.8 && s.high === 1 && near(s.currentPercentile, 100 / 3, 1e-6), JSON.stringify(s));
t("summary of nothing is empty, not NaN", H.summarize([], "priceToEarnings", 1).average === null);

// ---------------------------------------------------------------- NVIDIA, real filings + month-end closes
const raw = JSON.parse(readFileSync(new URL("./fixtures/nvda_companyfacts_trimmed.json", import.meta.url), "utf8"));
const h = normalizeCompanyFacts(raw);
const snapsN = ttmHistory(raw, "2024-06-01");
const sharesN = coverShareHistory(raw);
t("first-filed dates are the ORIGINAL filing dates, not the later comparison filings (the stale-quarter bug)", snapsN.find((x) => x.periodEnd === "2025-07-27").firstFiled === "2025-08-27" && snapsN.find((x) => x.periodEnd === "2025-04-27").firstFiled === "2025-05-28", JSON.stringify(snapsN.map((x) => [x.periodEnd, x.firstFiled])));
const monthly = { "2025-09-30": 186.34, "2025-10-31": 202.23, "2025-11-30": 176.77, "2025-12-31": 186.27, "2026-01-31": 190.90, "2026-02-28": 176.97, "2026-03-31": 174.20, "2026-04-30": 199.34, "2026-05-31": 210.89, "2026-06-30": 200.09, "2026-07-31": 200.75, "2026-08-31": 220.78, "2026-09-30": 228.38 };
const histN = H.multipleHistory(snapsN, sharesN, Object.entries(monthly).map(([date, price]) => ({ date, price })));
t("13 month-ends, none pairing a price with a quarter that was not yet filed", histN.length === 13 && histN.every((x) => snapsN.find((s) => s.periodEnd === x.basedOnQuarter).firstFiled <= x.date));
t("Sep 2025 price is paired with the July-2025 quarter (P/E about 52x), not an older one", histN[0].basedOnQuarter === "2025-07-27" && near(histN[0].priceToEarnings, 52.3, 0.1), `${histN[0].priceToEarnings}`);
const pe = H.summarize(histN, "priceToEarnings", 29.9);
console.log("   NVDA P/E over the 13 month-ends: average", pe.average.toFixed(1), "low", pe.low.toFixed(1), "high", pe.high.toFixed(1), "percentile", pe.currentPercentile.toFixed(0));
t("NVDA one-year P/E: average about 38.8x, range 27.6x to 56.7x", near(pe.average, 38.8, 0.1) && near(pe.low, 27.6, 0.1) && near(pe.high, 56.7, 0.1));

const inputs = { price: 239.1, sharesOutstanding: h.sharesOutstanding.value, netCash: h.balance.netCash, ttm: h.ttm, ttmYearAgo: h.ttmYearAgo, riskFreePct: 4.3, ...V.DEFAULT_VALUATION_SETTINGS };
const sums = ["priceToSales", "priceToGrossProfit", "priceToEarnings", "priceToFcf"].map((k) => H.summarize(histN, k, { priceToSales: 19.0, priceToGrossProfit: 25.5, priceToEarnings: 29.9, priceToFcf: 45.4 }[k]));
for (const [phase, label] of [[2, "phase 2 (price/sales, price/gross profit)"], [4, "phase 4 (price/earnings, price/FCF)"]]) {
  const rt = R.rateValuation(V.valuationForPhase(phase, inputs), sums);
  console.log(`   ${label}: headline "${rt.headline}" (average premium ${rt.averagePremiumPct.toFixed(1)}%) |`, rt.perMultiple.map((m) => `${m.label} ${m.current.toFixed(1)}x vs ${m.average.toFixed(1)}x = ${m.premiumPct.toFixed(1)}% ${m.rating}`).join(" ; "));
}
const rt2 = R.rateValuation(V.valuationForPhase(2, inputs), sums);
const rt4 = R.rateValuation(V.valuationForPhase(4, inputs), sums);
t("phase 2 uses only price/sales and price/gross profit in the headline: both 'attractive', average about -15%", rt2.headline === "attractive" && near(rt2.averagePremiumPct, -15.1, 0.2), `${rt2.headline} ${rt2.averagePremiumPct}`);
t("phase 4 uses price/earnings and price/FCF: P/E -23% attractive, P/FCF -9.6% fair, headline attractive", rt4.perMultiple.find((m) => m.key === "priceToEarnings").rating === "attractive" && rt4.perMultiple.find((m) => m.key === "priceToFcf").rating === "fair value" && rt4.headline === "attractive", rt4.headline);
t("supporting multiples are shown but do not drive the headline (phase 2 also lists P/E and P/FCF)", rt2.perMultiple.length === 4 && rt2.averagePremiumPct !== null);

// the founder's own number: 48.7x entered as the one-year average P/E
const entered = R.rateValuation(V.valuationForPhase(4, inputs), sums, { priceToEarnings: 48.7 });
const pe487 = entered.perMultiple.find((m) => m.key === "priceToEarnings");
t("entering 48.7x as the average P/E: 29.9 is -38.6% below it = very attractive, labelled 'entered'", near(pe487.premiumPct, -38.6, 0.1) && pe487.rating === "very attractive" && pe487.basis === "entered" && pe487.percentile === null, JSON.stringify(pe487));
t("an entered average overrides the computed one for that multiple only", entered.perMultiple.find((m) => m.key === "priceToFcf").basis === "computed");
const onlyPE = R.rateValuation(V.valuationForPhase(2, inputs), [], { priceToEarnings: 48.7 });
t("phase 2 with only a P/E average entered: headline falls back to P/E (very attractive) and says why, instead of staying blank", onlyPE.headline === "very attractive" && /no average to compare with/.test(onlyPE.note) && /price \/ earnings/.test(onlyPE.note), JSON.stringify(onlyPE.note));
t("no fallback note when the phase's own measures have an average", rt2.note === null && rt4.note === null);
t("no history and nothing entered: no headline, an honest note, nothing invented", (() => { const x = R.rateValuation(V.valuationForPhase(4, inputs), []); return x.headline === null && x.perMultiple.length === 0 && /Enter an average/.test(x.note); })());
t("fewer than 3 history points is not enough to compute an average", R.rateValuation(V.valuationForPhase(4, inputs), [{ key: "priceToEarnings", points: 2, average: 40, low: 30, high: 50, currentPercentile: 10 }]).headline === null);

// ---------------------------------------------------------------- cross-checks
const nem = R.normalizedEarnings(h.annual, h.ttm, 239.1 * h.sharesOutstanding.value);
console.log("   normalized: margin now", nem.currentMarginPct.toFixed(1) + "%", "5-yr average", nem.averageMarginPct.toFixed(1) + "%", "-> P/E", nem.currentPriceToEarnings.toFixed(1), "->", nem.normalizedPriceToEarnings.toFixed(1));
t("NVDA normalized earnings: margin 65.2% vs a 46.0% five-year average gives a P/E of about 42x", near(nem.currentMarginPct, 65.2, 0.1) && near(nem.averageMarginPct, 46.0, 0.2) && near(nem.normalizedPriceToEarnings, 42.4, 0.3), JSON.stringify(nem));
const cc = R.buildCrossChecks(V.valuationForPhase(4, inputs), rt4, h.annual, h.ttm);
const titles = cc.map((c) => c.title);
t("cross-checks: growth assumed, margins above average, cash conversion, short window", ["What growth the price assumes", "Margins above their own average", "Cash conversion", "One year is a short window"].every((x) => titles.includes(x)), titles.join(" | "));
t("the margin and cash-conversion checks TEMPER an 'attractive' rating; they are not blended into it", cc.find((c) => c.title === "Margins above their own average").direction === "tempers" && cc.find((c) => c.title === "Cash conversion").direction === "tempers");
t("cash conversion is quoted as 66% (127.0 / 192.9)", /66%/.test(cc.find((c) => c.title === "Cash conversion").detail));
t("a company with no margin gap gets no margin warning", (() => { const flat = h.annual.map((a) => ({ ...a, operatingIncome: a.revenue * 0.652 })); return !R.buildCrossChecks(V.valuationForPhase(4, inputs), rt4, flat, h.ttm).some((c) => c.title === "Margins above their own average"); })());
t("rating text never recommends action", !/\b(buy|sell|should|recommend)\b/i.test(JSON.stringify([rt2, rt4, cc]).replace(/not a recommendation/g, "")));
t("no NaN or Infinity", !/NaN|Infinity/.test(JSON.stringify([rt2, rt4, cc, nem])));
process.exit(bad ? 1 : 0);
