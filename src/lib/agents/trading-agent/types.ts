import type { Greeks } from "./black-scholes";

export interface BlackScholesInputs {
  spotPrice: number;
  strikePrice: number;
  daysToExpiration: number;
  impliedVolatility: number; // as a percent, e.g. 30 for 30%
  riskFreeRate: number; // as a percent, e.g. 5 for 5%
}

export interface OptionSideResult {
  price: number;
  greeks: Greeks;
}

export interface OptionsCalculatorResult {
  inputs: BlackScholesInputs;
  timeToExpirationYears: number;
  call: OptionSideResult;
  put: OptionSideResult;
}

/** Live 3-month Treasury yield (FRED series DGS3MO) — the standard short-dated risk-free proxy for options pricing. */
export interface RiskFreeRateResult {
  ratePercent: number;
  asOfDate: string;
  seriesId: string;
}

export interface CorrelationFinderRow {
  symbol: string;
  correlation: number | null;
  sampleSize: number;
  error: string | null;
}

export interface CorrelationFinderResult {
  baseSymbol: string;
  lookbackDays: number;
  results: CorrelationFinderRow[]; // sorted most negative first
  dataLimitations: string[];
}

export interface UnavailableGap {
  label: string;
  note: string;
}

export interface PmVolumeSnapshot {
  ticker: string;
  asOfDateKey: string; // ET calendar date, e.g. "2026-07-11"
  todayPremarketVolume: number;
  rollingAverageVolume: number | null;
  lookbackDays: number;
  multiple: number | null;
  isAnomaly: boolean;
  anomalyThreshold: number;
}

export interface CheckpointStat {
  checkpoint: string; // machine-readable key, e.g. "first15min"
  label: string; // human-readable, e.g. "First 15 Minutes"
  sampleSize: number;
  probabilityUp: number | null; // 0-100 — this IS the win rate; WinLossMetrics' winRate field is dropped here to avoid duplicating it
  averageMovePct: number | null;
  medianMovePct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdownPct: number | null;
  largestWinPct: number | null;
  largestLossPct: number | null;
  note: string | null;
}

/**
 * Shared per-day context fields for trade log rows: overnight gap (prior
 * session close -> this session's open) plus the day's full regular-session
 * high/low and the clock time each occurred. dayHighTimeClock/dayLowTimeClock
 * are null when only daily bars are available (a daily bar carries no
 * intraday timestamp — getting the time would require a separate minute-bar
 * fetch per occurrence, not done for the two daily-bar-only engines).
 */
export interface DayContextFields {
  overnightGapPct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayHighTimeClock: string | null;
  dayLowTimeClock: string | null;
}

export interface HistoricalCompositeTradeLogRow extends DayContextFields {
  dateKey: string;
  checkpoint: string;
  returnPct: number;
  isWin: boolean;
}

export interface TimeOfDayFrequency {
  bucketLabel: string;
  count: number;
  pctOfTotal: number; // 0-100, of anomalyDaysFound
}

export interface NextDayFollowThrough {
  sampleSize: number;
  probabilityContinuation: number | null; // 0-100
  averageOvernightGainPct: number | null; // conditional on anomaly day closing up
  averageOvernightLossPct: number | null; // conditional on anomaly day closing down
}

/**
 * One row per historical anomaly day (not per checkpoint, unlike tradeLog)
 * — the raw material for the "click a HOD bucket, see every day that landed
 * in it" drill-down: the client groups these by highOfDayBucket, no extra
 * fetch needed since everything's already in this one payload.
 */
export interface DayRecord {
  dateKey: string;
  premarketVolume: number;
  sessionOpen: number | null;
  sessionClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayHighTimeClock: string | null;
  dayLowTimeClock: string | null;
  highOfDayBucket: string | null;
  lowOfDayBucket: string | null;
  highToLowPct: number | null; // (dayLow - dayHigh) / dayHigh * 100 — always <= 0
  highToClosePct: number | null; // (sessionClose - dayHigh) / dayHigh * 100
}

