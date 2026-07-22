export type CreditCondition = "tight" | "neutral" | "loose";
export type ValuationCondition = "cheap" | "fair" | "extended" | "speculative";
export type ProductionPhase = "trough" | "normal" | "overheated";
export type MarginPressure = "compressing" | "neutral" | "expanding";

export interface IndicatorValue {
  seriesId: string;
  label: string;
  date: string;
  value: number;
  unit: string;
}

export interface CreditSection {
  yieldCurveSpread: IndicatorValue; // 10Y-2Y, percentage points
  yieldCurveInverted: boolean;
  highYieldSpread: IndicatorValue; // ICE BofA HY OAS, percent
  creditCondition: CreditCondition;
}

export interface ValuationSection {
  buffettIndicator: {
    value: number; // Wilshire 5000 market cap / GDP, as a ratio
    marketCapDate: string;
    gdpDate: string;
  };
  cape: {
    value: number | null; // not sourced from FRED; manual/external input
    note: string;
  };
  valuationCondition: ValuationCondition;
}

export interface ProductionSection {
  industrialProduction: IndicatorValue;
  industrialProductionYoY: number | null;
  capacityUtilization: IndicatorValue;
  capacityUtilizationLongRunAvg: number;
  realDisposableIncome: IndicatorValue;
  realDisposableIncomeYoY: number | null;
  productionPhase: ProductionPhase;
}

export interface InflationSection {
  cpi: IndicatorValue;
  cpiYoY: number | null;
  ppi: IndicatorValue;
  ppiYoY: number | null;
  realGdpYoY: number | null;
  marginPressure: MarginPressure;
}

export interface MacroMarginMatrix {
  credit: CreditSection;
  valuation: ValuationSection;
  production: ProductionSection;
  inflation: InflationSection;
  stance: {
    label: string;
    rationale: string[];
  };
}

/** One Beige-Book-style category, built from this app's own already-fetched real matrix data. */
export interface BeigeBookSection {
  category: string;
  narrative: string;
}

/**
 * Styled like the FOMC's own Summary of Economic Projections table
 * (metric/current/prior/direction columns), but these are this app's own
 * CURRENT real FRED readings, never the Fed's forward-looking projections —
 * this app has no monetary-policy forecasting model and does not fabricate
 * one. See MacroBriefing.asOfNote for the explicit disclosure shown with it.
 */
export interface SepStyleRow {
  metric: string;
  currentValue: number | null;
  currentDate: string;
  yearAgoValue: number | null;
  yearAgoDate: string;
  direction: "up" | "down" | "flat" | "unknown";
}

export interface MacroBriefing {
  matrix: MacroMarginMatrix;
  nationalSummary: BeigeBookSection[];
  currentConditionsTable: SepStyleRow[];
  asOfNote: string;
}

export interface IndicatorSignal {
  indicatorId: string;
  label: string;
  latestValue: number;
  latestDate: string;
  unit: string;
  classification: "leading" | "coincident" | "lagging";
  trend: "rising" | "falling" | "flat";
  isFavorable: boolean | null; // null if trend is flat (no clear read)
}

export interface SectorRecommendation {
  industryId: string;
  industryName: string;
  analysis: string;
  signals: IndicatorSignal[];
  favorableCount: number;
  unfavorableCount: number;
  overallRead: "constructive" | "cautious" | "mixed";
  /**
   * How this sector's read connects back to the top-down MacroMarginMatrix —
   * a documented rule-based heuristic (which matrix conditions apply to this
   * sector's rate-sensitivity/cyclicality/margin-sensitivity profile and
   * why), not a statistical claim.
   */
  macroLinkage: {
    stanceLabel: string;
    affectedBy: string[]; // e.g. "credit: tight", "production: trough"
    rationale: string;
  };
  obstacles: string[];
  opportunities: string[];
  /**
   * Where to find deeper metrics for this industry, without auto-fetching
   * them here — FRED industry-group data and FMP sector fundamentals are
   * both real API calls (FMP specifically has a tight daily quota, see
   * sector-fundamentals.ts), so this only points at them rather than
   * pulling every sector's data on every page load.
   */
  relevantMetrics: {
    fredIndustryGroupLabel: string | null;
    fmpSectorName: string | null;
  };
}

export type SectorClassification =
  | "cyclical-bargain-candidate"
  | "normal"
  | "overheated";

