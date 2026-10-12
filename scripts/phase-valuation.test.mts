// @ts-nocheck -- run with node --experimental-strip-types, not compiled by the app build
import { readFileSync } from "node:fs";
import { normalizeCompanyFacts } from "../src/lib/data/sec-financials.ts";
import * as V from "../src/lib/agents/research-agent/skills/phase-valuation.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const near = (a: number | null, b: number, tol = 1e-6) => a !== null && Math.abs(a - b) <= tol;

// ---- DCF arithmetic by hand
t("flat perpetuity: $100 a year forever at 10% is worth $1,000", near(V.dcfValue(100, 0, 10, 0, 10), 1000, 1e-6), String(V.dcfValue(100, 0, 10, 0, 10)));
t("a Gordon perpetuity: growth = terminal = 3%, r = 10% -> 100*1.03/0.07 = $1,471.43", near(V.dcfValue(100, 3, 10, 3, 10), 100 * 1.03 / 0.07, 1e-6), String(V.dcfValue(100, 3, 10, 3, 10)));
t("fade starting at the terminal rate equals constant growth at the terminal rate", near(V.dcfValueFade(100, 3, 10, 3, 10), V.dcfValue(100, 3, 10, 3, 10), 1e-6));
t("faster growth is worth more", V.dcfValue(100, 15, 10, 3, 10) > V.dcfValue(100, 10, 10, 3, 10));
t("a higher discount rate is worth less", V.dcfValue(100, 10, 12, 3, 10) < V.dcfValue(100, 10, 10, 3, 10));
t("discount rate at or below terminal growth is refused, not infinite", V.dcfValue(100, 5, 3, 3, 10) === null && V.dcfValue(100, 5, 2, 3, 10) === null);
const ev12 = V.dcfValue(100, 12, 10, 3, 10);
t("implied growth inverts the DCF: value at 12% growth -> solves back to 12%", near(V.impliedGrowth(ev12, 100, 10, 3, 10), 12, 1e-6), String(V.impliedGrowth(ev12, 100, 10, 3, 10)));
const evf = V.dcfValueFade(100, 25, 10, 3, 10);
t("implied fade start inverts the fading DCF: 25% -> 25%", near(V.impliedFadeStart(evf, 100, 10, 3, 10), 25, 1e-6));
t("unreachable price returns null instead of a wrong number", V.impliedGrowth(1e12, 100, 10, 3, 10) === null && V.impliedGrowth(-5, 100, 10, 3, 10) === null && V.impliedGrowth(1000, -50, 10, 3, 10) === null);

// ---- multiples by hand: price 100, 10 shares, net cash 100 -> market cap 1000, EV 900
const P = (o = {}) => ({ periodEnd: "2026-06-30", revenue: 500, grossProfit: 250, operatingIncome: 90, netIncome: 50, operatingCashFlow: 80, capex: 20, buybacks: 20, dividends: 10, stockBasedComp: 6, researchAndDevelopment: 30, ...o });
const base = { price: 100, sharesOutstanding: 10, netCash: 100, ttm: P(), ttmYearAgo: P({ revenue: 400, operatingCashFlow: 50, capex: 20 }), riskFreePct: 4.2, ...V.DEFAULT_VALUATION_SETTINGS };
const m = V.multiples(base);
t("market cap 1000 and EV 900", near(m.marketCap, 1000) && near(m.enterpriseValue, 900));
t("P/S 2, EV/S 1.8, P/E 20, earnings yield 5%", near(m.priceToSales, 2) && near(m.evToSales, 1.8) && near(m.priceToEarnings, 20) && near(m.earningsYieldPct, 5));
t("EV/operating profit 10, EV/FCF 15, FCF yield 6%", near(m.evToOperatingProfit, 10) && near(m.evToFcf, 15) && near(m.fcfYieldPct, 6));
t("price/gross profit 4.0 (1000/250) and price/free cash flow 16.67 (1000/60)", near(m.priceToGrossProfit, 4) && near(m.priceToFcf, 1000 / 60, 1e-9));
t("no price/gross profit or price/FCF when the denominator is not positive", V.multiples({ ...base, ttm: P({ grossProfit: -1, operatingCashFlow: 10, capex: 20 }) }).priceToGrossProfit === null && V.multiples({ ...base, ttm: P({ operatingCashFlow: 10, capex: 20 }) }).priceToFcf === null);
t("shareholder yield 3% (dividends 1% + buybacks 2%)", near(m.shareholderYieldPct, 3) && near(m.dividendYieldPct, 1) && near(m.buybackYieldPct, 2));
t("FCF yield after stock pay: (60 - 6) / 1000 = 5.4%", near(m.fcfAfterStockPayYieldPct, 5.4));
t("negative earnings give no P/E rather than a negative one", V.multiples({ ...base, ttm: P({ netIncome: -5, operatingIncome: -2, operatingCashFlow: 10, capex: 20 }) }).priceToEarnings === null);

