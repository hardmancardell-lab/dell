// @ts-nocheck -- run with node --experimental-strip-types, not compiled by the app build
// Checks the SEC-filing normalizer against NVIDIA's real 10-K/10-Q data (trimmed copy in scripts/fixtures).
// Run: node --experimental-strip-types scripts/sec-financials.test.mts
import { readFileSync } from "node:fs";
import { normalizeCompanyFacts } from "../src/lib/data/sec-financials.ts";

const raw = JSON.parse(readFileSync(new URL("./fixtures/nvda_companyfacts_trimmed.json", import.meta.url), "utf8"));
const h = normalizeCompanyFacts(raw);
let bad = 0;
const t = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const near = (a: number | null, b: number, tol = 1) => a !== null && Math.abs(a - b) <= tol;
const B = (v: number | null) => (v === null ? "null" : (v / 1e9).toFixed(3) + "B");

t("entity name", h.entityName === "NVIDIA CORP");
const fy = (end: string) => h.annual.find((a) => a.fiscalYearEnd === end);
const f26 = fy("2026-01-25"), f25 = fy("2025-01-26"), f24 = fy("2024-01-28"), f23 = fy("2023-01-29");
t("six fiscal years, oldest first", h.annual.length === 6 && h.annual[0].fiscalYearEnd < h.annual[5].fiscalYearEnd, h.annual.map((a) => a.fiscalYearEnd).join());
t("FY2026 revenue $215.94B / operating income $130.39B / net income $120.07B",
  Math.round(f26.revenue / 1e7) === 21594 && Math.round(f26.operatingIncome / 1e7) === 13039 && Math.round(f26.netIncome / 1e7) === 12007, `${B(f26.revenue)} ${B(f26.operatingIncome)} ${B(f26.netIncome)}`);
t("FY2026 operating cash flow $102.72B, capex $6.04B, buybacks $40.09B, dividends $0.97B",
  Math.round(f26.operatingCashFlow / 1e7) === 10272 && Math.round(f26.capex / 1e7) === 604 && Math.round(f26.buybacks / 1e7) === 4009 && Math.round(f26.dividends / 1e7) === 97, `${B(f26.operatingCashFlow)} ${B(f26.capex)} ${B(f26.buybacks)} ${B(f26.dividends)}`);
t("FY2025 revenue $130.50B, FY2024 $60.92B, FY2023 $26.97B", Math.round(f25.revenue / 1e7) === 13050 && Math.round(f24.revenue / 1e7) === 6092 && Math.round(f23.revenue / 1e7) === 2697);
t("capex tag fallback works in years before the newer tag", f23.capex !== null && Math.round(f23.capex / 1e7) === 183, B(f23.capex));
t("FY2023 buybacks $10.04B, FY2022 none reported as zero", Math.round(f23.buybacks / 1e7) === 1004 && (fy("2022-01-30").buybacks === 0 || fy("2022-01-30").buybacks === null));

// split adjustment: share counts must be comparable across the June-2024 10-for-1 and the 2021 4-for-1 splits
const sh = h.annual.map((a) => a.dilutedShares);
t("diluted shares are split-adjusted: all years within 15% of 25B", sh.every((s) => s !== null && s > 20e9 && s < 29e9), sh.map(B).join(" "));
t("share count shrinking FY2024 -> FY2026 (about 24.9B to 24.5B)", f26.dilutedShares < f24.dilutedShares && near(f26.dilutedShares / 1e9, 24.51, 0.05));