export interface HistoricalComposite {
  ticker: string;
  lookbackDays: number;
  tradingDaysScanned: number;
  anomalyDaysFound: number;
  checkpoints: CheckpointStat[];
  lowOfDayDistribution: TimeOfDayFrequency[];
  highOfDayDistribution: TimeOfDayFrequency[];
  highOfDayBefore1030Pct: number | null; // % of anomaly days whose HOD occurred before 10:30am ET
  dayRecords: DayRecord[];
  nextDayFollowThrough: NextDayFollowThrough;
  tradeLog: HistoricalCompositeTradeLogRow[];
  dataLimitations: string[];
}

export interface PmVolumeAnomalyReport {
  ticker: string;
  snapshot: PmVolumeSnapshot;
  composite: HistoricalComposite | null;
  notAvailable: UnavailableGap[];
  dataLimitations: string[];
}

export interface OptionsChainSummary {
  ticker: string;
  expirationDate: string | null;
  totalCallOpenInterest: number;
  totalPutOpenInterest: number;
  totalCallVolume: number;
  totalPutVolume: number;
  putCallVolumeRatio: number | null;
  putCallOpenInterestRatio: number | null;
  strikes: {
    strikePrice: number;
    callOpenInterest: number;
    callVolume: number;
    putOpenInterest: number;
    putVolume: number;
  }[];
  dataLimitations: string[];
}

export type AssetClass = "equity" | "bond" | "option" | "future" | "forex" | "commodity";

export interface WatchlistEntry {
  watchlistId: string;
  symbol: string;
  assetClass: AssetClass;
}

export interface WatchlistMeta {
  id: string;
  name: string;
}

