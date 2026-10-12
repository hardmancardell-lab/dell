"use client";

import { useMemo, useState } from "react";
import { StatCard } from "./StatCard";
import { CostBars, FeeDragChart } from "./RetirementCharts";
import { useRetirementPlan, vestingScheduleFor } from "@/lib/agents/retirement/retirement-plan-storage";
import type { RetirementPlanState } from "@/lib/agents/retirement/retirement-plan-storage";
import { FIDELITY_EXAMPLE_ROWS, FIDELITY_EXAMPLE_SOURCE } from "@/lib/agents/retirement/fidelity-example-menu";
import {
  FUND_TYPE_LABEL,
  FUND_TYPE_PLAIN,
  FUND_VEHICLE_LABEL,
  blendedExpenseRatio,
  costPer1000,
  feeDrag,
  matchCapture,
  projectionSeries,
  suggestFundType,
  targetDateGroups,
  vestingStatus,
} from "@/lib/agents/retirement/retirement-math";
import type { FundRow, FundType, FundVehicle } from "@/lib/agents/retirement/retirement-math";

const fmtUsd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUsd2 = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
// Trailing zeros are only dropped after a decimal point, so 40 stays "40" and 0.50 becomes "0.5".
const fmtPct = (v: number, dp = 2) => {
  const s = v.toFixed(dp);
  return `${s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s}%`;
};
const parseNum = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

const FUND_TYPES = Object.keys(FUND_TYPE_LABEL) as FundType[];
const VEHICLES = Object.keys(FUND_VEHICLE_LABEL) as FundVehicle[];

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="jv-card flex flex-col gap-4">
      <div className="jv-br-b" />
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{title}</h2>
        {intro && <p className="text-sm mt-1" style={{ color: "var(--text-1)", maxWidth: "70ch" }}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Help({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="text-sm" style={{ color: "var(--text-1)" }}>
      <summary style={{ cursor: "pointer", color: "var(--signal)" }}>{summary}</summary>
      <div className="mt-2 flex flex-col gap-2" style={{ maxWidth: "70ch" }}>{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1" style={{ minWidth: 0 }}>
      <span className="jv-label" style={{ marginBottom: 0 }}>{label}</span>
      {children}
      {hint && <span className="text-xs" style={{ color: "var(--text-2)" }}>{hint}</span>}
    </label>
  );
}

function NumInput({ value, onChange, placeholder, step = "any", min }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; step?: string; min?: number }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      className="jv-input"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(parseNum(e.target.value))}
    />
  );
}

export function RetirementPlanTab() {
  const store = useRetirementPlan();
  return <RetirementPlanView {...store} />;
}

type PlanStore = ReturnType<typeof useRetirementPlan>;

/** The four match numbers as typed, which may be half-filled. Step 2 is optional. */
interface TierDraft {
  rate1: number | null;
  cap1: number | null;
  rate2: number | null;
  cap2: number | null;
}

