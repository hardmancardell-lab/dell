/**
 * Shapes that the client research routes send and the client Research section reads. Type-only on purpose: the browser
 * bundle may import this file without pulling any server code in.
 *
 * Rules these shapes enforce (see team_audits/2026-10-18/client-research-audit.md):
 *  - no share counts, cost basis, cash or account value (the research is about the company, not the account);
 *  - no free-text upstream error (only fixed, short, plain messages);
 *  - every number that can be missing is `number | null`, never 0 and never made up.
 */

export type ClientPhaseNumber = 1 | 2 | 3 | 4 | 5;

/** Plain position of a multiple against the company's own past-year average. Never "attractive" or "buy". */
export type OwnAveragePosition = "well above" | "above" | "near" | "below" | "well below";

export interface ResearchHoldingRef {
  symbol: string;
  assetClass: string;
  assetClassLabel: string;
  /** True when the Research section can value this holding (a US-listed stock with SEC filings is tried). */
  researchable: boolean;
  /** Why not, in plain words, when researchable is false. */
  reason: string | null;
}

export interface ResearchIndex {
  holdings: ResearchHoldingRef[];
  /** The most holdings valued for one client. */
  cap: number;
  holdsCrypto: boolean;
  asOf: string;
}

export interface MeasureRow {
  label: string;
  current: number;
  average: number;
  premiumPct: number;
  position: OwnAveragePosition;
  /** Share of the past year the multiple was at or below today's level (0 to 100), or null. */
  percentile: number | null;
}

export interface HoldingValuationView {
  /** The question the phase's valuation asks, in the skill's words. */
  question: string;
  position: OwnAveragePosition | null;
  averagePremiumPct: number | null;
  window: string;
  measures: MeasureRow[];
  /** What growth the price needs, from the reverse DCF (numbers only, wording is built in the UI). */
  priceAssumes: { growthPctPerYear: number; years: number; currentCashFlowGrowthPct: number | null } | null;
  /** Other things to know (the skill's cross-checks), no verdict words. */
  otherThings: { title: string; detail: string }[];
  /** Assumptions behind the valuation numbers. */
  assumptions: string[];
}

export interface HoldingResearch {
  symbol: string;
  status: "ok" | "no_filings" | "unavailable" | "busy";
  /** A fixed plain sentence for any status other than ok. */
  message: string | null;
  company: string | null;
  phase: {
    number: ClientPhaseNumber;
    name: string;
    plain: string;
    confidence: "high" | "medium" | "low" | "unknown";
    note: string | null;
    alsoConsistentWith: string[];
  } | null;
  /** Period end of the filing the numbers come from. */
  filingsAsOf: string | null;
  valuation: HoldingValuationView | null;
  /** Honest reason when the valuation is empty. */
  valuationNote: string | null;
  price: { value: number; asOf: string | null; delayed: boolean | null; feed: string | null } | null;
  sources: string[];
  fetchedAt: string;
  /** True when this is the last good result, served because a fresh fetch failed. */
  stale: boolean;
  /** Estimate label shown on the card. */
  isEstimate: true;
}

export interface OutlookIndicatorView {
  indicator: string;
  currentReading: string;
  source: string;
  role: string;
}

export interface OutlookView {
  asOfDate: string;
  nextScheduledRefresh: string;
  regime: { label: string; cyclePhase: string; financialConditions: string; dualMandateBalance: string };
  glance: string;
  policy: { currentTargetRange: string; houseViewPath: string; marketImpliedPath: string };
  indicators: OutlookIndicatorView[];
  upsideRisks: { scenario: string; trigger: string; marketImplication: string }[];
  downsideRisks: { scenario: string; trigger: string; marketImplication: string }[];
  dataLimitations: string[];
}

export interface CatalystView {
  id: string;
  date: string;
  time: string | null;
  name: string;
  impact: "low" | "medium" | "high";
  daysAway: number;
  appliesTo: string[];
  note: string | null;
  basis: "official-schedule" | "rule";
  sourceUrl: string | null;
}

export interface CryptoRegimeView {
  asOf: string;
  label: string;
  labelPlain: string;
  met: number;
  total: number;
  unavailable: number;
  checks: { label: string; status: "met" | "not-met" | "unavailable"; reading: string; threshold: string }[];
  sources: { label: string; source: string; status: string; asOf: string | null }[];
  limitations: string[];
}

export interface ScorecardSummary {
  logged: number;
  graded: number;
  regimeRight: number;
  regimeWrong: number;
  pathRight: number;
  pathWrong: number;
}

export interface ResearchEnvironment {
  asOf: string;
  outlook: OutlookView | null;
  outlookNote: string | null;
  catalysts: { verifiedOn: string; events: CatalystView[]; notes: string[]; scope: string } | null;
  crypto: CryptoRegimeView | null;
  cryptoNote: string | null;
  scorecard: ScorecardSummary | null;
  scorecardNote: string | null;
  stale: boolean;
}

export interface MethodExplainer {
  steps: { title: string; body: string }[];
  phases: { number: ClientPhaseNumber; name: string; plain: string }[];
  positions: { label: OwnAveragePosition; rule: string }[];
  methods: { name: string; plain: string; assumes: string }[];
  words: { term: string; plain: string; fullDefinition: string | null }[];
  limits: string[];
  open: string[];
}