export interface DailyBar {
  dateKey: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VolumeDisplacementSignal {
  triggered: boolean;
  todayVolume: number;
  rollingAverageVolume: number | null;
  multiple: number | null;
  threshold: number;
}

export interface MomentumSignal {
  triggered: boolean;
  closesGreen: boolean[]; // last 3 days, most recent last
  volumes: number[]; // last 3 days, most recent last
  volumeIncreasing: boolean;
  // Consecutive green days counting back from most recent (0-MOMENTUM_WINDOW_DAYS)
  // — a coarse proximity proxy for alerting, since (unlike Volume Displacement's
  // multiple or Mean Reversion's zScore) this signal has no natural continuous
  // "how close to triggering" value; volumeIncreasing is still a separate,
  // all-or-nothing condition this doesn't capture.
  daysGreenSoFar: number;
}

export interface MeanReversionSignal {
  triggered: boolean;
  direction: "oversold" | "overbought" | null;
  zScore: number | null;
  price: number;
  rollingMean: number | null;
  rollingStdDev: number | null;
  lookbackDays: number;
  threshold: number;
}

export interface ScanResult {
  symbol: string;
  assetClass: AssetClass;
  error: string | null;
  volumeDisplacement: VolumeDisplacementSignal | null;
  momentum: MomentumSignal | null;
  meanReversion: MeanReversionSignal | null;
}

export interface WatchlistScanSummary {
  results: ScanResult[];
  tickersScanned: number;
  tickersFlagged: number;
  dataLimitations: string[];
}

export interface GeopoliticalArticle {
  title: string;
  url: string;
  domain: string;
  date: string;
  sourceCountry: string | null;
}

export interface GeopoliticalVolumePoint {
  date: string;
  value: number; // % of monitored global coverage matching the query
}

export interface GeopoliticalNewsResult {
  query: string;
  pairLabel: string | null; // e.g. "EUR/USD" if this came from a seeded major pair
  mechanismNote: string | null; // why these keywords matter for this pair
  articles: GeopoliticalArticle[];
  coverageVolume: GeopoliticalVolumePoint[];
  dataLimitations: string[];
}

export interface CurrencyExpertAnalysisResult {
  pair: string;
  news: GeopoliticalNewsResult;
  usRateContext: {
    threeMonthYield: FredSeriesPoint | null;
    yieldCurveSpread: FredSeriesPoint | null;
  };
  expertRead: string | null; // AI-generated narrative synthesis, null if Anthropic isn't configured or generation failed
  dataLimitations: string[];
}

/**
 * "hard-fixed": a single announced rate with no official trading band (AED,
 * SAR, QAR, BHD, OMR, JOD, XOF, XAF). "band": an announced central rate plus
 * an official tolerance band the authority defends at the edges (HKD, DKK).
 */
export type PegType = "hard-fixed" | "band";

export interface CurrencyPeg {
  pair: string; // quoted as this app's other forex pairs are, e.g. "USD/HKD" (HKD per 1 USD)
  peggedCurrency: string;
  baseCurrency: string;
  pegType: PegType;
  targetRate: number; // central rate for "band" pegs, the fixed rate for "hard-fixed"
  bandLowerBound: number | null;
  bandUpperBound: number | null;
  regimeName: string;
  authority: string;
  since: string;
  note: string;
  // Whether OANDA's practice API actually serves real spot/daily-bar data for
  // this pair — confirmed by direct live testing, not assumed. Most hard
  // pegs to USD in the Gulf and CFA-zone are real, current, well-documented
  // pegs but are NOT tradable/quotable through this app's only forex data
  // source, so the peg fact is shown but the live strategy can't run.
  liveDataAvailable: boolean;
}

export type PegReversionDirection = "aboveTarget" | "belowTarget";

export interface PegDeviationSnapshot {
  pair: string;
  currentRate: number;
  asOfDate: string;
  targetRate: number;
  deviationPct: number;
  outsideBand: boolean | null; // null when the peg has no official band (hard-fixed)
}

export interface PegReversionTradeLogRow {
  dateKey: string;
  entryClose: number;
  deviationPctAtEntry: number;
  returnsByHorizon: { horizonDays: number; returnPct: number | null }[];
  isWin: boolean | null;
  daysToRevert: number | null;
  maxAdverseExcursionPct: number | null;
}

export interface PegReversionDirectionResult {
  signalOccurrences: number;
  horizons: BacktestHorizonResult[];
  reversionStats: ReversionStats | null;
  tradeLog: PegReversionTradeLogRow[];
}

export interface PegReversionResult {
  pair: string;
  peg: CurrencyPeg;
  lookbackYears: number;
  deviationThresholdPct: number;
  tradingDaysScanned: number;
  aboveTarget: PegReversionDirectionResult;
  belowTarget: PegReversionDirectionResult;
  dataLimitations: string[];
}

export interface SectorScanSummary {
  sector: string;
  results: PmVolumeSnapshot[];
  tickersScanned: number;
  tickersFlagged: number;
  failedTickers: string[];
  dataLimitations: string[];
}

export interface FredSeriesPoint {
  seriesId: string;
  label: string;
  date: string;
  value: number;
}

export interface BondMacroSnapshot {
  yieldCurveSpread: FredSeriesPoint;
  yieldCurveInverted: boolean;
  highYieldSpread: FredSeriesPoint;
  dataLimitations: string[];
}

export interface YieldCurvePoint {
  tenorLabel: string; // e.g. "3 Month", "2 Year", "10 Year"
  seriesId: string;
  date: string;
  value: number | null; // null if this tenor's series failed to fetch — not fatal to the whole curve
}

export interface YieldCurveInversion {
  fromTenor: string;
  toTenor: string;
}

export interface YieldCurveResult {
  points: YieldCurvePoint[];
  inversions: YieldCurveInversion[];
  creditSpreads: FredSeriesPoint[];
  dataLimitations: string[];
}

export interface FxCoverageSpikeSignal {
  pair: string;
  latestValue: number | null;
  averageValue: number | null;
  multiple: number | null;
  triggered: boolean;
  error: string | null;
}

export type GexRegimeLabel = "positive" | "negative";

export interface GexRegime {
  totalNetGex: number;
  gammaFlip: number | null;
  spot: number;
  regime: GexRegimeLabel;
  callWall: number;
  putWall: number;
}

export type TermStructureShape = "backwardation" | "contango";

export interface TermStructureSignal {
  ivNear: number;
  ivFar: number;
  spread: number;
  shape: TermStructureShape;
}

export interface FlowAtWalls {
  callWallFlowRatio: number | null;
  putWallFlowRatio: number | null;
}

export type QuadrantLabel = "bullish-stable" | "bullish-volatile" | "bearish-stable" | "bearish-volatile";

export interface GexSignalResult {
  underlying: string;
  asOfDateKey: string;
  nearExpiration: string;
  farExpiration: string | null;
  gexRegime: GexRegime;
  termStructure: TermStructureSignal | null;
  flowAtWalls: FlowAtWalls;
  quadrant: QuadrantLabel | null;
  dataLimitations: string[];
}

/**
 * Field names deliberately match options-signals-project/backtest_engine.py's
 * expected input schema (see that project's README) — this app's job is to
 * accumulate real rows in that exact shape, not re-run the statistics here.
 */
export interface PaperBacktestLogEntry {
  underlying: string;
  expirationDate: string; // YYYY-MM-DD
  signalLabel: QuadrantLabel;
  signalDate: string; // YYYY-MM-DD, when the signal was computed
  monRet: number | null;
  tueRet: number | null;
  wedRet: number | null;
  thuRet: number | null;
  friRet: number | null;
  weekRangePct: number | null;
  pinnedNearWall: boolean | null;
  // Diagnostic fields beyond backtest_engine.py's schema, kept for the app's
  // own display purposes.
  gammaFlip: number | null;
  callWall: number;
  putWall: number;
  totalNetGex: number;
}

export type EquityBacktestSignalType =
  | "volumeDisplacement"
  | "momentum"
  | "meanReversionOversold"
  | "meanReversionOverbought";

export interface BacktestHorizonResult {
  horizonDays: number;
  sampleSize: number;
  meanForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
  pValue: number | null;
  pValueFdrAdjusted: number | null;
  significantAfterFdr: boolean;
  bootstrapCiLower: number | null;
  bootstrapCiUpper: number | null;
  ciExcludesZero: boolean;
  trainMeanReturnPct: number | null;
  testMeanReturnPct: number | null;
  sameSignOutOfSample: boolean | null;
  passesAllThreeBars: boolean;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdownPct: number | null;
  largestWinPct: number | null;
  largestLossPct: number | null;
}

export interface EquityTradeLogRow extends DayContextFields {
  dateKey: string;
  entryClose: number;
  returnsByHorizon: { horizonDays: number; returnPct: number | null }[];
  isWin: boolean | null; // based on the longest horizon with a non-null return
  daysToRevert: number | null; // meanReversion signal types only — trading days until price closed back at/past the (evolving) rolling mean
  maxAdverseExcursionPct: number | null; // meanReversion signal types only — how much further price moved away from the rolling mean after the signal fired, before reverting
}

export interface DaysToRevertBucket {
  bucketLabel: string;
  count: number;
  pctOfOccurrences: number;
}

/**
 * Aggregate reversion-timing stats for meanReversionOversold/Overbought
 * backtests only — null for volumeDisplacement/momentum, where "distance
 * from the rolling mean" isn't the relevant reference.
 */
export interface ReversionStats {
  occurrencesTracked: number;
  occurrencesReverted: number;
  occurrencesNeverReverted: number; // still hadn't crossed back by maxTrackingDays, or ran out of available bars first
  maxTrackingDays: number;
  meanDaysToRevert: number | null;
  medianDaysToRevert: number | null;
  daysToRevertDistribution: DaysToRevertBucket[];
  avgMaxAdverseExcursionPct: number | null;
  worstMaxAdverseExcursionPct: number | null;
}

export interface EquityBacktestResult {
  ticker: string;
  signalType: EquityBacktestSignalType;
  lookbackYears: number;
  tradingDaysScanned: number;
  signalOccurrences: number;
  horizons: BacktestHorizonResult[];
  reversionStats: ReversionStats | null;
  tradeLog: EquityTradeLogRow[];
  dataLimitations: string[];
}

export interface ForexRateSnapshot {
  pair: string;
  price: number | null;
  error: string | null;
}

export interface ForexRatesSummary {
  rates: ForexRateSnapshot[];
  asOf: string; // ISO timestamp of when this snapshot was fetched
  dataLimitations: string[];
}

// Shared by commodity-rates.ts and futures-rates.ts — both are genuinely the
// same shape (symbol -> live price via Alpaca ETF proxies), unlike
// ForexRateSnapshot/ForexRatesSummary above which predates this and uses
// "pair" instead of "symbol" — left as-is rather than retrofitted.
export interface AssetRateSnapshot {
  symbol: string;
  price: number | null;
  error: string | null;
}

export interface AssetRatesSummary {
  rates: AssetRateSnapshot[];
  asOf: string;
  dataLimitations: string[];
}

export type StrategyCategory = "income" | "directional" | "volatility" | "hedging";

/**
 * A rule-based heuristic mapping observed conditions (GEX regime, term
 * structure, put/call skew) to strategy types commonly associated with them
 * — domain-expert judgment, not a backtested or statistically validated
 * recommendation. See strategy-scanner.ts.
 */
export interface StrategyRecommendation {
  strategyName: string;
  category: StrategyCategory;
  rationale: string;
}

export interface OptionsStrategyGuideEntry {
  name: string;
  whatItIs: string;
  whenToUse: string;
  oiVolumeNote: string;
}

export interface OptionsStrategyCategory {
  id: string;
  title: string;
  intro: string;
  strategies: OptionsStrategyGuideEntry[];
}

export interface PortfolioHolding {
  id: string; // crypto.randomUUID() — multiple lots of the same symbol are separate entries
  symbol: string;
  assetClass: AssetClass;
  shares: number;
  costBasisPerShare: number;
  acquiredDate: string; // YYYY-MM-DD
}

export interface PortfolioValuation {
  holding: PortfolioHolding;
  currentPrice: number | null;
  currentValue: number | null;
  costBasisTotal: number;
  unrealizedPL: number | null;
  unrealizedPLPercent: number | null; // Holding Period Return (HPR) — total return over the holding period, no income/dividends factored in
  holdingPeriodDays: number;
  annualizedReturnPercent: number | null; // HPR compounded to a 365-day basis (CAGR-style), null when holdingPeriodDays is 0
  sector: string | null;
  error: string | null;
}

export interface AllocationSlice {
  label: string;
  value: number;
  percent: number;
}

export interface PortfolioSummary {
  valuations: PortfolioValuation[];
  totalValue: number;
  totalCostBasis: number;
  totalUnrealizedPL: number;
  totalUnrealizedPLPercent: number | null;
  allocationByAssetClass: AllocationSlice[];
  allocationBySector: AllocationSlice[];
  dataLimitations: string[];
}

export type RiskTier = "low" | "medium" | "high";

export interface HoldingBeta {
  symbol: string;
  beta: number | null;
  alpha: number | null;
  rSquared: number | null;
  n: number;
  volatilityAnnualizedPercent: number | null;
  riskTier: RiskTier | null;
  error: string | null;
}

export interface CorrelationMatrixResult {
  symbols: string[];
  matrix: (number | null)[][]; // matrix[i][j] = correlation(symbols[i], symbols[j])
}

export interface EfficientFrontierPoint {
  weights: Record<string, number>;
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
}

export interface PortfolioAnalyticsResult {
  benchmark: string; // "SPY"
  lookbackDays: number;
  betas: HoldingBeta[];
  correlationMatrix: CorrelationMatrixResult;
  frontier: {
    simulatedPortfolios: EfficientFrontierPoint[];
    maxSharpe: EfficientFrontierPoint | null;
    minVolatility: EfficientFrontierPoint | null;
    current: EfficientFrontierPoint | null;
  };
  dataLimitations: string[];
}

export interface TraditionalCandidate {
  ticker: string;
  checklistPassCount: number;
  checklistTotal: number;
  alreadyHeld: boolean;
  error: string | null;
}

export interface TraditionalCandidateGroup {
  industryId: string;
  industryName: string;
  overallRead: "constructive" | "cautious" | "mixed";
  fmpSectorName: string | null;
  candidates: TraditionalCandidate[];
  note: string | null; // e.g. UNAVAILABLE_SECTOR_NOTE text when no constituents exist
}

export interface TraditionalCandidatesResult {
  groups: TraditionalCandidateGroup[];
  dataLimitations: string[];
}

export interface PortfolioMethodologyOutline {
  id: string;
  title: string;
  summary: string;
  points: { heading: string; detail: string }[];
}

export interface RebalancingTarget {
  symbol: string;
  targetPercent: number;
}

export interface RebalancingRow {
  symbol: string;
  currentValue: number;
  currentPercent: number;
  targetPercent: number;
  targetValue: number;
  deltaValue: number; // positive = buy, negative = sell
  deltaShares: number | null; // null if price unknown
  action: "buy" | "sell" | "hold";
}

export interface HedgeCalculatorInput {
  positionShares: number; // positive = long stock, negative = short stock
  optionType: "call" | "put";
  spot: number;
  strike: number;
  daysToExpiration: number;
  impliedVolatilityPercent: number;
  riskFreeRatePercent: number;
  targetHedgeRatio: number; // 1 = fully hedge to delta-neutral, 0.5 = half-hedge, etc.
  contractMultiplier: number;
}

export type AlertConditionType =
  | "price_threshold"
  | "volume_displacement"
  | "momentum"
  | "mean_reversion"
  | "orb_breakout"
  | "unusual_options"
  | "macro_news_spike";

export type AlertChannel = "email" | "sms" | "both";

export interface AlertSubscription {
  id: string;
  email: string | null;
  phone: string | null;
  channel: AlertChannel;
  consentAt: string;
  unsubscribeToken: string;
  active: boolean;
  createdAt: string;
}

export interface AlertRule {
  id: string;
  subscriptionId: string;
  ticker: string;
  assetClass: AssetClass;
  conditionType: AlertConditionType;
  params: Record<string, unknown>;
  currentlyTriggered: boolean;
  lastEvaluatedAt: string | null;
  active: boolean;
  createdAt: string;
  subscription?: AlertSubscription; // present when fetched joined with its subscription
}

/** Input shape for one row of the subscribe form's rule builder, before a subscription_id exists. */
export interface AlertRuleInput {
  ticker: string;
  assetClass: AssetClass;
  conditionType: AlertConditionType;
  params: Record<string, unknown>;
}

export interface AlertSubscribeRequest {
  email: string | null;
  phone: string | null;
  channel: AlertChannel;
  consent: boolean;
  rules: AlertRuleInput[];
}

export interface AlertEvaluation {
  triggered: boolean;
  message: string;
  proximity: number | null; // ratio toward the threshold where meaningful; null for binary conditions (e.g. orb_breakout)
}

export interface HedgeCalculatorResult {
  delta: number;
  contractsNeeded: number; // signed: positive = buy/long that many contracts, negative = sell/write
  contractsNeededRounded: number;
  sharesHedgedPerContract: number;
}

export type MarketScenarioLabel = "good" | "average" | "bad";

/**
 * Derived from real historical SPY rolling-annual returns, never a hardcoded
 * assumption — see scenario-simulation.ts. "good"/"bad" are the mean of the
 * top/bottom tercile of observed rolling 252-day returns over the available
 * lookback; "average" is the full-sample mean.
 */
export interface MarketScenarioAssumption {
  label: MarketScenarioLabel;
  annualReturn: number; // decimal, e.g. 0.10 for 10%
  sampleYears: number; // actual years of history the provider returned
  sampleSize: number; // number of rolling 252-day windows used
}

export interface ScenarioProjectionPoint {
  year: number; // 0 = today
  p10: number;
  p50: number;
  p90: number;
}

export interface ScenarioProjection {
  label: MarketScenarioLabel;
  assumption: MarketScenarioAssumption;
  projection: ScenarioProjectionPoint[];
  endingValue: { p10: number; p50: number; p90: number };
  totalReturnPercent: { p10: number; p50: number; p90: number };
}

export interface CompanyNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedDate: string;
  kind: "news" | "press-release";
}

