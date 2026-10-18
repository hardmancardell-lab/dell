import { factorPlanFor, normalizeSymbol } from "./factors";
import { FILING_TYPES, filingsToEvents, shareWithAcceptanceTime, type RawFiling } from "./filing-events";
import { runEventStudy, type StudySeries } from "./event-study";
import { MACRO_KINDS, runMacroStudy, type MacroStudyResult } from "./macro-study";
import { logVolumeRatio, scoreRolling } from "./market-model";
import { alignReturns } from "./returns";
import { decomposeVariance, type DecompositionResult } from "./variance-decomposition";
import { businessVerdict, macroVerdict, systematicVerdict, type BusinessVerdict } from "./verdict";
import type { DatedEvent, EventStudyResult, FactorPlan, ImpactAssetClass, PriceBar } from "./types";

/**
 * The whole News Impact analysis from already-loaded data. Pure: the server module loads bars, filings and macro dates
 * and hands them here; tests and the offline validation run call this with their own data.
 */

export interface MacroDates {
  fomc: string[] | null;
  cpi: string[] | null;
  jobs: string[] | null;
}

export interface AnalyzeInput {
  symbol: string;
  assetClass: ImpactAssetClass;
  /** ISO time the analysis is stamped with. */
  asOf: string;
  assetBars: PriceBar[];
  /** Bars by factor symbol; a factor that is missing here is dropped and named in the notes. */
  factorBars: Record<string, PriceBar[]>;
  /** SEC filings; null when they could not be loaded. */
  filings: RawFiling[] | null;
  /** Macro release dates by kind; null for a kind that could not be loaded. */
  macroDates: MacroDates;
  /** Notes from the loader (a provider that failed, a window that was shortened). */
  loadNotes?: string[];
}

export interface NewsImpactResult {
  symbol: string;
  assetClass: ImpactAssetClass;
  asOf: string;
  /** Last price date used. */
  dataThrough: string | null;
  sample: { from: string | null; to: string | null; returns: number };
  plan: { factors: { symbol: string; label: string; short: string; loaded: boolean }[]; ownLabel: string; notes: string[] };
  business: { study: EventStudyResult | null; verdict: BusinessVerdict; filingsFound: number; acceptanceTimeShare: number | null };
  systematic: { decomposition: DecompositionResult | null; text: string; stability: string | null };
  macro: { study: MacroStudyResult | null; kind: string; text: string; missingKinds: string[] };
  notes: string[];
}

const MIN_BARS = 150;

export function analyzeNewsImpact(input: AnalyzeInput): NewsImpactResult {
  const symbol = normalizeSymbol(input.symbol);
  const plan: FactorPlan = factorPlanFor(symbol, input.assetClass);
  const notes: string[] = [...(input.loadNotes ?? [])];

  const loaded = plan.factors.filter((f) => (input.factorBars[f.symbol]?.length ?? 0) >= MIN_BARS);
  for (const f of plan.factors) if (!loaded.includes(f)) notes.push(`${f.symbol} (${f.label}) could not be loaded, so it is left out of the comparison.`);
  const planOut = {
    factors: plan.factors.map((f) => ({ symbol: f.symbol, label: f.label, short: f.short, loaded: loaded.includes(f) })),
    ownLabel: plan.ownLabel,
    notes: plan.notes,
  };

  const aligned = alignReturns(input.assetBars, loaded.map((f) => input.factorBars[f.symbol]));
  const n = aligned.ret.length;
  const sample = { from: n > 0 ? aligned.dates[0] : null, to: n > 0 ? aligned.dates[n - 1] : null, returns: n };
  const empty = (reason: string): NewsImpactResult => ({
    symbol,
    assetClass: input.assetClass,
    asOf: input.asOf,
    dataThrough: sample.to,
    sample,
    plan: planOut,
    business: { study: null, verdict: { kind: "unavailable", text: reason }, filingsFound: 0, acceptanceTimeShare: null },
    systematic: { decomposition: null, text: reason, stability: null },
    macro: { study: null, kind: "unavailable", text: reason, missingKinds: [] },
    notes: [...notes, reason],
  });
  if (n < MIN_BARS - 1) return empty(`Only ${n} days of price history were available, and the study needs about ${MIN_BARS}.`);

  // ---- A. business (company events)
  let study: EventStudyResult | null = null;
  let businessReason: string | null = null;
  let filingsFound = 0;
  let acceptanceShare: number | null = null;
  if (!plan.hasOwnEvents) {
    businessReason =
      input.assetClass === "equity"
        ? "This is a fund, not one company, so there are no company filings to test. See the market-wide and macro-day results below."
        : `No dated company-type events exist for ${input.assetClass} in this app, so this test does not run. A daily headline log can fill that gap once it has run for a few months.`;
  } else if (input.filings === null) {
    businessReason = "SEC filings could not be loaded right now, so the company-event test did not run. Try again later.";
  } else if (loaded.length === 0) {
    businessReason = "The market benchmark could not be loaded, so the company-event test did not run.";
  } else {
    const events: DatedEvent[] = filingsToEvents(input.filings);
    filingsFound = events.length;
    acceptanceShare = shareWithAcceptanceTime(input.filings);
    if (acceptanceShare !== null && acceptanceShare < 0.9) notes.push(`${Math.round((1 - acceptanceShare) * 100)}% of filings had no exact time, so they are placed on their filing date.`);
    const roll = scoreRolling(aligned.ret, aligned.factorRet[0]);
    const series: StudySeries = { dates: aligned.dates, ar: roll.ar, sd: roll.sd, sar: roll.sar, volLog: logVolumeRatio(aligned.volume) };
    study = runEventStudy(series, events, FILING_TYPES);
  }
  const business = { study, verdict: businessVerdict(symbol, study, businessReason), filingsFound, acceptanceTimeShare: acceptanceShare };

  // ---- B1. systematic (variance split)
  let decomposition: DecompositionResult | null = null;
  let sysReason: string | null = null;
  if (loaded.length === 0) sysReason = `${symbol} is its own benchmark, or no benchmark could be loaded, so it has no market-wide split to show.`;
  else decomposition = decomposeVariance(aligned.dates, aligned.ret, aligned.factorRet, loaded);
  const sv = systematicVerdict(symbol, decomposition, plan.ownLabel, sysReason);

  // ---- B2. scheduled macro days
  const macroEvents: DatedEvent[] = [];
  const missingKinds: string[] = [];
  for (const k of MACRO_KINDS) {
    const dates = input.macroDates[k.id as keyof MacroDates];
    if (!dates || dates.length === 0) {
      missingKinds.push(k.label);
      continue;
    }
    for (const d of dates) macroEvents.push({ date: d, type: k.id, label: k.label });
  }
  let macroStudy: MacroStudyResult | null = null;
  if (macroEvents.length > 0) macroStudy = runMacroStudy(aligned.dates, aligned.ret, macroEvents, MACRO_KINDS.filter((k) => !missingKinds.includes(k.label)));
  if (missingKinds.length > 0 && macroStudy) notes.push(`Dates for ${missingKinds.join(", ")} could not be loaded, so those are not in the macro result.`);
  const mv = macroVerdict(symbol, macroStudy, "Macro release dates could not be loaded, so the macro-day test did not run.");

  return {
    symbol,
    assetClass: input.assetClass,
    asOf: input.asOf,
    dataThrough: sample.to,
    sample,
    plan: planOut,
    business,
    systematic: { decomposition, text: sv.text, stability: sv.stability },
    macro: { study: macroStudy, kind: mv.kind, text: mv.text, missingKinds },
    notes,
  };
}