/** The page itself, kept apart from storage so it can be rendered with any plan (tests, previews). */
export function RetirementPlanView({ plan, hydrated, update, clearAll }: PlanStore) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [tierDraft, setTierDraft] = useState<TierDraft | null>(null);

  const set = (patch: Partial<RetirementPlanState>) => update((p) => ({ ...p, ...patch }));
  const setAssume = (patch: Partial<RetirementPlanState["assumptions"]>) => update((p) => ({ ...p, assumptions: { ...p.assumptions, ...patch } }));

  function updateFund(id: string, patch: Partial<FundRow>) {
    update((p) => ({ ...p, funds: p.funds.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  }
  function addFund(row?: Partial<FundRow>) {
    update((p) => {
      const base: FundRow = { id: crypto.randomUUID(), name: "", assetGroup: "stocks", type: "other", vehicle: "mutual_fund", targetYear: null, expenseRatioPct: null, ...row };
      return { ...p, funds: [...p.funds, base] };
    });
  }
  function removeFund(id: string) {
    update((p) => ({ ...p, funds: p.funds.filter((f) => f.id !== id), holdings: p.holdings.filter((h) => h.fundId !== id) }));
  }
  function setHolding(fundId: string, patch: { balance?: number; contributionPct?: number }) {
    update((p) => {
      const existing = p.holdings.find((h) => h.fundId === fundId);
      const next = { fundId, balance: existing?.balance ?? 0, contributionPct: existing?.contributionPct ?? 0, ...patch };
      return { ...p, holdings: existing ? p.holdings.map((h) => (h.fundId === fundId ? next : h)) : [...p.holdings, next] };
    });
  }
  function loadExample() {
    update((p) => {
      const rows: FundRow[] = FIDELITY_EXAMPLE_ROWS.map((r) => {
        const s = suggestFundType(r.name);
        return { id: crypto.randomUUID(), name: r.name, assetGroup: r.assetGroup, type: s.type, vehicle: "mutual_fund", targetYear: s.targetYear, expenseRatioPct: r.expenseRatioPct };
      });
      return { ...p, funds: [...p.funds, ...rows] };
    });
  }

  const holdingFor = (id: string) => plan.holdings.find((h) => h.fundId === id);
  const blended = useMemo(() => blendedExpenseRatio(plan.funds, plan.holdings), [plan.funds, plan.holdings]);
  const groups = useMemo(() => targetDateGroups(plan.funds), [plan.funds]);
  const match = useMemo(
    () => (plan.salary && plan.savingPct !== null && plan.matchTiers.length ? matchCapture(plan.salary, plan.savingPct, plan.matchTiers) : null),
    [plan.salary, plan.savingPct, plan.matchTiers]
  );
  const schedule = vestingScheduleFor(plan);
  const vesting = useMemo(
    () => (schedule && plan.yearsOfService !== null ? vestingStatus(schedule, plan.yearsOfService, plan.employerMoney ?? 0) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.vestingKind, plan.cliffYears, plan.yearsOfService, plan.employerMoney]
  );

  const autoYearly = plan.salary && plan.savingPct !== null ? (plan.salary * plan.savingPct) / 100 + (match?.capturedDollars ?? 0) : 0;
  const yearlyAdded = plan.assumptions.extraYearlySavings ?? autoYearly;
  const feeA = blended.blendedPct;
  const feeB = plan.assumptions.compareFeePct ?? (feeA !== null ? feeA + 1 : null);
  const drag = useMemo(() => {
    if (feeA === null || feeB === null || blended.totalBalance <= 0) return null;
    const base = { balance: blended.totalBalance, years: plan.assumptions.years, returnPct: plan.assumptions.returnPct, annualContribution: yearlyAdded };
    return {
      result: feeDrag(base, feeA, feeB),
      a: projectionSeries({ ...base, feePct: feeA }),
      b: projectionSeries({ ...base, feePct: feeB }),
    };
  }, [feeA, feeB, blended.totalBalance, plan.assumptions.years, plan.assumptions.returnPct, yearlyAdded]);

  const costRows = plan.funds
    .filter((f) => f.expenseRatioPct !== null)
    .map((f) => ({ id: f.id, name: f.name, pct: f.expenseRatioPct as number, type: f.type }));
  const typesPresent = Array.from(new Set(plan.funds.map((f) => f.type)));
  // A match step is two numbers typed one at a time. Half-filled steps can't be saved (the plan only
  // keeps complete ones), so the numbers being typed live in a draft until both are there.
  // The draft only exists once the user edits; before that the saved plan is shown.
  const savedTiers: TierDraft = {
    rate1: plan.matchTiers[0]?.ratePct ?? null,
    cap1: plan.matchTiers[0]?.upToPct ?? null,
    rate2: plan.matchTiers[1]?.ratePct ?? null,
    cap2: plan.matchTiers[1]?.upToPct ?? null,
  };
  const tierShown = tierDraft ?? savedTiers;
  const editTier = (patch: Partial<TierDraft>) => {
    const next = { ...tierShown, ...patch };
    setTierDraft(next);
    const steps = [
      { upToPct: next.cap1, ratePct: next.rate1 },
      { upToPct: next.cap2, ratePct: next.rate2 },
    ];
    set({
      matchTiers: steps
        .filter((t): t is { upToPct: number; ratePct: number } => t.upToPct !== null && t.upToPct > 0 && t.ratePct !== null && t.ratePct > 0)
        .map((t) => ({ upToPct: t.upToPct, ratePct: t.ratePct })),
    });
  };

  if (!hydrated) return <div className="jarvis text-sm" style={{ color: "var(--text-2)" }}>Loading your saved plan…</div>;

  return (
    <div className="jarvis flex flex-col gap-8">
      <div>
        <div className="jv-eyebrow">401(k) Optimizer</div>
        <h1 className="jv-title">See what your 401(k) really costs and what you are leaving behind</h1>
        <p className="jv-lede" style={{ maxWidth: "68ch" }}>
          Type in your plan the way it is written in your plan papers. Nothing here is sent anywhere: it stays in this browser, and we never ask for your plan login. This is education, not investment advice.
        </p>
      </div>

      <Section title="1. Your plan" intro="Start with the basics. Skip anything you do not know yet. Each part you fill in unlocks a result below.">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="Plan company">
            <select className="jv-select" value={plan.provider} onChange={(e) => set({ provider: e.target.value === "other" ? "other" : "fidelity" })}>
              <option value="fidelity">Fidelity (NetBenefits)</option>
              <option value="other">Another company</option>
            </select>
          </Field>
          <Field label="Plan name (optional)" hint="For example: Acme Corp 401(k) Plan">
            <input className="jv-input" value={plan.planName} maxLength={120} onChange={(e) => set({ planName: e.target.value })} />
          </Field>
          <Field label="Your yearly pay, before tax ($)">
            <NumInput value={plan.salary} onChange={(v) => set({ salary: v })} placeholder="45000" min={0} />
          </Field>
          <Field label="Share of each paycheck you save (%)" hint="Your savings rate. Check a pay stub.">
            <NumInput value={plan.savingPct} onChange={(v) => set({ savingPct: v })} placeholder="3" min={0} />
          </Field>
          <Field label="Yearly plan fee charged to your account ($)" hint="Often called a recordkeeping fee. It is in the fee notice.">
            <NumInput value={plan.planAdminFeePerYear} onChange={(v) => set({ planAdminFeePerYear: v })} placeholder="20" min={0} />
          </Field>
        </div>
        {plan.provider === "other" && (
          <p className="text-xs" style={{ color: "var(--text-2)" }}>
            The form works for any plan. The Fidelity notice layout is the one we match first, so the example menu and the field order follow it.
          </p>
        )}
        <Help summary="Where do I find these papers?">
          <p>Your plan sends a yearly <b>Participant Disclosure Notice</b>. It lists every fund and what it costs. On Fidelity, log in to NetBenefits and look under plan information, or ask HR in writing for the notice.</p>
          <p>You also have a right to the <b>Summary Plan Description</b>. It explains the match, when the match becomes yours, and whether you can borrow from the plan.</p>
        </Help>
      </Section>

      <Section title="2. Your employer match" intro="The match is money your employer adds when you save. Collecting all of it is usually the first thing to check.">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="Your employer adds this many cents per $1 you save" hint="50 means 50 cents for each dollar.">
            <NumInput value={tierShown.rate1} onChange={(v) => editTier({ rate1: v })} placeholder="50" min={0} />
          </Field>
          <Field label="...until you have saved this share of your pay (%)" hint="For example 6 means the first 6% of pay.">
            <NumInput value={tierShown.cap1} onChange={(v) => editTier({ cap1: v })} placeholder="6" min={0} />
          </Field>
        </div>
        <Help summary="My plan has a second step (for example 100% on the first 3%, then 50% on the next 2%)">
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Field label="Second step: cents per $1 saved">
              <NumInput value={tierShown.rate2} onChange={(v) => editTier({ rate2: v })} min={0} />
            </Field>
            <Field label="...until total saving reaches (% of pay)" hint="Use the total, such as 5 for 'the next 2%' after a first step of 3.">
              <NumInput value={tierShown.cap2} onChange={(v) => editTier({ cap2: v })} min={0} />
            </Field>
          </div>
        </Help>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Field label="When does the match become yours?" hint="This is called vesting. Check the Summary Plan Description.">
            <select className="jv-select" value={plan.vestingKind} onChange={(e) => set({ vestingKind: e.target.value as RetirementPlanState["vestingKind"] })}>
              <option value="unknown">I do not know yet</option>
              <option value="immediate">Right away</option>
              <option value="cliff">All at once after some years</option>
              <option value="graded_2_6">A bit more each year (20% after year 2, 100% after year 6)</option>
            </select>
          </Field>
          {plan.vestingKind === "cliff" && (
            <Field label="Years until it is all yours">
              <NumInput value={plan.cliffYears} onChange={(v) => set({ cliffYears: v ?? 3 })} min={1} step="1" />
            </Field>
          )}
          <Field label="Years you have worked here">
            <NumInput value={plan.yearsOfService} onChange={(v) => set({ yearsOfService: v })} placeholder="2" min={0} />
          </Field>
          <Field label="Employer money in your account now ($)" hint="Match money only, not your own savings.">
            <NumInput value={plan.employerMoney} onChange={(v) => set({ employerMoney: v })} min={0} />
          </Field>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {match ? (
            <StatCard
              label="Match you collect each year"
              value={fmtUsd(match.capturedDollars)}
              sub={match.leftOnTableDollars > 0 ? `${fmtUsd(match.leftOnTableDollars)} a year not collected. Saving ${fmtPct(match.fullMatchSavingPct, 1)} of pay collects all ${fmtUsd(match.maxDollars)}.` : `That is the most this match pays (${fmtUsd(match.maxDollars)}).`}
              tone={match.leftOnTableDollars > 0 ? "down" : "up"}
            />
          ) : (
            <div className="text-sm" style={{ color: "var(--text-2)" }}>Fill in your pay, your savings rate and the match to see how much match you are collecting.</div>
          )}
          {vesting ? (
            <StatCard
              label="Match that is yours today"
              value={fmtPct(vesting.vestedPct, 0)}
              sub={
                vesting.forfeitIfLeaveToday > 0
                  ? `Leaving today would give up ${fmtUsd(vesting.forfeitIfLeaveToday)} of employer money.${vesting.yearsToNextStep !== null ? ` Next step up in ${vesting.yearsToNextStep.toFixed(1)} years, to ${fmtPct(vesting.nextStepPct ?? 100, 0)}.` : ""}`
                  : "Nothing is lost if you leave."
              }
              tone={vesting.forfeitIfLeaveToday > 0 ? "down" : "up"}
            />
          ) : (
            <div className="text-sm" style={{ color: "var(--text-2)" }}>Pick how your match becomes yours and enter your years of work to see how much is yours today.</div>
          )}
        </div>
      </Section>

      <Section
        title="3. Your fund menu and your money"
        intro="List the funds your plan offers, one per row, the way the notice lists them. Then enter how much you hold in each. The yearly cost is the 'expense ratio' column."
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" className="jv-btn" onClick={() => addFund()}>Add a fund</button>
          <button type="button" className="jv-btn-outline" onClick={loadExample}>Load an example menu from a real Fidelity notice</button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-2)", maxWidth: "70ch" }}>
          The example is {FIDELITY_EXAMPLE_SOURCE} Use it to try the page, then replace it with your own plan&apos;s funds.
        </p>

        {plan.funds.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>No funds yet. Add one, or load the example menu.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="jv-table" style={{ tableLayout: "fixed", width: 1160, minWidth: 1160 }}>
              <colgroup>
                <col style={{ width: 230 }} />
                <col style={{ width: 210 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="text-left">Fund name (as printed)</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Kind of fund</th>
                  <th className="text-right">Target year</th>
                  <th className="text-right">Yearly cost %</th>
                  <th className="text-right">Per $1,000</th>
                  <th className="text-right">My balance $</th>
                  <th className="text-right">My new savings %</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.funds.map((f) => {
                  const h = holdingFor(f.id);
                  const sug = suggestFundType(f.name);
                  const showSug = f.name.trim() !== "" && sug.type !== "other" && (sug.type !== f.type || sug.targetYear !== f.targetYear);
                  return (
                    <tr key={f.id}>
                      <td style={{ minWidth: 200 }}>
                        <input className="jv-input" value={f.name} maxLength={200} onChange={(e) => updateFund(f.id, { name: e.target.value })} aria-label="Fund name" />
                      </td>
                      <td style={{ minWidth: 190 }}>
                        <select className="jv-select" value={f.type} onChange={(e) => updateFund(f.id, { type: e.target.value as FundType })} aria-label="Fund type">
                          {FUND_TYPES.map((t) => <option key={t} value={t}>{FUND_TYPE_LABEL[t]}</option>)}
                        </select>
                        {showSug && (
                          <button type="button" className="text-xs" style={{ color: "var(--signal)", background: "none", border: 0, cursor: "pointer", textAlign: "left", padding: 0, marginTop: 2 }} onClick={() => updateFund(f.id, { type: sug.type, targetYear: sug.targetYear ?? f.targetYear })}>
                            Looks like: {FUND_TYPE_LABEL[sug.type]}{sug.targetYear ? ` ${sug.targetYear}` : ""} (from the name). Use it?
                          </button>
                        )}
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <select className="jv-select" value={f.vehicle} onChange={(e) => updateFund(f.id, { vehicle: e.target.value as FundVehicle })} aria-label="Kind of fund">
                          {VEHICLES.map((v) => <option key={v} value={v}>{FUND_VEHICLE_LABEL[v]}</option>)}
                        </select>
                      </td>
                      <td style={{ width: 90 }}>
                        <input type="number" className="jv-input text-right" value={f.targetYear ?? ""} placeholder="2040" onChange={(e) => updateFund(f.id, { targetYear: parseNum(e.target.value) })} aria-label="Target year" />
                      </td>
                      <td style={{ width: 100 }}>
                        <input type="number" step="any" min={0} className="jv-input text-right" value={f.expenseRatioPct ?? ""} placeholder="0.75" onChange={(e) => updateFund(f.id, { expenseRatioPct: parseNum(e.target.value) })} aria-label="Yearly cost percent" />
                      </td>
                      <td className="jv-num" style={{ color: "var(--text-2)" }}>{f.expenseRatioPct !== null ? `$${costPer1000(f.expenseRatioPct).toFixed(2)}` : "—"}</td>
                      <td style={{ width: 120 }}>
                        <input type="number" min={0} className="jv-input text-right" value={h?.balance || ""} placeholder="0" onChange={(e) => setHolding(f.id, { balance: Math.max(0, parseNum(e.target.value) ?? 0) })} aria-label="My balance" />
                      </td>
                      <td style={{ width: 100 }}>
                        <input type="number" min={0} className="jv-input text-right" value={h?.contributionPct || ""} placeholder="0" onChange={(e) => setHolding(f.id, { contributionPct: Math.max(0, parseNum(e.target.value) ?? 0) })} aria-label="My new savings percent" />
                      </td>
                      <td><button type="button" className="jv-btn-outline" onClick={() => removeFund(f.id)} aria-label={`Remove ${f.name || "fund"}`}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(() => {
          const total = plan.holdings.reduce((s, h) => s + h.contributionPct, 0);
          return total > 0 && Math.abs(total - 100) > 0.5 ? (
            <p className="text-xs" style={{ color: "var(--verdict)" }}>Your new-savings percentages add up to {fmtPct(total, 1)}. They normally add up to 100%.</p>
          ) : null;
        })()}
        <Help summary="What do these columns mean?">
          <p><b>Yearly cost (expense ratio):</b> what the fund takes out of your money each year to run itself. 0.50% costs $5 a year for every $1,000 you hold. The notice lists it as a percent and as dollars per $1,000. Use the gross figure it prints.</p>
          <p><b>Type:</b> what kind of fund it is. We guess from the name and show it so you can accept or change it. Names like &quot;Contrafund&quot; do not say how a fund is run, so check the fund&apos;s page.</p>
          <p><b>Kind of fund:</b> most plan funds are mutual funds. Some plans use &quot;collective trusts&quot; or &quot;pools,&quot; which are pooled funds sold only to retirement plans. Their cost can be worked out differently, and their holdings are not filed publicly the way a mutual fund&apos;s are. The notice says if a fund is not a mutual fund.</p>
        </Help>
      </Section>

      <Section title="4. What it costs you" intro="Your funds, weighted by how much you hold in each.">
        {blended.blendedPct === null ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>Enter a yearly cost for the funds you hold and a balance for each to see your total cost.</p>
        ) : (
          <>
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <StatCard label="Your blended yearly fund cost" value={fmtPct(blended.blendedPct, 3)} sub={`$${costPer1000(blended.blendedPct).toFixed(2)} per $1,000 a year`} />
              <StatCard label="Fund costs per year" value={fmtUsd2(blended.annualDollars)} sub={`on ${fmtUsd(blended.totalBalance)} held`} />
              {plan.planAdminFeePerYear ? <StatCard label="Plan fee per year" value={fmtUsd2(plan.planAdminFeePerYear)} sub="charged to your account" /> : null}
              {plan.planAdminFeePerYear ? <StatCard label="All fees per year" value={fmtUsd2(blended.annualDollars + plan.planAdminFeePerYear)} sub="fund costs plus plan fee" /> : null}
            </div>
            {blended.coveredPct < 99.5 && (
              <p className="text-xs" style={{ color: "var(--verdict)" }}>
                {fmtPct(blended.coveredPct, 0)} of your balance has a cost entered. The figure above leaves out: {blended.missingCost.join(", ")}.
              </p>
            )}
          </>
        )}
        {costRows.length > 0 && (
          <div>
            <div className="jv-label">Yearly cost of every fund in your plan</div>
            <CostBars rows={costRows} />
          </div>
        )}
      </Section>

      <Section title="5. Target-date funds and other funds" intro="Many plans put new savers into a target-date fund unless they choose something else. It helps to know what one is, and how the plan&apos;s other funds differ.">
        <Help summary="How to tell a target-date fund from the other funds">
          <p>A <b>target-date fund</b> has a year in its name, like 2040. You pick the year you expect to retire. The fund starts with more stocks and moves toward safer investments as that year gets closer, so one fund does the job of several.</p>
          <p>Two target-date funds with the <b>same year</b> can be built differently. An <b>index</b> version follows a fixed market list. An <b>actively managed</b> version has managers choosing investments. They can cost very different amounts, so compare the yearly cost column.</p>
          <p>In Vanguard&apos;s 2026 report, 89% of the plans it keeps records for named a default fund for people who did not choose, and 98% of those picked a target-date fund. That is Vanguard plans only, but it shows why many savers end up in one without choosing.</p>
        </Help>
        {groups.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>No target-date funds in your list yet. Set a fund&apos;s type to a target-date fund and give it a target year to see them side by side.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g.targetYear} className="p-3 rounded" style={{ background: "var(--ink-800)", border: "1px solid var(--line)" }}>
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>Funds for {g.targetYear}</div>
                <ul className="text-sm mt-1" style={{ color: "var(--text-1)", paddingLeft: 18 }}>
                  {g.funds.map((f) => (
                    <li key={f.id}>
                      {f.name || "Unnamed fund"}: {FUND_TYPE_LABEL[f.type]}, {f.expenseRatioPct !== null ? `${fmtPct(f.expenseRatioPct, 3)} a year ($${costPer1000(f.expenseRatioPct).toFixed(2)} per $1,000)` : "cost not entered"}
                    </li>
                  ))}
                </ul>
                {g.spread ? (
                  <p className="text-sm mt-2" style={{ color: "var(--text-1)" }}>
                    Your plan lists {g.funds.length} funds for {g.targetYear}. Their yearly costs differ by {fmtPct(g.spread.differencePct, 3)} of your balance each year (${g.spread.differencePer1000.toFixed(2)} per $1,000)
                    {g.spread.ratio ? `, so the higher one costs about ${g.spread.ratio.toFixed(1)} times the lower one` : ""}. This only compares what the notice lists. Read each fund&apos;s page to see how it is built before deciding anything.
                  </p>
                ) : (
                  <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>Only one fund for this year, or costs are missing, so there is nothing to compare yet.</p>
                )}
              </div>
            ))}
          </div>
        )}
        {typesPresent.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="jv-label">What the kinds of funds in your plan mean</div>
            {typesPresent.map((t) => (
              <div key={t} className="text-sm" style={{ color: "var(--text-1)", maxWidth: "75ch" }}>
                <b style={{ color: "var(--text-0)" }}>{FUND_TYPE_LABEL[t]}.</b> {FUND_TYPE_PLAIN[t]}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="6. What fees can do over time" intro="This shows how two yearly costs could change your balance. The return is your own assumption. It is not a prediction.">
        {drag === null ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>Enter costs and balances in step 3 to see this.</p>
        ) : (
          <>
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <Field label="Years until you need the money">
                <NumInput value={plan.assumptions.years} onChange={(v) => setAssume({ years: Math.min(60, Math.max(1, v ?? 30)) })} min={1} step="1" />
              </Field>
              <Field label="Yearly return you assume, before fees (%)" hint="Your own guess. Try a few.">
                <NumInput value={plan.assumptions.returnPct} onChange={(v) => setAssume({ returnPct: Math.min(20, Math.max(-5, v ?? 6)) })} />
              </Field>
              <Field label="Money you add each year ($)" hint={`Left blank, we use your savings plus the match you collect (${fmtUsd(autoYearly)}).`}>
                <NumInput value={plan.assumptions.extraYearlySavings} onChange={(v) => setAssume({ extraYearlySavings: v })} placeholder={String(Math.round(autoYearly))} min={0} />
              </Field>
              <Field label="Compare with a yearly cost of (%)" hint="Left blank, we compare with 1 point higher, like the Department of Labor's example.">
                <NumInput value={plan.assumptions.compareFeePct} onChange={(v) => setAssume({ compareFeePct: v })} placeholder={feeA !== null ? String(+(feeA + 1).toFixed(3)) : ""} min={0} />
              </Field>
            </div>
            <FeeDragChart a={drag.a} b={drag.b} labelA={`Your cost ${fmtPct(feeA ?? 0, 3)}`} labelB={`Compared ${fmtPct(feeB ?? 0, 3)}`} />
            <p className="text-sm" style={{ color: "var(--text-1)", maxWidth: "70ch" }}>
              With these assumptions, your balance could reach about {fmtUsd(drag.result.a)} after {plan.assumptions.years} years at a {fmtPct(feeA ?? 0, 3)} yearly cost, and about {fmtUsd(drag.result.b)} at {fmtPct(feeB ?? 0, 3)}. {drag.result.differenceDollars >= 0 ? "The higher cost ends" : "The lower cost ends"} {fmtUsd(Math.abs(drag.result.differenceDollars))} ({Math.abs(drag.result.differencePct).toFixed(0)}%) {drag.result.differenceDollars >= 0 ? "lower" : "higher"}. Real results will differ because markets move.
            </p>
            <Help summary="Where does this method come from?">
              <p>The U.S. Department of Labor uses the same arithmetic in its guide &quot;A Look at 401(k) Plan Fees&quot;: $25,000, 35 years, 7% a year, no new savings. At a 0.5% yearly fee it grows to $227,000. At 1.5% it grows to $163,000, which is 28% less.</p>
            </Help>
          </>
        )}
      </Section>

      <Section title="What these numbers are based on">
        <ul className="text-sm flex flex-col gap-1" style={{ color: "var(--text-1)", paddingLeft: 18, maxWidth: "75ch" }}>
          <li>Everything above uses only what you typed. Costs come from your plan&apos;s notice, balances and pay from you.</li>
          <li>Return and cost comparisons are your assumptions, not predictions. Past results do not guarantee future results.</li>
          {drag && <li>Assumptions in use: {fmtUsd(blended.totalBalance)} today, {plan.assumptions.years} years, {fmtPct(plan.assumptions.returnPct, 1)} yearly return before fees, {fmtUsd(yearlyAdded)} added each year, costs of {fmtPct(feeA ?? 0, 3)} and {fmtPct(feeB ?? 0, 3)}. Fund costs only; the plan fee is not included in the comparison.</li>}
          <li><b>Other investment options with similar risk and return may be available under your plan.</b> This page lists every fund you entered and picks none of them for you.</li>
          <li>This is educational information, not investment, tax or legal advice. Your plan&apos;s own documents control what you can do.</li>
        </ul>
        <div className="flex flex-wrap gap-2 items-center">
          {!confirmClear ? (
            <button type="button" className="jv-btn-outline" onClick={() => setConfirmClear(true)}>Delete all my plan data from this browser</button>
          ) : (
            <>
              <span className="text-sm" style={{ color: "var(--text-1)" }}>This clears everything on this page. It cannot be undone.</span>
              <button type="button" className="jv-btn" onClick={() => { clearAll(); setTierDraft(null); setConfirmClear(false); }}>Yes, delete it</button>
              <button type="button" className="jv-btn-outline" onClick={() => setConfirmClear(false)}>Keep it</button>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}