export interface SecFilingSummary {
  form: string;
  filingDate: string;
  url: string;
}

export interface TickerNewsPanelResult {
  ticker: string;
  assetClass: AssetClass;
  companyNews: CompanyNewsArticle[] | null; // null for non-equity asset classes — not attempted
  secFilings: SecFilingSummary[] | null; // null for non-equity asset classes — not attempted
  macroNews: GeopoliticalNewsResult | null;
  dataLimitations: string[];
}

export interface ScenarioSimulationResult {
  currentPortfolioValue: number;
  portfolioBeta: number | null;
  portfolioAlpha: number | null;
  horizonYears: number;
  scenarios: ScenarioProjection[];
  dataLimitations: string[];
}

export type DayOfWeekLabel = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";

/**
 * Field set deliberately mirrors BacktestHorizonResult exactly (same
 * BH-FDR/bootstrap/time-split/three-bars pipeline, just segmented by weekday
 * instead of forward-return horizon) — see calendar-effects.ts.
 */
export interface DayOfWeekEffectResult {
  dayOfWeek: DayOfWeekLabel;
  sampleSize: number;
  meanReturnPct: number | null; // open-to-close return realized during that weekday's session
  medianReturnPct: number | null;
  pValue: number | null;
  pValueFdrAdjusted: number | null;
  significantAfterFdr: boolean;
  bootstrapCiLower: number | null;
  bootstrapCiUpper: number | null;
  ciExcludesZero: boolean;
  trainMeanReturnPct: number | null;
  testMeanReturnPct: number | null;
  sameSignOutOfSample: boolean | null;
  passesAllThreeBars: boolean;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdownPct: number | null;
  largestWinPct: number | null;
  largestLossPct: number | null;
}

