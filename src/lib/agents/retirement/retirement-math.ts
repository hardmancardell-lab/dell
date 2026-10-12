/**
 * Pure math for the 401(k) plan analyzer. No React, no network, no storage, so
 * every function can be checked by hand.
 *
 * Educational use only. Nothing here ranks funds as "best", predicts returns,
 * or recommends an investment. Return and fee inputs are the user's own
 * assumptions and every output that depends on them is shown with them (see
 * DOL Interpretive Bulletin 96-1, 29 CFR 2509.96-1: material facts and
 * assumptions must accompany interactive investment materials).
 */

export type FundType =
  | "target_date_index"
  | "target_date_active"
  | "target_risk_blended"
  | "index_fund"
  | "active_fund"
  | "stable_value_fixed"
  | "money_market"
  | "company_stock"
  | "brokerage_window"
  | "other";

export type FundVehicle = "mutual_fund" | "collective_trust" | "other_pool" | "unknown";

export type AssetGroup = "stocks" | "blended" | "bonds" | "short_term" | "fixed_return" | "other";

export interface FundRow {
  id: string;
  name: string;
  assetGroup: AssetGroup;
  type: FundType;
  vehicle: FundVehicle;
  targetYear: number | null;
  /** Gross expense ratio as printed in the plan's disclosure, in percent (0.75 means 0.75%). */
  expenseRatioPct: number | null;
}