export interface IndustryGroup {
  id: string;
  label: string;
  industrialProduction: IndicatorValue;
  industrialProductionYoY: number | null;
  capacityUtilization: IndicatorValue;
  capacityUtilizationLongRunAvg: number;
  classification: SectorClassification;
}

export interface UnavailableMetric {
  label: string;
  note: string;
}

export interface SectorSelectionMatrix {
  /**
   * Goods-producing industry groups with real FRED coverage (production +
   * capacity utilization). Services, financials, tech, healthcare, etc. are
   * not covered here — see `unavailable`.
   */
  industryGroups: IndustryGroup[];
  inventoryToSales: {
    totalBusiness: IndicatorValue;
    note: string;
  };
  /**
   * Metrics from the Graham sector framework that require a company
   * fundamentals/ratings data source we haven't wired up (FRED doesn't
   * publish these). Listed explicitly rather than faked.
   */
  unavailable: UnavailableMetric[];
  cyclicalBargainCandidates: string[]; // industry group ids
}

export interface SectorFundamentalsCompany {
  ticker: string;
  companyName: string;
  industry: string | null; // real FMP sub-industry classification, e.g. "Oil & Gas Midstream"
  marketCap: number;
  debtToEquity: number | null;
  interestCoverage: number | null;
  capexToDepreciation: number | null;
  operatingMarginByYear: number[]; // most recent first
}

// A lighter-weight company entry: real name + real sub-industry + market cap
// from FMP's /profile endpoint (broadly accessible on the free tier), but no
// financial ratios — those need /income-statement etc., which are gated by a
// hard allowlist (see SECTOR_CONSTITUENTS' comment in sector-fundamentals.ts).
// Exists so sub-industry breadth can be shown even for tickers/sectors where
// full statements aren't available, instead of showing nothing.
export interface SectorProfileOnlyCompany {
  ticker: string;
  companyName: string;
  industry: string | null;
  marketCap: number;
}

export interface SectorFundamentals {
  sector: string;
  companiesAnalyzed: SectorFundamentalsCompany[];
  broaderCoverage: SectorProfileOnlyCompany[];
  sampleNote: string;
  medians: {
    debtToEquity: number | null;
    interestCoverage: number | null;
    capexToDepreciation: number | null;
    operatingMarginStdDev: number | null; // median of each company's own std dev across available years
  };
  dataLimitations: string[];
}

export interface EarningPowerSection {
  yearsAvailable: number;
  yearsRequested: number;
  averageNetIncome: number;
  deficitYears: number;
  meetsStabilityThreshold: boolean; // zero deficit years across available history
  warning: string | null;
}

export interface NcavSection {
  currentAssets: number;
  totalLiabilities: number;
  preferredStock: number;
  ncav: number;
  sharesOutstanding: number;
  ncavPerShare: number;
  price: number;
  priceToNcav: number | null;
  isBargain: boolean; // price <= 2/3 of NCAV per share
}

export interface LiquiditySection {
  currentAssets: number;
  currentLiabilities: number;
  currentRatio: number;
  meetsGrahamThreshold: boolean; // >= 2.0
  cashAndEquivalents: number;
}

export interface SolvencySection {
  ebit: number;
  interestExpense: number;
  fixedChargeCoverage: number | null; // null if no interest expense (no debt)
  meetsGrahamThreshold: boolean; // >= 4x
  totalDebt: number;
  totalEquity: number;
  debtToEquity: number | null;
  topHeavy: boolean;
}

export type DividendGrowthTrend = "growing" | "stable" | "declining";

export interface DividendSection {
  consecutiveYearsPaid: number;
  yearsRequested: number;
  meetsGrahamThreshold: boolean;
  mostRecentPaymentDate: string | null;
  // Derived from the same dividendHistory.historical already fetched for
  // the consecutive-years streak — supplements the Graham pass/fail
  // criterion, doesn't change its threshold or logic.
  growthTrend: DividendGrowthTrend | null;
}

export interface ValuationSection2 {
  price: number;
  averageEpsRecentYears: number;
  yearsUsedForEps: number;
  peRatio: number | null;
  bookValuePerShare: number;
  pbRatio: number | null;
  grahamMultiplier: number | null;
  passesGrahamMultiplier: boolean;
}

export interface GrahamChecklistItem {
  criterion: string;
  passed: boolean;
  detail: string;
}