export interface DayOfWeekTradeLogRow extends DayContextFields {
  dateKey: string;
  dayOfWeek: DayOfWeekLabel;
  openPrice: number;
  closePrice: number;
  returnPct: number;
  isWin: boolean;
}

export interface CalendarDayOfWeekResult {
  ticker: string;
  lookbackYears: number;
  tradingDaysScanned: number;
  days: DayOfWeekEffectResult[];
  tradeLog: DayOfWeekTradeLogRow[];
  dataLimitations: string[];
}

/**
 * Single-weekday, occurrence-count-based variant of CalendarDayOfWeekResult
 * — "last N Fridays" instead of "last N years of all 5 weekdays". Lets a
 * short-term catalyst-driven regime be excluded by trimming the occurrence
 * count rather than only having a blunt year-based lookback. Includes real
 * HOD/LOD timing (minute-bar-driven, unlike the daily-bar-only
 * CalendarDayOfWeekResult) since it only needs minute bars for a bounded set
 * of specific dates, not a continuous multi-year range.
 */
export interface SingleWeekdayResult {
  ticker: string;
  dayOfWeek: DayOfWeekLabel;
  occurrencesRequested: number;
  effect: DayOfWeekEffectResult;
  lowOfDayDistribution: TimeOfDayFrequency[];
  highOfDayDistribution: TimeOfDayFrequency[];
  tradeLog: DayOfWeekTradeLogRow[];
  dataLimitations: string[];
}