// ---- reverse DCF round trip on the hand case
const rd = V.reverseDcf(base);
t("reverse DCF: value at the implied growth equals today's EV", rd.impliedGrowthPct !== null && near(V.dcfValue(rd.baseCashFlow, rd.impliedGrowthPct, 10, 3, 10), 900, 1e-4), JSON.stringify(rd));
t("current free cash flow growth 100% (30 -> 60) is read from the year-ago TTM", near(rd.currentCashFlowGrowthPct, 100, 1e-6) && near(rd.currentRevenueGrowthPct, 25, 1e-6));
const curve = V.valueByGrowth(base, [0, 5, 10, 15]);
t("value-per-share curve rises with growth", curve.every((c, i) => i === 0 || c.valuePerShare > curve[i - 1].valuePerShare));
const sens = V.sensitivity(base);
const cell = (r: number, g: number) => sens.find((c) => c.discountRatePct === r && c.terminalGrowthPct === g).impliedGrowthPct;
t("sensitivity: higher discount rate needs more growth; higher terminal growth needs less", cell(12, 3) > cell(10, 3) && cell(10, 3) > cell(8, 3) && cell(10, 2) > cell(10, 4), JSON.stringify(sens));
const afterSbc = V.reverseDcf({ ...base, cashFlowBasis: "fcfAfterStockPay" });
t("treating stock pay as a cost lowers the base and raises the growth the price needs", afterSbc.baseCashFlow === 54 && afterSbc.impliedGrowthPct > rd.impliedGrowthPct);
t("negative free cash flow: no implied growth, honest statement, no crash", (() => { const x = V.valuationForPhase(2, { ...base, ttm: P({ operatingCashFlow: 5, capex: 20 }) }); return x.reverseDcf.impliedGrowthPct === null && x.statements.some((s) => /not positive/.test(s)); })());

// ---- phase lenses
const lens = (n: number) => V.valuationForPhase(n, base);
const primary = (n: number) => lens(n).metrics.filter((x) => x.tier === "primary").map((x) => x.key).join();
t("the founder's mapping: 1 and 2 lead with price/sales and price/gross profit", primary(1) === "ps,pgp" && primary(2) === "ps,pgp", `${primary(1)} | ${primary(2)}`);
t("the founder's mapping: 3 and 4 lead with price/earnings and price/free cash flow", primary(3).startsWith("pe,pfcf") && primary(4).startsWith("pe,pfcf"), `${primary(3)} | ${primary(4)}`);
t("phase 5 leads with price/free cash flow (this page's suggestion, labelled as such)", primary(5).startsWith("pfcf") && lens(5).caveats.some((c) => /suggestion, not a set rule/.test(c)));
t("phase 2 already-profitable company: earnings multiples appear as supporting context", lens(2).metrics.some((x) => x.key === "pe" && x.tier === "supporting") && lens(2).statements.some((s) => /already profitable/.test(s)));
t("phases 2 and 3 ask the growth-assumed question through the reverse DCF", /growth/i.test(lens(2).question) && lens(2).statements.some((s) => /market is paying for free cash flow/.test(s)) && lens(3).statements.some((s) => /market is paying for free cash flow/.test(s)));
t("phase 4 asks about yield, shows shareholder yield and the Treasury as supporting", /yield/i.test(lens(4).question) && lens(4).metrics.some((x) => x.key === "rf" && x.value === 4.2 && x.tier === "supporting") && lens(4).metrics.some((x) => x.key === "shareholderYield" && x.tier === "supporting"));
t("a sales multiple alone is called a ruler needing something to hold it against", lens(1).caveats.some((c) => /peer or price-history data/.test(c)) && lens(2).caveats.some((c) => /only a ruler/.test(c)));
t("phase 4 statement compares FCF yield (6%) with the 4.2% Treasury", lens(4).statements.some((s) => /at or above the 10-year Treasury/.test(s)));
t("phase 1 reports runway when burning cash", (() => { const x = V.valuationForPhase(1, { ...base, ttm: P({ operatingCashFlow: -50, capex: 10, operatingIncome: -40, netIncome: -45 }) }); const r = x.metrics.find((k) => k.key === "runway"); return r.value !== null && Math.abs(r.value - (100 / 60) * 12) < 1e-6; })());
t("phase 5 asks about shrinkage", /shrink/i.test(lens(5).question));
t("every lens states that it is arithmetic, not a forecast, and shows its assumptions", [1, 2, 3, 4, 5].every((n) => lens(n).caveats.some((c) => /not a forecast/.test(c)) && lens(n).caveats.some((c) => /Discount rate 10%/.test(c))));
t("no lens statement tells anyone to buy or sell", [1, 2, 3, 4, 5].every((n) => !/\b(buy|sell|should|recommend|bargain|undervalued|overvalued)\b/i.test(lens(n).statements.join(" ") + lens(n).caveats.join(" "))));

