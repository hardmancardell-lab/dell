// @ts-nocheck -- run with node --experimental-strip-types, not compiled by the app build
// Run: node --import <alias-register> --experimental-strip-types scripts/lifecycle-phase.test.mts
// (the "@/..." alias is resolved by the register hook; see scripts/README note in the PR)
import { readFileSync } from "node:fs";
import { normalizeCompanyFacts } from "../src/lib/data/sec-financials.ts";
import * as L from "../src/lib/agents/research-agent/skills/lifecycle-phase.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const near = (a: number | null, b: number, tol = 0.1) => a !== null && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- NVIDIA, real filings
const raw = JSON.parse(readFileSync(new URL("./fixtures/nvda_companyfacts_trimmed.json", import.meta.url), "utf8"));
const h = normalizeCompanyFacts(raw);
const GF = "growth-first";
const a = L.analyzeLifecycle(h, L.DEFAULT_THRESHOLDS, undefined, GF);

t("NVDA is asset-light (capex about 2.4% of revenue) so the profit metric is operating profit", a.profit.metric.key === "operatingIncome" && a.profit.model === "asset_light" && near(a.profit.capexPct, 2.43, 0.05), `${a.profit.metric.key} ${a.profit.model} ${a.profit.capexPct}`);
t("Q1 revenue: yes, fast, TTM growth +83.4%", a.revenue.answer === "yes" && a.revenue.growthClass === "fast" && a.revenue.basis === "ttm" && near(a.revenue.growthPct, 83.4, 0.1), `${a.revenue.growthPct}`);
t("Q1 context: last fiscal year +65.5%, 3-year CAGR 100%", near(a.revenue.lastFiscalYearGrowthPct, 65.5, 0.1) && near(a.revenue.threeYearCagrPct, 100, 0.2));
t("Q2 profit: yes, strong, operating margin 65.2% (up from 54.1% two fiscal years earlier)", a.profit.answer === "yes" && a.profit.profitClass === "strong" && near(a.profit.marginPct, 65.2, 0.1) && a.profit.trend === "improving" && near(a.profit.marginTwoYearsAgoPct, 54.1, 0.1), `${a.profit.marginPct} ${a.profit.marginTwoYearsAgoPct} ${a.profit.trend}`);
t("Q2 other margins: net 63.7%, free cash flow 41.9%", near(a.profit.netMarginPct, 63.7, 0.1) && near(a.profit.fcfMarginPct, 41.9, 0.1));
t("Q3 capital return: yes, 'some', 48.9% of free cash flow", a.capitalReturn.answer === "yes" && a.capitalReturn.returnClass === "some" && near(a.capitalReturn.payoutPct, 48.9, 0.1), `${a.capitalReturn.payoutPct}`);
t("Q3: buybacks $55.3B + dividends $6.8B = $62.1B; after stock pay it is 43.2%", near(a.capitalReturn.returned / 1e9, 62.09, 0.05) && near(a.capitalReturn.payoutNetOfStockCompPct, 43.2, 0.1));
t("Q3: share count down about 1.2% in the last fiscal year (buybacks mostly offset stock pay)", near(a.capitalReturn.shareCountChangePct, -1.2, 0.1), `${a.capitalReturn.shareCountChangePct}`);
t("all three questions are 'yes' for NVDA", a.revenue.answer === "yes" && a.profit.answer === "yes" && a.capitalReturn.answer === "yes");
t("PHASE under the growth-first rule: NVDA is 2 Hyper growth (growth decides it; returning capital is recorded as a transition sign)", a.phase.phase === 2 && a.phase.name === "Hyper growth" && a.phase.confidence === "high", JSON.stringify(a.phase));
t("NVDA: phase 3 is listed as also consistent, because it returns cash and margins are widening", a.phase.alsoConsistentWith.some((x) => x.phase === 3) && /transition/i.test(a.phase.note), JSON.stringify(a.phase.alsoConsistentWith));

const tr = a.trajectory.map((x) => `${x.label}:${x.phase}`).join(" ");
t("trajectory covers five fiscal years", a.trajectory.length === 5, tr);
t("trajectory FY22=2, FY24=2, FY25=2, FY26=2", tr.includes("FY2022:2") && tr.includes("FY2024:2") && tr.includes("FY2025:2") && tr.includes("FY2026:2"), tr);
t("trajectory shows the FY23 stall as phase 4 (flat revenue, 274% payout): single years are noisy", tr.includes("FY2023:4"), tr);
t("chart series: five fiscal years plus TTM, TTM last", a.chart.length === 7 && a.chart[6].label === "TTM" && a.chart[6].isTtm && near(a.chart[6].operatingProfit / 1e9, 197.58, 0.05), a.chart.map((c) => c.label).join());
t("chart carries revenue, operating profit, net income and free cash flow for every point", a.chart.every((c) => c.revenue !== null && c.operatingProfit !== null && c.netIncome !== null && c.freeCashFlow !== null));