export interface SectorRatio {
  label: string;
  available: boolean;
  value: string | null; // pre-formatted display value, null if unavailable
  benchmark: string;
  passed: boolean | null; // null if not evaluable even when a value exists
  note: string | null; // reason it's unavailable, or extra context
}

export interface SectorSpecificPanel {
  subSector: string;
  classificationNote: string;
  ratios: SectorRatio[];
}

export interface FinancialStatementYear {
  fiscalYear: string;
  date: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  eps: number;
  totalCurrentAssets: number;
  totalCurrentLiabilities: number;
  totalLiabilities: number;
  totalStockholdersEquity: number;
  totalDebt: number;
  cashAndCashEquivalents: number;
  operatingCashFlow: number;
  capitalExpenditure: number;
  freeCashFlow: number;
}

export type ValuationVerdict = "undervalued" | "overvalued" | "fairly valued" | "not applicable";

export interface ValuationResult {
  method: string;
  available: boolean;
  impliedValuePerShare: number | null;
  currentMarketPrice: number;
  percentDifference: number | null; // (implied - market) / market * 100; positive = undervalued
  verdict: ValuationVerdict;
  assumptions: string;
  note: string | null;
}

export interface PeerRatioRank {
  ratioLabel: string;
  unit: string;
  higherIsBetter: boolean;
  targetValue: number | null;
  peerValues: { ticker: string; value: number | null }[];
  rank: number | null; // 1 = best among available values
  totalRanked: number;
  percentile: number | null; // 0-100, higher = better rank
}

export interface SectorPeerRanking {
  ticker: string;
  sectorLabel: string; // FMP's own sector/industry taxonomy — explicitly not NAICS
  classificationNote: string;
  peerTickers: string[];
  rankings: PeerRatioRank[];
  dataLimitations: string[];
}

export interface SecurityAnalysis {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  earningPower: EarningPowerSection;
  ncav: NcavSection;
  liquidity: LiquiditySection;
  solvency: SolvencySection;
  dividends: DividendSection;
  valuation: ValuationSection2;
  checklist: GrahamChecklistItem[];
  sectorPanel: SectorSpecificPanel | null;
  financialStatements: FinancialStatementYear[];
  valuationMethods: ValuationResult[];
  dataLimitations: string[];
}

export interface ResearchWatchlistEntry {
  symbol: string;
}

// Research-Agent-owned equivalent of trading-agent's TraditionalCandidate*
// shapes — same composition pattern (getSectorRecommendations() ->
// SECTOR_CONSTITUENTS -> getSecurityAnalysis()), deliberately not imported
// from trading-agent/types.ts to avoid a cross-agent dependency.
export interface ScreenerCandidate {
  ticker: string;
  checklistPassCount: number;
  checklistTotal: number;
  alreadyWatchlisted: boolean;
  error: string | null;
}

export interface ScreenerCandidateGroup {
  industryId: string;
  industryName: string;
  overallRead: "constructive" | "cautious" | "mixed";
  fmpSectorName: string | null;
  candidates: ScreenerCandidate[];
  note: string | null;
}

export interface ScreenerResult {
  groups: ScreenerCandidateGroup[];
  dataLimitations: string[];
}

export interface WatchlistOverviewEntry {
  symbol: string;
  checklistPassCount: number | null;
  checklistTotal: number;
  isStrong: boolean; // >= 6 of 7 criteria passed
  error: string | null;
}

export interface WatchlistOverviewResult {
  entries: WatchlistOverviewEntry[];
  macroStanceLabel: string;
  macroStanceRationale: string[];
  dataLimitations: string[];
}

/**
 * A documented rule-based heuristic (production phase + credit condition
 * from the macro matrix), not an economic model — same honesty framing as
 * the sector-recommendations.ts macroLinkage classification.
 */
export type BusinessCycleTag = "early-cycle" | "expansion" | "late-cycle" | "contraction";

export interface SectorStockCandidate {
  ticker: string;
  companyName: string;
  checklistPassCount: number | null;
  checklistTotal: number;
  cycleTag: BusinessCycleTag;
  cycleRationale: string;
  ownTrendSupportsRead: boolean | null; // null if insufficient margin history to judge
  forecast: string | null; // AI-generated narrative synthesis, null unless forecast mode is on
  error: string | null;
}

export interface SectorStockAnalysisResult {
  sector: string;
  candidates: SectorStockCandidate[];
  sampleNote: string;
  forecastEnabled: boolean;
  dataLimitations: string[];
}