export interface TimeOfDayEffectResult {
  checkpoint: string; // machine-readable, e.g. "first15min" — matches CheckpointStat's convention
  label: string; // human-readable, e.g. "First 15 Minutes"
  sampleSize: number;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  pValue: number | null;
  pValueFdrAdjusted: number | null;
  significantAfterFdr: boolean;
  bootstrapCiLower: number | null;
  bootstrapCiUpper: number | null;
  ciExcludesZero: boolean;
  trainMeanReturnPct: number | null;
  testMeanReturnPct: number | null;
  sameSignOutOfSample: boolean | null;
  passesAllThreeBars: boolean;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdownPct: number | null;
  largestWinPct: number | null;
  largestLossPct: number | null;
}

export interface TimeOfDayTradeLogRow extends DayContextFields {
  dateKey: string;
  checkpoint: string;
  windowStartPrice: number;
  windowEndPrice: number;
  returnPct: number;
  isWin: boolean;
}

export interface CalendarTimeOfDayResult {
  ticker: string;
  lookbackDays: number;
  tradingDaysScanned: number;
  checkpoints: TimeOfDayEffectResult[];
  tradeLog: TimeOfDayTradeLogRow[];
  dataLimitations: string[];
}

export type OrbDirection = "long" | "short";
export type OrbHorizonLabel = "30minAfterBreakout" | "60minAfterBreakout" | "holdToEod";