// ------------------------------------------------------- synthetic companies for each phase
const P = (o = {}) => ({ revenue: 100, grossProfit: 50, operatingIncome: 20, netIncome: 15, operatingCashFlow: 25, capex: 3, buybacks: 0, dividends: 0, stockBasedComp: 2, researchAndDevelopment: 5, ...o });
const mk = (cur: any, prior: any, fy: any[] = []) => {
  const annual = (fy.length ? fy : [P(prior), P(prior), P(prior), P(prior), P(prior)]).map((x, i) => ({ fiscalYearEnd: `202${i}-12-31`, dilutedShares: 100, ...x }));
  return { entityName: "Synthetic", annual, ttm: { periodEnd: "2026-06-30", ...P(cur) }, ttmYearAgo: { periodEnd: "2025-06-30", ...P(prior) }, balance: null, sharesOutstanding: null, latestFilingForm: "10-Q", warnings: [] };
};
const phaseOf = (cur: any, prior: any, rule: any = GF) => L.analyzeLifecycle(mk(cur, prior), L.DEFAULT_THRESHOLDS, undefined, rule);

t("start-up: growing 60%, losing money, returns nothing -> 1", phaseOf({ revenue: 160, operatingIncome: -30, netIncome: -35, operatingCashFlow: -20 }, { revenue: 100 }).phase.phase === 1);
t("hyper growth: +40%, profitable -> 2", phaseOf({ revenue: 140, operatingIncome: 30 }, { revenue: 100 }).phase.phase === 2);
t("operating leverage: +12%, profitable, returns about 15% of cash -> 3", phaseOf({ revenue: 112, operatingIncome: 28, operatingCashFlow: 30, capex: 5, buybacks: 3 }, { revenue: 100 }).phase.phase === 3);
t("capital return: +2%, profitable, returns 90% of cash -> 4", phaseOf({ revenue: 102, operatingIncome: 25, operatingCashFlow: 30, capex: 4, buybacks: 20, dividends: 3 }, { revenue: 100 }).phase.phase === 4);
t("capital return: +10% growth but returns 80% of cash -> 4 (heavy payout wins at steady growth)", phaseOf({ revenue: 110, operatingIncome: 25, operatingCashFlow: 30, capex: 4, buybacks: 18, dividends: 3 }, { revenue: 100 }).phase.phase === 4);
t("decline: revenue -12%, still profitable -> 5", phaseOf({ revenue: 88, operatingIncome: 10 }, { revenue: 100 }).phase.phase === 5);
t("decline beats everything: shrinking revenue and unprofitable -> 5", phaseOf({ revenue: 80, operatingIncome: -5, netIncome: -6 }, { revenue: 100 }).phase.phase === 5);
t("flat revenue (-1%) is not decline: profitable, returning cash -> 4", phaseOf({ revenue: 99, operatingIncome: 25, operatingCashFlow: 30, capex: 4, buybacks: 20 }, { revenue: 100 }).phase.phase === 4);
t("thresholds are adjustable: hyper-growth line moved to 100% makes +83% only 'growing' -> 3", (() => { const x = L.analyzeLifecycle(h, { ...L.DEFAULT_THRESHOLDS, fastGrowthPct: 100 }, undefined, GF); return x.revenue.growthClass === "growing" && x.phase.phase === 3; })());

// ---------------------------------------------------- profit metric depends on the business
const heavy = L.chooseProfitMetric(P({ revenue: 100, capex: 25 }));
t("capital-heavy business (capex 25% of revenue) uses free cash flow", heavy.key === "freeCashFlow" && heavy.model === "capital_heavy", JSON.stringify(heavy));
const mid = L.chooseProfitMetric(P({ revenue: 100, capex: 10 }));
t("in-between (capex 10%) uses operating profit and says free cash flow is shown alongside", mid.key === "operatingIncome" && mid.model === "moderate" && /alongside/.test(mid.reason));
t("no operating profit reported (bank) falls back to net income", L.chooseProfitMetric(P({ operatingIncome: null })).key === "netIncome");
const hv = L.analyzeLifecycle(mk({ revenue: 100, operatingIncome: 30, operatingCashFlow: 20, capex: 25 }, { revenue: 90 }));
t("capital-heavy: operating profit looks fine (30%) but free cash flow is negative, so profit answer is NO", hv.profit.metric.key === "freeCashFlow" && hv.profit.answer === "no" && hv.profit.profitClass === "unprofitable", JSON.stringify(hv.profit));
t("the profit metric can be forced by the user", L.analyzeLifecycle(h, L.DEFAULT_THRESHOLDS, "netIncome").profit.metric.key === "netIncome");

