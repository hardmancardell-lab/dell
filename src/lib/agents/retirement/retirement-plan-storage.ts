"use client";

import { useCallback, useSyncExternalStore } from "react";
import { GRADED_2_TO_6 } from "./retirement-math";
import type { FundRow, FundType, FundVehicle, AssetGroup, Holding, MatchTier, VestingSchedule } from "./retirement-math";

/**
 * Everything the user types about their 401(k) stays in this browser's
 * localStorage, the same pattern as portfolio-storage.ts. Nothing is sent to a
 * server and nothing is linked to an account: users enter their plan by hand.
 * Known limitation: per-browser, not synced across devices.
 */

const STORAGE_KEY = "retirement-plan-v1";
const CHANGED_EVENT = "retirement-plan-changed";
const MAX_FUNDS = 150;

export type VestingKind = "unknown" | "immediate" | "cliff" | "graded_2_6";

export interface RetirementPlanState {
  version: 1;
  provider: "fidelity" | "other";
  planName: string;
  /** Yearly pay before tax. */
  salary: number | null;
  /** Percent of pay the user saves from each paycheck. */
  savingPct: number | null;
  matchTiers: MatchTier[];
  vestingKind: VestingKind;
  cliffYears: number;
  yearsOfService: number | null;
  /** Employer-contributed money currently in the account. */
  employerMoney: number | null;
  /** Plan-level yearly fee charged to the account, if the notice lists one. */
  planAdminFeePerYear: number | null;
  funds: FundRow[];
  holdings: Holding[];
  assumptions: { years: number; returnPct: number; extraYearlySavings: number | null; compareFeePct: number | null };
}

export function emptyPlan(): RetirementPlanState {
  return {
    version: 1,
    provider: "fidelity",
    planName: "",
    salary: null,
    savingPct: null,
    matchTiers: [],
    vestingKind: "unknown",
    cliffYears: 3,
    yearsOfService: null,
    employerMoney: null,
    planAdminFeePerYear: null,
    funds: [],
    holdings: [],
    assumptions: { years: 30, returnPct: 6, extraYearlySavings: null, compareFeePct: null },
  };
}

export function vestingScheduleFor(plan: Pick<RetirementPlanState, "vestingKind" | "cliffYears">): VestingSchedule | null {
  if (plan.vestingKind === "immediate") return { kind: "immediate" };
  if (plan.vestingKind === "cliff") return { kind: "cliff", years: Math.max(1, plan.cliffYears) };
  if (plan.vestingKind === "graded_2_6") return GRADED_2_TO_6;
  return null;
}

// ------------------------------------------------------------- reading safely

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const FUND_TYPES: FundType[] = ["target_date_index", "target_date_active", "target_risk_blended", "index_fund", "active_fund", "stable_value_fixed", "money_market", "company_stock", "brokerage_window", "other"];
const VEHICLES: FundVehicle[] = ["mutual_fund", "collective_trust", "other_pool", "unknown"];
const GROUPS: AssetGroup[] = ["stocks", "blended", "bonds", "short_term", "fixed_return", "other"];

function cleanFund(raw: unknown): FundRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 60);
  if (!id) return null;
  return {
    id,
    name: str(r.name),
    assetGroup: GROUPS.includes(r.assetGroup as AssetGroup) ? (r.assetGroup as AssetGroup) : "other",
    type: FUND_TYPES.includes(r.type as FundType) ? (r.type as FundType) : "other",
    vehicle: VEHICLES.includes(r.vehicle as FundVehicle) ? (r.vehicle as FundVehicle) : "unknown",
    targetYear: num(r.targetYear),
    expenseRatioPct: num(r.expenseRatioPct),
  };
}