// ---- NVIDIA at $239.10, real filings
const raw = JSON.parse(readFileSync(new URL("./fixtures/nvda_companyfacts_trimmed.json", import.meta.url), "utf8"));
const h = normalizeCompanyFacts(raw);
const nv = (price: number, extra = {}) => ({ price, sharesOutstanding: h.sharesOutstanding.value, netCash: h.balance.netCash, ttm: h.ttm, ttmYearAgo: h.ttmYearAgo, riskFreePct: null, ...V.DEFAULT_VALUATION_SETTINGS, ...extra });
const nm = V.multiples(nv(239.1));
t("NVDA market cap $5.762T, EV $5.726T", near(nm.marketCap / 1e12, 5.762, 0.001) && near(nm.enterpriseValue / 1e12, 5.726, 0.001), `${nm.marketCap / 1e12} ${nm.enterpriseValue / 1e12}`);
t("NVDA P/E 29.9, EV/EBIT 29.0, EV/FCF 45.1, FCF yield 2.2%, P/S 19.0", near(nm.priceToEarnings, 29.9, 0.05) && near(nm.evToOperatingProfit, 29.0, 0.05) && near(nm.evToFcf, 45.1, 0.05) && near(nm.fcfYieldPct, 2.2, 0.05) && near(nm.priceToSales, 19.0, 0.05), JSON.stringify(nm));
t("NVDA shareholder yield 1.1%, dividend yield 0.1%", near(nm.shareholderYieldPct, 1.1, 0.05) && near(nm.dividendYieldPct, 0.1, 0.05));
const nr = V.reverseDcf(nv(239.1));
t("NVDA reverse DCF round-trips to today's EV", near(V.dcfValue(nr.baseCashFlow, nr.impliedGrowthPct, 10, 3, 10), nm.enterpriseValue, 1e6), `${nr.impliedGrowthPct}`);
console.log("   NVDA implied 10y FCF growth:", nr.impliedGrowthPct.toFixed(2) + "%", "| fade start:", nr.impliedFadeStartPct.toFixed(2) + "%", "| year-10 FCF:", (nr.finalYearCashFlow / 1e9).toFixed(0) + "B (" + nr.multipleOfToday.toFixed(2) + "x)", "| demand:", nr.demand, "| vs current:", nr.versusCurrent, "| current FCF growth:", nr.currentCashFlowGrowthPct.toFixed(1) + "% rev " + nr.currentRevenueGrowthPct.toFixed(1) + "%");
const sensN = V.sensitivity(nv(239.1)).map((c) => `r${c.discountRatePct}/g${c.terminalGrowthPct}=${c.impliedGrowthPct.toFixed(1)}`).join("  ");
console.log("   sensitivity:", sensN);
const lo = V.reverseDcf(nv(238.9)).impliedGrowthPct, hi = V.reverseDcf(nv(239.1)).impliedGrowthPct;
t("price uncertainty is harmless: $0.20 moves the implied growth by under 0.05 points", Math.abs(hi - lo) < 0.05, `${lo} ${hi}`);
const at219 = V.reverseDcf(nv(219.74)).impliedGrowthPct;
console.log("   at the stale $219.74 snippet price:", at219.toFixed(2) + "% (vs " + hi.toFixed(2) + "% at $239.10)");
const n2 = V.valuationForPhase(2, nv(239.1));
const val = (lns: any, key: string) => lns.metrics.find((x: any) => x.key === key).value;
console.log("   NVDA phase-2 primary: P/S", val(n2, "ps").toFixed(1) + "x", "| P/gross profit", val(n2, "pgp").toFixed(1) + "x", "| supporting P/E", val(n2, "pe").toFixed(1) + "x", "P/FCF", val(n2, "pfcf").toFixed(1) + "x");
t("NVDA phase-2 lens leads with price/sales 19.0x and price/gross profit", n2.metrics[0].key === "ps" && near(val(n2, "ps"), 19.0, 0.05) && n2.metrics[1].key === "pgp" && val(n2, "pgp") > 20 && val(n2, "pgp") < 40, `${val(n2, "pgp")}`);
const n4 = V.valuationForPhase(4, nv(239.1, { riskFreePct: 4.3 }));
console.log("   NVDA if treated as phase 4: P/E", val(n4, "pe").toFixed(1) + "x", "| P/FCF", val(n4, "pfcf").toFixed(1) + "x", "| shareholder yield", val(n4, "shareholderYield").toFixed(2) + "%", "| FCF yield", val(n4, "fcfYield").toFixed(2) + "% vs 4.3% Treasury");
t("NVDA phase-4 lens: P/E 29.9x, P/FCF 45.4x, shareholder yield 1.1%, and the yield sits below the Treasury", near(val(n4, "pe"), 29.9, 0.05) && near(val(n4, "pfcf"), 45.4, 0.1) && near(val(n4, "shareholderYield"), 1.1, 0.05) && n4.statements.some((s) => /below the 10-year Treasury yield/.test(s)), JSON.stringify(n4.statements));
t("no NaN or Infinity in any NVDA lens", [1, 2, 3, 4, 5].every((n) => !/NaN|Infinity/.test(JSON.stringify(V.valuationForPhase(n, nv(239.1))))));
process.exit(bad ? 1 : 0);