export interface Holding {
  fundId: string;
  balance: number;
  /** Share of each new paycheck contribution going to this fund, in percent. */
  contributionPct: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const nonNeg = (n: unknown): number => (finite(n) && n > 0 ? n : 0);

// ---------------------------------------------------------------- fund costs

/** Dollars of yearly cost per $1,000 invested, the format the disclosure notice uses. */
export function costPer1000(expenseRatioPct: number): number {
  return expenseRatioPct * 10;
}

export interface BlendedCost {
  /** Balance-weighted expense ratio over the funds whose cost is known, in percent. */
  blendedPct: number | null;
  /** Yearly dollar cost of the funds whose cost is known. */
  annualDollars: number;
  /** Share of the user's balance whose cost is known (0..100). A low value means the blended figure is incomplete. */
  coveredPct: number;
  /** Names of funds with a balance but no cost entered. */
  missingCost: string[];
  totalBalance: number;
}

export function blendedExpenseRatio(funds: FundRow[], holdings: Holding[]): BlendedCost {
  const byId = new Map(funds.map((f) => [f.id, f]));
  let total = 0;
  let known = 0;
  let weighted = 0;
  const missing: string[] = [];
  for (const h of holdings) {
    const bal = nonNeg(h.balance);
    if (bal === 0) continue;
    total += bal;
    const f = byId.get(h.fundId);
    if (f && finite(f.expenseRatioPct) && f.expenseRatioPct >= 0) {
      known += bal;
      weighted += bal * f.expenseRatioPct;
    } else {
      missing.push(f ? f.name : "Unknown fund");
    }
  }
  return {
    blendedPct: known > 0 ? weighted / known : null,
    annualDollars: weighted / 100,
    coveredPct: total > 0 ? (known / total) * 100 : 0,
    missingCost: missing,
    totalBalance: total,
  };
}

// ----------------------------------------------------------------- fee drag

export interface ProjectionInput {
  balance: number;
  years: number;
  /** Assumed average yearly return before fees, in percent. The user's own assumption. */
  returnPct: number;
  /** Yearly fund cost, in percent. */
  feePct: number;
  /** New money added at the end of each year. Zero reproduces the DOL's worked example. */
  annualContribution?: number;
}

/** Balance after `years`, growing at (return - fee) with year-end contributions. */
export function projectBalance(input: ProjectionInput): number {
  const years = Math.max(0, finite(input.years) ? input.years : 0);
  const g = ((finite(input.returnPct) ? input.returnPct : 0) - (finite(input.feePct) ? input.feePct : 0)) / 100;
  const bal = nonNeg(input.balance);
  const c = nonNeg(input.annualContribution ?? 0);
  const growth = Math.pow(1 + g, years);
  const contributions = Math.abs(g) < 1e-12 ? c * years : (c * (growth - 1)) / g;
  return bal * growth + contributions;
}

export interface FeeDragResult {
  a: number;
  b: number;
  /** How much lower B ends than A, as a percent of A. Negative if B ends higher. */
  differencePct: number;
  differenceDollars: number;
}

export function feeDrag(base: Omit<ProjectionInput, "feePct">, feeAPct: number, feeBPct: number): FeeDragResult {
  const a = projectBalance({ ...base, feePct: feeAPct });
  const b = projectBalance({ ...base, feePct: feeBPct });
  return { a, b, differencePct: a > 0 ? (1 - b / a) * 100 : 0, differenceDollars: a - b };
}

/** Year-by-year balances for a chart, from year 0 through `years`. */
export function projectionSeries(input: ProjectionInput): number[] {
  const n = Math.max(0, Math.floor(finite(input.years) ? input.years : 0));
  const out: number[] = [];
  for (let y = 0; y <= n; y++) out.push(projectBalance({ ...input, years: y }));
  return out;
}

// ------------------------------------------------------------- employer match

/**
 * One slice of a match formula. `upToPct` is the cumulative share of pay the
 * slice runs to. "100% of the first 3%, then 50% of the next 2%" is
 * [{ upToPct: 3, ratePct: 100 }, { upToPct: 5, ratePct: 50 }].
 * "50 cents on the dollar up to 6%" is [{ upToPct: 6, ratePct: 50 }].
 */
export interface MatchTier {
  upToPct: number;
  ratePct: number;
}

export interface MatchResult {
  /** Employer match earned per year at the user's current saving rate. */
  capturedDollars: number;
  /** Most the formula can pay per year. */
  maxDollars: number;
  /** Match not being collected at the current saving rate. */
  leftOnTableDollars: number;
  /** Saving rate (percent of pay) that collects the whole match. */
  fullMatchSavingPct: number;
}

function cleanTiers(tiers: MatchTier[]): MatchTier[] {
  return tiers
    .filter((t) => finite(t.upToPct) && t.upToPct > 0 && finite(t.ratePct) && t.ratePct > 0)
    .sort((x, y) => x.upToPct - y.upToPct);
}

export function matchDollarsAt(salary: number, savingPct: number, tiers: MatchTier[]): number {
  const pay = nonNeg(salary);
  const save = nonNeg(savingPct);
  let prev = 0;
  let total = 0;
  for (const t of cleanTiers(tiers)) {
    const slice = Math.max(0, Math.min(save, t.upToPct) - prev);
    total += slice * (t.ratePct / 100);
    prev = t.upToPct;
  }
  return (total / 100) * pay;
}

export function matchCapture(salary: number, savingPct: number, tiers: MatchTier[]): MatchResult {
  const t = cleanTiers(tiers);
  const cap = t.length ? t[t.length - 1].upToPct : 0;
  const captured = matchDollarsAt(salary, savingPct, t);
  const max = matchDollarsAt(salary, cap, t);
  return {
    capturedDollars: captured,
    maxDollars: max,
    leftOnTableDollars: Math.max(0, max - captured),
    fullMatchSavingPct: cap,
  };
}

// -------------------------------------------------------------------- vesting

export type VestingSchedule =
  | { kind: "immediate" }
  | { kind: "cliff"; years: number }
  /** Percent owned once the user has at least `years` of service; the last step that applies wins. */
  | { kind: "steps"; steps: { years: number; pct: number }[] };

/** The slowest graded schedule the law allows for match money: 20% at 2 years up to 100% at 6. */
export const GRADED_2_TO_6: VestingSchedule = {
  kind: "steps",
  steps: [
    { years: 2, pct: 20 },
    { years: 3, pct: 40 },
    { years: 4, pct: 60 },
    { years: 5, pct: 80 },
    { years: 6, pct: 100 },
  ],
};

export function vestedPct(schedule: VestingSchedule, yearsOfService: number): number {
  const y = nonNeg(yearsOfService);
  if (schedule.kind === "immediate") return 100;
  if (schedule.kind === "cliff") return y >= schedule.years ? 100 : 0;
  let pct = 0;
  for (const s of [...schedule.steps].sort((a, b) => a.years - b.years)) {
    if (y >= s.years) pct = Math.max(pct, Math.min(100, Math.max(0, s.pct)));
  }
  return pct;
}

export interface VestingResult {
  vestedPct: number;
  /** Employer money in the account that the user would give up by leaving today. */
  forfeitIfLeaveToday: number;
  /** Years of service until the next step up, or null if fully vested. */
  yearsToNextStep: number | null;
  nextStepPct: number | null;
}

export function vestingStatus(schedule: VestingSchedule, yearsOfService: number, employerMoneyInAccount: number): VestingResult {
  const v = vestedPct(schedule, yearsOfService);
  const money = nonNeg(employerMoneyInAccount);
  let next: { years: number; pct: number } | null = null;
  if (v < 100) {
    if (schedule.kind === "cliff") next = { years: schedule.years, pct: 100 };
    else if (schedule.kind === "steps") {
      const y = nonNeg(yearsOfService);
      next = [...schedule.steps].sort((a, b) => a.years - b.years).find((s) => s.years > y && s.pct > v) ?? null;
    }
  }
  return {
    vestedPct: v,
    forfeitIfLeaveToday: money * (1 - v / 100),
    yearsToNextStep: next ? Math.max(0, next.years - nonNeg(yearsOfService)) : null,
    nextStepPct: next ? next.pct : null,
  };
}

// ------------------------------------------------------------ fund type hints

export const FUND_TYPE_LABEL: Record<FundType, string> = {
  target_date_index: "Target-date fund (index)",
  target_date_active: "Target-date fund (actively managed)",
  target_risk_blended: "Blended / target-risk fund",
  index_fund: "Index fund",
  active_fund: "Actively managed fund",
  stable_value_fixed: "Stable value / fixed return",
  money_market: "Money market",
  company_stock: "Company stock",
  brokerage_window: "Brokerage window",
  other: "Other / not sure",
};

/** Plain-language meaning for each fund type. Wording makes no cost or return claims beyond the disclosed numbers. */
export const FUND_TYPE_PLAIN: Record<FundType, string> = {
  target_date_index: "Built around the year you plan to retire. It shifts from stocks toward safer investments as that year gets closer. This version follows a fixed market list instead of a manager picking.",
  target_date_active: "Built around the year you plan to retire. It shifts from stocks toward safer investments as that year gets closer. This version has managers making choices, so it can cost a different amount than the index version.",
  target_risk_blended: "A mix of stocks and bonds kept at a set level of risk, with no retirement year attached.",
  index_fund: "Follows a market list, such as the 500 largest U.S. companies, instead of a manager picking.",
  active_fund: "A manager chooses what to buy and sell, which is usually what a higher yearly cost pays for.",
  stable_value_fixed: "Aims to protect the amount you put in and pays a set or slowly changing rate.",
  money_market: "Very short-term, very safe investments. Meant for holding cash, not growing it.",
  company_stock: "Shares of your own employer. If the company struggles, your job and this money are hit together.",
  brokerage_window: "A link to a regular brokerage account inside your plan, with thousands of funds and stocks to choose from.",
  other: "Pick the closest type, or leave this and read the fund's page in your plan website.",
};

export const FUND_VEHICLE_LABEL: Record<FundVehicle, string> = {
  mutual_fund: "Mutual fund",
  collective_trust: "Collective trust or pool",
  other_pool: "Other pooled fund",
  unknown: "Not sure",
};

export interface TypeSuggestion {
  type: FundType;
  targetYear: number | null;
  /** "name" means guessed from the fund's name only. The user must check it. */
  basis: "name" | "none";
}

const TDF_YEAR = /\b(20[0-7]\d)\b/;

/**
 * Best guess at a fund's type from its name, tuned to how Fidelity names its
 * funds ("Freedom" = target-date; "Freedom Index" = the index version). It is a
 * suggestion, never a conclusion: names like "Contrafund" say nothing about
 * how a fund is managed, so those return "other".
 */
export function suggestFundType(name: string): TypeSuggestion {
  const n = (name || "").trim();
  const yearMatch = n.match(TDF_YEAR);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (/freedom\s*(?:®)?\s*index/i.test(n)) return { type: "target_date_index", targetYear: year, basis: "name" };
  if (/(freedom|target[-\s]?date|lifepath|lifecycle|retirement\s+(?:fund|date))/i.test(n) && year)
    return { type: "target_date_active", targetYear: year, basis: "name" };
  if (/(freedom).*income|target[-\s]?date.*income/i.test(n)) return { type: "target_date_active", targetYear: null, basis: "name" };
  if (/money\s*market|government\s*cash|cash\s*reserves/i.test(n)) return { type: "money_market", targetYear: null, basis: "name" };
  if (/stable\s*value|managed\s*income|fixed\s*(?:income\s*)?(?:option|account)|guaranteed/i.test(n))
    return { type: "stable_value_fixed", targetYear: null, basis: "name" };
  if (/brokeragelink|brokerage\s*(?:window|account)/i.test(n)) return { type: "brokerage_window", targetYear: null, basis: "name" };
  if (/company\s*stock|employer\s*stock/i.test(n)) return { type: "company_stock", targetYear: null, basis: "name" };
  if (/\bindex\b/i.test(n)) return { type: "index_fund", targetYear: null, basis: "name" };
  if (/(balanced|asset\s*manager|moderate|conservative|aggressive)\s*(?:fund|allocation|growth)?/i.test(n) && !/index/i.test(n))
    return { type: "target_risk_blended", targetYear: null, basis: "name" };
  return { type: "other", targetYear: null, basis: "none" };
}

// ------------------------------------------------- target-date comparison

export interface TargetDateGroup {
  targetYear: number;
  funds: { id: string; name: string; type: FundType; expenseRatioPct: number | null }[];
  /** Cost range across funds in this group that have a known cost. Null if fewer than two have one. */
  spread: { lowPct: number; highPct: number; differencePct: number; differencePer1000: number; ratio: number | null } | null;
}

/**
 * Groups target-date funds by retirement year and, where several funds share a
 * year, shows how far their disclosed costs differ. It is a cost comparison of
 * what the plan lists, not a ranking and not a suggestion to pick any one.
 */
export function targetDateGroups(funds: FundRow[]): TargetDateGroup[] {
  const groups = new Map<number, TargetDateGroup>();
  for (const f of funds) {
    if ((f.type !== "target_date_index" && f.type !== "target_date_active") || !finite(f.targetYear)) continue;
    const g = groups.get(f.targetYear) ?? { targetYear: f.targetYear, funds: [], spread: null };
    g.funds.push({ id: f.id, name: f.name, type: f.type, expenseRatioPct: f.expenseRatioPct });
    groups.set(f.targetYear, g);
  }
  const out: TargetDateGroup[] = [];
  for (const g of groups.values()) {
    const costs = g.funds.map((f) => f.expenseRatioPct).filter((c): c is number => finite(c) && c >= 0);
    if (g.funds.length >= 2 && costs.length >= 2) {
      const lo = Math.min(...costs);
      const hi = Math.max(...costs);
      g.spread = { lowPct: lo, highPct: hi, differencePct: hi - lo, differencePer1000: costPer1000(hi - lo), ratio: lo > 0 ? hi / lo : null };
    }
    out.push(g);
  }
  return out.sort((a, b) => a.targetYear - b.targetYear);
}
