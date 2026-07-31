/**
 * Mirrors economic_outlook_schema.json / scorecard_log_template.json at the
 * project root exactly — those files are the source of truth for the shape;
 * these types are the TypeScript projection of them. Keep both in sync by
 * hand if either changes.
 */

export type RefreshReason = "scheduled_fomc_cycle" | "cpi_print" | "nfp_print" | "fomc_statement" | "ad_hoc_material_change";

export interface OutlookMeta {
  versionId: string;
  asOfDate: string;
  refreshReason: RefreshReason;
  priorVersionId: string | null;
  nextScheduledRefresh: string;
}

export type CyclePhase = "early_expansion" | "mid_expansion" | "late_expansion" | "slowdown" | "contraction" | "recovery";
export type FinancialConditionsStance = "tight" | "neutral" | "loose" | "mixed";

export interface RegimeTag {
  label: string;
  cyclePhase: CyclePhase;
  dualMandateBalance: string;
  financialConditionsStance: FinancialConditionsStance;
}

/** current_reading/source/date are always real, fetched at generation time — never carried forward stale. how_derived/role_in_outlook are the one Claude-authored piece per indicator, grounded strictly in the real reading given. */
export interface OutlookIndicator {
  indicator: string;
  currentReading: string;
  roleInOutlook: string;
  howDerived: string;
  source: string;
  lastChangedMeaningfully: string | null;
}

export interface DualMandateScorecard {
  labor: OutlookIndicator[];
  inflation: OutlookIndicator[];
}

export interface PolicyStance {
  currentTargetRange: string;
  houseViewPath: string;
  marketImpliedPath: string;
  gapAnalysis: string;
}

export interface RiskScenario {
  scenario: string;
  trigger: string;
  marketImplication: string;
}

export interface RiskBalance {
  upsideRisks: RiskScenario[];
  downsideRisks: RiskScenario[];
}

export interface SelfQaEntry {
  question: string;
  answer: string;
  falsificationTrigger: string;
}

export type VolRegime = "low_vol_grind" | "elevated_event_risk" | "high_vol_regime_break";

export interface EventVolCatalyst {
  date: string;
  event: string;
  expectedVolSensitivity: "low" | "medium" | "high";
}

export interface TradingParameters {
  volRegime: VolRegime;
  calendarEffectsPriority: string[];
  eventVolCatalysts: EventVolCatalyst[];
  meanReversionWindowConfidence: string;
}

export interface OutputLayers {
  glance: string;
  narrativeRef: string;
  triggerFeed: string[];
}

export interface EconomicOutlook {
  meta: OutlookMeta;
  regimeTag: RegimeTag;
  dualMandateScorecard: DualMandateScorecard;
  growthAndFinancialConditions: OutlookIndicator[];
  policyStance: PolicyStance;
  riskBalance: RiskBalance;
  selfQa: SelfQaEntry[];
  tradingParameters: TradingParameters;
  outputLayers: OutputLayers;
  scorecardLogRef: string;
  dataLimitations: string[];
}

// --- Scorecard log ---

export interface ScorecardGrading {
  gradedDate: string | null;
  didTriggersFire: boolean | null;
  actualFedAction: string | null;
  actualMarketReaction: string | null;
  wasRegimeTagCorrect: boolean | null;
  wasHouseViewPathCorrect: boolean | null;
  notesOnWhatBrokeOrHeld: string | null;
  lessonForNextVersion: string | null;
}

export interface ScorecardEntry {
  versionId: string;
  loggedDate: string;
  regimeTagAtCall: string;
  houseViewPathAtCall: string;
  keyFalsificationTriggers: string[];
  grading: ScorecardGrading;
}

// --- International central-bank rate-path registry (static reference content) ---

/**
 * Whether a central bank publishes its own forward policy-rate path, or something weaker.
 * EXPLICIT_OWN_PATH: the bank publishes its own multi-year rate forecast (rare — e.g. RBNZ, Norges Bank).
 * MARKET_CONDITIONED: GDP/inflation forecasts are conditioned on the market's own forward-rate curve,
 * not the bank's view — most G10 central banks. Pull the market-implied path yourself (OIS/futures)
 * rather than expecting the publication to hand you one.
 * OPAQUE_OR_POLITICAL: little/no formal forward guidance (e.g. PBoC) — descriptive, not predictive.
 */
export type RatePathTransparency = "EXPLICIT_OWN_PATH" | "MARKET_CONDITIONED" | "OPAQUE_OR_POLITICAL";

export interface CentralBankAccess {
  method: string;
  endpointOrSeriesId: string | null;
  url: string | null;
  authRequired: boolean;
  cost: string;
}

export interface CentralBankEntry {
  id: string;
  countryOrArea: string;
  institution: string;
  publication: string;
  forecasts: string[];
  horizon: string;
  cadence: string;
  ratePathTransparency: RatePathTransparency;
  methodology: string;
  access: CentralBankAccess;
  automationFeasibility: string;
  pipelineRole: string;
}