// TTM, two independent ways
t("latest period is the quarter ended 2026-07-26", h.ttm && h.ttm.periodEnd === "2026-07-26", h.ttm?.periodEnd);
t("a year-ago TTM exists and ends about 2025-07-27", h.ttmYearAgo && Math.abs(Date.parse(h.ttmYearAgo.periodEnd) - Date.parse("2025-07-27")) <= 5 * 864e5, h.ttmYearAgo?.periodEnd);

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
function quarterSum(tag: string, endLatest: string) {
  // independent method: sum four discrete 3-month figures; Q4 is derived as FY minus the nine-month figure
  const rows = raw.facts["us-gaap"][tag].units.USD.filter((r: any) => r.start);
  const q = (end: string, d0: number, d1: number) => {
    const m = rows.filter((r: any) => r.end === end && days(r.start, r.end) >= d0 && days(r.start, r.end) <= d1).sort((a: any, b: any) => (a.filed < b.filed ? 1 : -1))[0];
    return m ? m.val : null;
  };
  const ends = [...new Set(rows.map((r: any) => r.end))].sort();
  const idx = ends.indexOf(endLatest);
  const near = (target: string) => ends.find((e: string) => Math.abs(days(e, target)) <= 6);
  // quarter ends going back one year from the latest
  const q2 = q(endLatest, 80, 100);
  const prevEnds = ends.filter((e: string) => days(e, endLatest) > 60 && days(e, endLatest) < 380).sort().reverse();
  const q1End = prevEnds.find((e: string) => days(e, endLatest) > 80 && days(e, endLatest) < 100);
  const q4End = prevEnds.find((e: string) => days(e, endLatest) > 170 && days(e, endLatest) < 190);
  const q3End = prevEnds.find((e: string) => days(e, endLatest) > 260 && days(e, endLatest) < 280);
  const q1 = q(q1End, 80, 100), q3 = q(q3End, 80, 100);
  const fyAnnual = rows.filter((r: any) => r.end === q4End && days(r.start, r.end) >= 350).sort((a: any, b: any) => (a.filed < b.filed ? 1 : -1))[0];
  const nine = q(q3End, 260, 280);
  const q4 = fyAnnual && nine !== null ? fyAnnual.val - nine : null;
  return { q2, q1, q4, q3, sum: [q2, q1, q4, q3].some((v) => v === null) ? null : q2 + q1 + q4 + q3, parts: { q1End, q4End, q3End } };
}
for (const [label, tag, field] of [["revenue", "Revenues", "revenue"], ["operating income", "OperatingIncomeLoss", "operatingIncome"], ["net income", "NetIncomeLoss", "netIncome"]]) {
  const qs = quarterSum(tag, h.ttm.periodEnd);
  t(`TTM ${label} matches the four-quarter sum (${B(h.ttm[field])})`, qs.sum !== null && near(h.ttm[field], qs.sum, 2e6), `ttm=${B(h.ttm[field])} sum=${qs.sum === null ? "null" : B(qs.sum)} ${JSON.stringify(qs.parts)}`);
}
t("TTM revenue is above the last full fiscal year (the business kept growing)", h.ttm.revenue > f26.revenue, `${B(h.ttm.revenue)} vs ${B(f26.revenue)}`);
t("TTM growth vs year-ago TTM is positive and large", h.ttm.revenue / h.ttmYearAgo.revenue - 1 > 0.3, ((h.ttm.revenue / h.ttmYearAgo.revenue - 1) * 100).toFixed(1) + "%");

// balance sheet and cover page
t("balance sheet at the latest quarter end", h.balance && h.balance.asOf === "2026-07-26");
t("cash $22.44B", near(h.balance.cash, 22.44e9, 2e7), B(h.balance.cash));
t("securities found (marketable debt securities)", h.balance.securities !== null && h.balance.securities > 40e9, B(h.balance.securities));
// The filing shows debt rising from $8.47B (Jan 2026) to $33.37B (Jul 2026): $32.37B long-term + $1.00B current.
t("debt at the latest quarter is $33.37B (long-term $32.37B + current $1.00B)", near(h.balance.debt, 33.366e9, 2e6), B(h.balance.debt));
t("net cash = cash + securities - debt = $35.98B", near(h.balance.netCash, h.balance.cash + h.balance.securities - h.balance.debt, 1) && near(h.balance.netCash, 35.977e9, 5e6), B(h.balance.netCash));
t("cover-page shares about 24.1B as of 2026-08-21", h.sharesOutstanding && h.sharesOutstanding.value === 24.1e9 && h.sharesOutstanding.asOf === "2026-08-21", JSON.stringify(h.sharesOutstanding));
t("no warnings on a complete filing set", h.warnings.length === 0, h.warnings.join(" | "));

// robustness
t("empty facts do not throw and say why", (() => { const e = normalizeCompanyFacts({ facts: {} }); return e.annual.length === 0 && e.ttm === null && e.warnings.length > 0; })());
t("a company with only annual data still yields TTM = last FY", (() => {
  const only = JSON.parse(JSON.stringify(raw));
  for (const tag of Object.keys(only.facts["us-gaap"])) for (const u of Object.keys(only.facts["us-gaap"][tag].units)) only.facts["us-gaap"][tag].units[u] = only.facts["us-gaap"][tag].units[u].filter((r: any) => r.form === "10-K");
  const x = normalizeCompanyFacts(only);
  return x.ttm && x.ttm.periodEnd === "2026-01-25" && x.ttm.revenue === f26.revenue;
})());
process.exit(bad ? 1 : 0);