// ---------------------------------------------------------------------- robustness
const empty = L.analyzeLifecycle({ entityName: "X", annual: [], ttm: null, ttmYearAgo: null, balance: null, sharesOutstanding: null, latestFilingForm: null, warnings: ["No annual revenue found in the filings."] });
t("no data: phase is null with an honest message, nothing thrown", empty.phase.phase === null && empty.revenue.answer === "unknown" && empty.profit.answer === "unknown" && empty.chart.length === 0);
const noTtm = L.analyzeLifecycle({ ...h, ttm: null, ttmYearAgo: null }, L.DEFAULT_THRESHOLDS, undefined, GF);
t("without a TTM the fiscal-year growth is used and labelled", noTtm.revenue.basis === "fiscal-year" && near(noTtm.revenue.growthPct, 65.5, 0.1) && noTtm.phase.phase === 2);
const neg = L.analyzeLifecycle(mk({ revenue: 100, operatingCashFlow: -5, capex: 3, buybacks: 4 }, { revenue: 90 }));
t("returning cash while free cash flow is negative is flagged, not divided by zero", neg.capitalReturn.answer === "yes" && neg.capitalReturn.payoutPct === null && /not positive/.test(neg.capitalReturn.headline));
t("no NaN or Infinity anywhere in the NVDA analysis", !/NaN|Infinity/.test(JSON.stringify(a)));

// ------------------------------------------------ the capital-return-first rule (the current default)
t("the default rule is capital-return-first", L.DEFAULT_PHASE_RULE === "capital-return-first");
const cr = L.analyzeLifecycle(h);
t("default analysis reports which rule produced the phase", cr.rule === "capital-return-first" && a.rule === "growth-first");
t("PHASE under capital-return-first: NVDA is 4 Capital return (profitable and returning 48.9% of free cash flow, above the 10% line)", cr.phase.phase === 4 && cr.phase.name === "Capital return", JSON.stringify(cr.phase));
t("NVDA under this rule: phase 2 is named as the alternative, with growth 83% against the 25% line", cr.phase.alsoConsistentWith.some((x) => x.phase === 2 && /83%/.test(x.reason) && /growth-first/.test(x.reason)), JSON.stringify(cr.phase.alsoConsistentWith));
t("NVDA under this rule: the note warns that capital-return measures understate what the price pays for", /understate what the price is paying for/.test(cr.phase.note));
t("the three answers do not change with the rule, only the phase does", cr.revenue.growthPct === a.revenue.growthPct && cr.profit.marginPct === a.profit.marginPct && cr.capitalReturn.payoutPct === a.capitalReturn.payoutPct);
t("trajectory under capital-return-first: FY22 is 2 (4.9% payout), FY23 to FY26 are 4", (() => { const x = cr.trajectory.map((p) => `${p.label}:${p.phase}`).join(" "); return x.includes("FY2022:2") && ["FY2023:4", "FY2024:4", "FY2025:4", "FY2026:4"].every((k) => x.includes(k)); })(), cr.trajectory.map((p) => `${p.label}:${p.phase}`).join(" "));
const CRF = "capital-return-first";
t("capital-return-first: a fast grower returning little cash is still phase 2", phaseOf({ revenue: 140, operatingIncome: 30, buybacks: 1 }, { revenue: 100 }, CRF).phase.phase === 2);
t("capital-return-first: +12% growth and 15% of cash returned is phase 4 (it was 3 under growth-first)", phaseOf({ revenue: 112, operatingIncome: 28, operatingCashFlow: 30, capex: 5, buybacks: 3 }, { revenue: 100 }, CRF).phase.phase === 4 && phaseOf({ revenue: 112, operatingIncome: 28, operatingCashFlow: 30, capex: 5, buybacks: 3 }, { revenue: 100 }, GF).phase.phase === 3);
t("capital-return-first: steady growth and no cash returned is phase 3", phaseOf({ revenue: 112, operatingIncome: 28, operatingCashFlow: 30, capex: 5 }, { revenue: 100 }, CRF).phase.phase === 3);
t("capital-return-first: unprofitable is still phase 1, even if it somehow returns cash", phaseOf({ revenue: 160, operatingIncome: -30, netIncome: -35, operatingCashFlow: -20, buybacks: 5 }, { revenue: 100 }, CRF).phase.phase === 1);
t("capital-return-first: shrinking revenue is still phase 5, whatever it returns", phaseOf({ revenue: 88, operatingIncome: 10, operatingCashFlow: 30, capex: 4, buybacks: 20 }, { revenue: 100 }, CRF).phase.phase === 5);
t("capital-return-first: returning cash while free cash flow is negative counts as heavy and is phase 4", (() => { const x = L.analyzeLifecycle(mk({ revenue: 100, operatingIncome: 20, operatingCashFlow: -5, capex: 3, buybacks: 4 }, { revenue: 90 }), L.DEFAULT_THRESHOLDS, undefined, CRF); return x.phase.phase === 4 && x.phase.decidedBy.some((d) => /not positive/.test(d)); })());
t("the two rules agree when growth is slow and cash is returned (both say 4)", phaseOf({ revenue: 102, operatingIncome: 25, operatingCashFlow: 30, capex: 4, buybacks: 20, dividends: 3 }, { revenue: 100 }, CRF).phase.phase === 4 && phaseOf({ revenue: 102, operatingIncome: 25, operatingCashFlow: 30, capex: 4, buybacks: 20, dividends: 3 }, { revenue: 100 }, GF).phase.phase === 4);
process.exit(bad ? 1 : 0);