/** Rebuilds a plan from untrusted stored JSON, so a corrupt or old entry can never crash the page. */
export function sanitizePlan(raw: unknown): RetirementPlanState {
  const base = emptyPlan();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const funds = (Array.isArray(r.funds) ? r.funds : []).map(cleanFund).filter((f): f is FundRow => f !== null).slice(0, MAX_FUNDS);
  const ids = new Set(funds.map((f) => f.id));
  const holdings: Holding[] = (Array.isArray(r.holdings) ? r.holdings : [])
    .map((h): Holding | null => {
      if (!h || typeof h !== "object") return null;
      const x = h as Record<string, unknown>;
      const fundId = str(x.fundId, 60);
      return ids.has(fundId) ? { fundId, balance: Math.max(0, num(x.balance) ?? 0), contributionPct: Math.max(0, num(x.contributionPct) ?? 0) } : null;
    })
    .filter((h): h is Holding => h !== null);
  const tiers: MatchTier[] = (Array.isArray(r.matchTiers) ? r.matchTiers : [])
    .map((t): MatchTier | null => {
      if (!t || typeof t !== "object") return null;
      const x = t as Record<string, unknown>;
      const up = num(x.upToPct);
      const rate = num(x.ratePct);
      return up !== null && rate !== null && up > 0 && rate > 0 ? { upToPct: up, ratePct: rate } : null;
    })
    .filter((t): t is MatchTier => t !== null)
    .slice(0, 6);
  const a = (r.assumptions && typeof r.assumptions === "object" ? r.assumptions : {}) as Record<string, unknown>;
  return {
    ...base,
    provider: r.provider === "other" ? "other" : "fidelity",
    planName: str(r.planName, 120),
    salary: num(r.salary),
    savingPct: num(r.savingPct),
    matchTiers: tiers,
    vestingKind: (["unknown", "immediate", "cliff", "graded_2_6"] as VestingKind[]).includes(r.vestingKind as VestingKind) ? (r.vestingKind as VestingKind) : "unknown",
    cliffYears: Math.min(10, Math.max(1, num(r.cliffYears) ?? 3)),
    yearsOfService: num(r.yearsOfService),
    employerMoney: num(r.employerMoney),
    planAdminFeePerYear: num(r.planAdminFeePerYear),
    funds,
    holdings,
    assumptions: {
      years: Math.min(60, Math.max(1, num(a.years) ?? base.assumptions.years)),
      returnPct: Math.min(20, Math.max(-5, num(a.returnPct) ?? base.assumptions.returnPct)),
      extraYearlySavings: num(a.extraYearlySavings),
      compareFeePct: num(a.compareFeePct),
    },
  };
}

// useSyncExternalStore needs a snapshot with a stable identity until the stored
// text changes, so the parsed plan is cached against the raw string it came from.
const SERVER_PLAN = emptyPlan();
let cachedRaw: string | null | undefined;
let cachedPlan: RetirementPlanState = SERVER_PLAN;
// If storage is blocked, writes land here so the page still works for the visit.
let memoryRaw: string | null = null;
let useMemoryOnly = false;

function currentRaw(): string | null {
  if (useMemoryOnly) return memoryRaw;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    useMemoryOnly = true;
    return memoryRaw;
  }
}

function getSnapshot(): RetirementPlanState {
  const raw = currentRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedPlan = raw ? sanitizePlan(JSON.parse(raw)) : emptyPlan();
    } catch {
      cachedPlan = emptyPlan();
    }
  }
  return cachedPlan;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const subscribeNever = () => () => {};

function writeRaw(raw: string | null) {
  memoryRaw = raw;
  if (!useMemoryOnly) {
    try {
      if (raw === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      useMemoryOnly = true; // storage full or blocked: keep working in memory
    }
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useRetirementPlan() {
  const plan = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_PLAN);
  // false on the server and during hydration, true afterwards, so the page does
  // not flash an empty form before the saved plan loads.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  const update = useCallback((change: (current: RetirementPlanState) => RetirementPlanState) => {
    writeRaw(JSON.stringify(sanitizePlan(change(getSnapshot()))));
  }, []);

  const clearAll = useCallback(() => writeRaw(null), []);

  return { plan, hydrated, update, clearAll };
}
