// @ts-nocheck -- run with node --experimental-strip-types, not compiled by the app build
// Hand-checked cases for the 401(k) analyzer math. Run: node --experimental-strip-types scripts/retirement-math.test.mts
import * as M from "../src/lib/agents/retirement/retirement-math.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const near = (a: number | null, b: number, eps = 1e-6) => a !== null && Math.abs(a - b) < eps;

// ---- blended cost: $10k at 0.75% + $10k at 0.08% -> 0.415%, $83/yr
const funds: M.FundRow[] = [
  { id: "a", name: "Fidelity Freedom 2040 Fund", assetGroup: "blended", type: "target_date_active", vehicle: "mutual_fund", targetYear: 2040, expenseRatioPct: 0.75 },
  { id: "b", name: "Fidelity Freedom Index 2040 Fund", assetGroup: "blended", type: "target_date_index", vehicle: "mutual_fund", targetYear: 2040, expenseRatioPct: 0.08 },
  { id: "c", name: "No cost entered", assetGroup: "stocks", type: "other", vehicle: "unknown", targetYear: null, expenseRatioPct: null },
];
let bc = M.blendedExpenseRatio(funds, [{ fundId: "a", balance: 10000, contributionPct: 50 }, { fundId: "b", balance: 10000, contributionPct: 50 }]);
t("blended ratio 0.415%", near(bc.blendedPct, 0.415), String(bc.blendedPct));
t("yearly dollars $83", near(bc.annualDollars, 83), String(bc.annualDollars));
t("full coverage", bc.coveredPct === 100 && bc.missingCost.length === 0);
bc = M.blendedExpenseRatio(funds, [{ fundId: "a", balance: 10000, contributionPct: 0 }, { fundId: "c", balance: 10000, contributionPct: 0 }]);
t("missing-cost fund is flagged, not treated as zero", bc.coveredPct === 50 && bc.missingCost[0] === "No cost entered" && near(bc.blendedPct, 0.75));
t("empty holdings: no blended number", M.blendedExpenseRatio(funds, []).blendedPct === null);
t("negative/NaN balances ignored", M.blendedExpenseRatio(funds, [{ fundId: "a", balance: -5, contributionPct: 0 }, { fundId: "b", balance: NaN, contributionPct: 0 }]).totalBalance === 0);
t("cost per $1,000", near(M.costPer1000(0.75), 7.5) && near(M.costPer1000(0.015), 0.15));

// ---- DOL worked example: $25,000, 35 years, 7%, fees 0.5% vs 1.5%, no contributions
const d = M.feeDrag({ balance: 25000, years: 35, returnPct: 7 }, 0.5, 1.5);
t("DOL example A rounds to $227,000", Math.round(d.a / 1000) * 1000 === 227000, String(d.a));
t("DOL example B rounds to $163,000", Math.round(d.b / 1000) * 1000 === 163000, String(d.b));
t("DOL example difference rounds to 28%", Math.round(d.differencePct) === 28, String(d.differencePct));
// ---- contributions: $0 start, $1,000 a year at 5%, 2 years, end-of-year -> 2,050
t("year-end contributions", near(M.projectBalance({ balance: 0, years: 2, returnPct: 5, feePct: 0, annualContribution: 1000 }), 2050, 1e-6));
t("zero growth with contributions", near(M.projectBalance({ balance: 100, years: 3, returnPct: 1, feePct: 1, annualContribution: 10 }), 130));
t("zero years returns the starting balance", M.projectBalance({ balance: 500, years: 0, returnPct: 7, feePct: 1 }) === 500);
const s = M.projectionSeries({ balance: 1000, years: 3, returnPct: 10, feePct: 0 });
t("series length and values", s.length === 4 && near(s[0], 1000) && near(s[3], 1331));