export interface OrbHorizonResult {
  direction: OrbDirection;
  horizonLabel: OrbHorizonLabel;
  sampleSize: number;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  pValue: number | null;
  pValueFdrAdjusted: number | null;
  significantAfterFdr: boolean;
  bootstrapCiLower: number | null;
  bootstrapCiUpper: number | null;
  ciExcludesZero: boolean;
  trainMeanReturnPct: number | null;
  testMeanReturnPct: number | null;
  sameSignOutOfSample: boolean | null;
  passesAllThreeBars: boolean;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdownPct: number | null;
  largestWinPct: number | null;
  largestLossPct: number | null;
}

export interface OrbTradeLogRow extends DayContextFields {
  dateKey: string;
  direction: OrbDirection;
  entryPrice: number;
  breakoutTimeClock: string;
  returnPct30min: number | null;
  returnPct60min: number | null;
  returnPctEod: number | null;
  isWin: boolean | null; // based on returnPctEod
}

export interface OrbTodaySnapshot {
  dateKey: string;
  openingRangeHigh: number | null;
  openingRangeLow: number | null;
  breakoutDirection: OrbDirection | "none-yet" | null; // null = no bars for today at all yet
  breakoutTimeClock: string | null;
}

export interface OrbTickerResult {
  ticker: string;
  openingRangeMinutes: 5 | 15 | 30;
  lookbackMonths: number;
  tradingDaysScanned: number;
  daysSkippedNoOpeningRangeBars: number;
  longOccurrences: number;
  shortOccurrences: number;
  todaySnapshot: OrbTodaySnapshot | null;
  horizons: OrbHorizonResult[];
  tradeLog: OrbTradeLogRow[];
  dataLimitations: string[];
}

export interface OrbScanResult {
  symbol: string;
  assetClass: AssetClass;
  error: string | null;
  orb: OrbTickerResult | null;
}

export interface OrbWatchlistSummary {
  results: OrbScanResult[];
  openingRangeMinutes: 5 | 15 | 30;
  lookbackMonths: number;
  tickersScanned: number;
  tickersWithBreakoutToday: number;
  dataLimitations: string[];
}