// ---- match: salary $40,000, saving 3%, 50% up to 6% -> $600 captured, $1,200 max, $600 left, need 6%
let m = M.matchCapture(40000, 3, [{ upToPct: 6, ratePct: 50 }]);
t("simple match captured", near(m.capturedDollars, 600) && near(m.maxDollars, 1200) && near(m.leftOnTableDollars, 600) && m.fullMatchSavingPct === 6, JSON.stringify(m));
m = M.matchCapture(40000, 8, [{ upToPct: 6, ratePct: 50 }]);
t("saving past the cap collects the max, nothing extra", near(m.capturedDollars, 1200) && m.leftOnTableDollars === 0);
// tiers: 100% of first 3%, 50% of next 2%, salary 50,000, saving 4% -> 1500 + 250 = 1750 ; max 2000
m = M.matchCapture(50000, 4, [{ upToPct: 3, ratePct: 100 }, { upToPct: 5, ratePct: 50 }]);
t("tiered match", near(m.capturedDollars, 1750) && near(m.maxDollars, 2000), JSON.stringify(m));
m = M.matchCapture(50000, 4, [{ upToPct: 5, ratePct: 50 }, { upToPct: 3, ratePct: 100 }]);
t("tiers given out of order are sorted", near(m.capturedDollars, 1750));
t("no tiers: no match", M.matchCapture(50000, 4, []).maxDollars === 0);
t("saving 0% captures nothing", M.matchCapture(50000, 0, [{ upToPct: 6, ratePct: 50 }]).capturedDollars === 0);

// ---- vesting
t("immediate = 100", M.vestedPct({ kind: "immediate" }, 0) === 100);
t("3-year cliff at 2 years = 0, at 3 = 100", M.vestedPct({ kind: "cliff", years: 3 }, 2) === 0 && M.vestedPct({ kind: "cliff", years: 3 }, 3) === 100);
t("graded 2-6: 1y=0, 2y=20, 3y=40, 5.5y=80, 6y=100", [1, 2, 3, 5.5, 6].map((y) => M.vestedPct(M.GRADED_2_TO_6, y)).join() === "0,20,40,80,100");
let v = M.vestingStatus(M.GRADED_2_TO_6, 3, 5000);
t("forfeit at 3 years graded = 60% of employer money", v.vestedPct === 40 && near(v.forfeitIfLeaveToday, 3000) && near(v.yearsToNextStep, 1) && v.nextStepPct === 60, JSON.stringify(v));
v = M.vestingStatus({ kind: "cliff", years: 3 }, 1.5, 1000);
t("cliff: forfeits everything, 1.5 years to go", v.vestedPct === 0 && near(v.forfeitIfLeaveToday, 1000) && near(v.yearsToNextStep, 1.5) && v.nextStepPct === 100);
v = M.vestingStatus(M.GRADED_2_TO_6, 7, 1000);
t("fully vested: nothing forfeited, no next step", v.vestedPct === 100 && v.forfeitIfLeaveToday === 0 && v.yearsToNextStep === null);

// ---- fund-type suggestions (Fidelity naming)
const sg = (n: string) => M.suggestFundType(n);
t("Freedom Index 2040 -> TDF index, 2040", sg("Fidelity Freedom\u00ae Index 2040 Fund Institutional Premium Class").type === "target_date_index" && sg("Fidelity Freedom\u00ae Index 2040 Fund Institutional Premium Class").targetYear === 2040);
t("Freedom 2040 -> TDF active, 2040", sg("Fidelity Freedom\u00ae 2040 Fund").type === "target_date_active" && sg("Fidelity Freedom\u00ae 2040 Fund").targetYear === 2040);
t("500 Index Fund -> index", sg("Fidelity\u00ae 500 Index Fund").type === "index_fund" && sg("Fidelity\u00ae 500 Index Fund").targetYear === null);
t("Contrafund -> other (name says nothing)", sg("Fidelity\u00ae Contrafund\u00ae").type === "other" && sg("Fidelity\u00ae Contrafund\u00ae").basis === "none");
t("money market", sg("Fidelity Government Money Market Fund").type === "money_market");
t("BrokerageLink", sg("Fidelity BrokerageLink").type === "brokerage_window");
t("Emerging Markets Index -> index (not target date)", sg("Fidelity\u00ae Emerging Markets Index Fund").type === "index_fund");
t("a 4-digit year in a non-TDF name is not read as a target year", sg("Acme 2024 Growth Fund").targetYear === null && sg("Acme 2024 Growth Fund").type !== "target_date_active");

// ---- target-date comparison
const g = M.targetDateGroups(funds);
t("one 2040 group with both funds", g.length === 1 && g[0].targetYear === 2040 && g[0].funds.length === 2);
t("spread: 0.67 points, $6.70 per $1,000, ratio 9.375", g[0].spread !== null && near(g[0].spread.differencePct, 0.67) && near(g[0].spread.differencePer1000, 6.7) && near(g[0].spread.ratio, 9.375), JSON.stringify(g[0].spread));
t("a lone target-date fund gets no spread", M.targetDateGroups([funds[0]])[0].spread === null);
t("non target-date funds are excluded", M.targetDateGroups([{ ...funds[2], targetYear: 2040 }]).length === 0);

process.exit(bad ? 1 : 0);
