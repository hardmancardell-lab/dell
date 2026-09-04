import type { Greeks } from "./black-scholes";
import type { WinLossMetrics } from "./stats";

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
  pmVolume: PmVolumeSnapshot | null;
  pmVolumeError: string | null;
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

export interface PortfolioShockScanEntry {
  symbols: string[]; // one or more holdings sharing this query (e.g. same sector or FX pair)
  assetClass: AssetClass;
  query: string;
  mechanismNote: string;
  latestCoverageValue: number | null;
  averageCoverageValue: number | null;
  coverageMultiple: number | null;
  triggered: boolean;
  headlines: GeopoliticalArticle[];
  narrative: string | null; // real PhD-persona synthesis, null if ANTHROPIC_API_KEY unset or not triggered
}

export interface PortfolioShockScanResult {
  entries: PortfolioShockScanEntry[];
  dataLimitations: string[];
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
  verifiedAsOf: string; // YYYY-MM-DD this peg's status/rate was last checked against a live source, not just when the entry was first written
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
  shares: number; // contracts for options, base-currency units for forex (same convention as paper trading)
  costBasisPerShare: number;
  acquiredDate: string; // YYYY-MM-DD
  // Optional, asset-class-specific fields. Options mirror paper-trading's
  // PaperOptionFields exactly (reused convention, not reinvented). Futures
  // get a real contract multiplier for correct notional sizing.
  optionRight?: PaperOptionRight | null;
  strikePrice?: number | null;
  expirationDate?: string | null; // YYYY-MM-DD, options only — distinct from acquiredDate
  underlyingSymbol?: string | null;
  contractMultiplier?: number | null; // futures only
}

/** A client-facing dashboard link — real server-side holdings, distinct from the anonymous/localStorage-only Portfolio Tracker. */
export interface AdvisorClient {
  id: string;
  slug: string; // the /client/[slug] URL segment
  name: string;
  cashBalance: number; // uninvested cash reserved for this client, not tied to any holding
  linkedEmail: string | null; // email that will auto-link this client to a real signup account
  createdAt: string;
}

export interface RealizedSale {
  id: string;
  symbol: string;
  sharesSold: number;
  salePricePerShare: number;
  fee: number;
  costBasisPerShare: number; // the cost basis of the lot at the moment of sale — not re-derived later
  realizedPnl: number; // (salePricePerShare - costBasisPerShare) * sharesSold - fee
  saleDate: string; // YYYY-MM-DD
  createdAt: string;
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
  marketCapUsd: number | null; // real-time-ish snapshot from FMP's /profile — null for non-equities or when FMP has no figure (e.g. some ETFs)
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
  // Computed from the real, market-value-weighted daily-return series of
  // the "current" portfolio point above (same aligned-returns matrix, no
  // new data source). Null when there's no current point (see frontier.current).
  portfolioSortinoRatioAnnualized: number | null;
  portfolioMaxDrawdownPct: number | null;
  portfolioHistoricalVaR95Pct: number | null; // 1-day 95% VaR, historical-simulation method, as a positive % of portfolio value
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

export interface TaxLotConsumption {
  holdingId: string;
  acquiredDate: string;
  sharesFromLot: number;
  holdingPeriodDays: number;
  isLongTerm: boolean; // held >= 365 days as of the as-of date
  estimatedGainLoss: number;
}

export interface TaxLotImpact {
  symbol: string;
  currentPrice: number;
  dollarAmountRequested: number;
  totalSharesAvailable: number;
  lots: TaxLotConsumption[]; // FIFO order, oldest lot first
  totalEstimatedGainLoss: number;
  shortTermGainLoss: number;
  longTermGainLoss: number;
  exceedsAvailableShares: boolean; // the requested sell amount is larger than total shares held
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
  // Anonymous analytics session id, so this identified conversion can be
  // joined to the rest of that session's anonymous usage. Nullable — never
  // required, and never used to re-identify a person beyond what they
  // already gave us directly (email/phone).
  sessionId: string | null;
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
  sessionId: string | null;
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

export interface GlobalNewsHeadline {
  title: string;
  url: string;
  publishedAt: string | null; // raw pubDate string from the feed, unparsed — formats vary too much across outlets to normalize reliably
}

/**
 * One entry per country's leading financial news outlet. rssUrl is null for
 * outlets where no working public RSS feed could be found/verified — those
 * render as a reference-only card (name + link to the site), never a live
 * headline list, per the same "never fake data" rule as every other source
 * in this app.
 */
export interface GlobalNewsSource {
  country: string;
  outletName: string;
  websiteUrl: string;
  rssUrl: string | null;
}

export interface GlobalNewsSourceResult {
  source: GlobalNewsSource;
  headlines: GlobalNewsHeadline[]; // empty if rssUrl is null, or if the live fetch failed
  error: string | null;
}

export interface GlobalFinancialNewsResult {
  results: GlobalNewsSourceResult[];
  dataLimitations: string[];
}

export interface WatchlistNewsItem {
  symbol: string;
  label: string; // real company name for equities, pair label for forex
  curated: boolean; // true if a hand-tuned query exists (forex majors); false for a generic fallback query
  articles: GeopoliticalArticle[];
  error: string | null;
}

export interface WatchlistNewsResult {
  items: WatchlistNewsItem[];
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

// --- Trading session distinction + session-sequence analysis ---
// Sessions are defined in UTC (the standard, widely-cited convention for
// FX/futures trading hours), not Eastern Time like WINDOWS above — see
// time-windows.ts's SESSIONS constant and session-sequence-analysis.ts.

export type SessionId = "asian" | "london" | "newYork";
export type SessionSequenceEdgeId = "asianToLondon" | "londonToNewYork" | "newYorkToNextAsian";
export type PriorSessionDirection = "up" | "down";

/** Field set mirrors DayOfWeekEffectResult exactly (same statistical pipeline), bucketed by the prior session's real direction instead of by weekday. */
export interface SessionSequenceBucketResult {
  edgeId: SessionSequenceEdgeId;
  edgeLabel: string;
  priorDirection: PriorSessionDirection;
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

export interface SessionStats {
  sessionId: SessionId;
  label: string;
  sampleSize: number;
  meanReturnPct: number | null;
  meanRangePct: number | null;
}

export interface SessionSequenceTradeLogRow {
  dateKey: string; // UTC calendar date the follow-on session fell on
  edgeId: SessionSequenceEdgeId;
  priorDirection: PriorSessionDirection;
  followOnReturnPct: number;
  isWin: boolean;
}

export interface SessionAnalysisResult {
  ticker: string;
  lookbackDays: number;
  sessionStats: SessionStats[];
  sequenceBuckets: SessionSequenceBucketResult[];
  tradeLog: SessionSequenceTradeLogRow[];
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

// --- Paper Trading Simulator ---
// Long-only equity paper trading (no shorting/margin) on real quotes and
// real minute-bar price action — no fabricated fills. Scoped this way
// because this app never fabricates a number: short-selling would need a
// borrow/margin model this app has no real data source for, so it's left
// out rather than faked. Anonymous, session_id-keyed like alert_subscriptions
// — no login/account system anywhere in this app.

export type PaperOrderSide = "buy" | "sell";
export type PaperOrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
export type PaperOrderStatus = "pending" | "filled" | "cancelled" | "rejected";
export type PaperOptionRight = "call" | "put";

// Options-specific identity fields, present only when assetClass === "option".
// underlyingSymbol/expirationDate/optionRight/strikePrice are stored explicitly
// (not re-parsed from the OCC-style contract symbol) so the UI and engine can
// re-fetch a live quote for the exact contract without a string parser.
export interface PaperOptionFields {
  underlyingSymbol: string | null;
  expirationDate: string | null; // YYYY-MM-DD
  optionRight: PaperOptionRight | null;
  strikePrice: number | null;
}

export interface PaperAccount {
  id: string;
  sessionId: string;
  cashBalance: number;
  createdAt: string;
}

export interface PaperPosition extends PaperOptionFields {
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  avgCostBasis: number;
}

export interface PaperOrder extends PaperOptionFields {
  id: string;
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  side: PaperOrderSide;
  orderType: PaperOrderType;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  trailAmount: number | null;
  trailingStopPrice: number | null; // ratchets as price moves favorably; null until first evaluation
  ocoGroupId: string | null; // the linked order is auto-cancelled when this one fills
  strategyGroupId: string | null; // tags N single-leg orders submitted together as one multi-leg strategy (e.g. an iron condor) — display/ledger grouping only, no atomic-fill guarantee across legs
  status: PaperOrderStatus;
  rejectedReason: string | null;
  lastEvaluatedAt: string | null;
  createdAt: string;
  filledAt: string | null;
  cancelledAt: string | null;
}

export interface PaperFill extends PaperOptionFields {
  id: string;
  orderId: string;
  accountId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  fillPrice: number;
  slippagePerShare: number;
  secFee: number;
  finraFee: number;
  occFee: number; // OCC per-contract clearing fee, options only, charged both sides
  totalFees: number;
  realizedPnl: number | null; // only set for sell fills that close/reduce a long position
  filledAt: string;
}

export interface PaperOrderInput extends Partial<PaperOptionFields> {
  symbol: string;
  assetClass: AssetClass;
  side: PaperOrderSide;
  orderType: PaperOrderType;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  trailAmount?: number | null;
  ocoGroupId?: string | null;
  strategyGroupId?: string | null;
}

export interface PaperPositionView extends PaperPosition {
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
}

export interface PaperAccountSummary {
  account: PaperAccount;
  positions: PaperPositionView[];
  openOrders: PaperOrder[];
  recentFills: PaperFill[];
  cashBalance: number;
  positionsValue: number;
  totalEquity: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  winLoss: WinLossMetrics | null;
  dataLimitations: string[];
}

export interface PaperOrderCheckResult {
  ordersEvaluated: number;
  ordersFilled: number;
  ordersCancelledByOco: number;
  errors: { orderId: string; error: string }[];
}

// --- Trade Journal ---
// A real, manually-entered log of the user's own trades — real broker fills
// (source "live") or practice reps taken through this app's own Paper
// Trading account (source "paper") — distinct from the Strategy Ledger
// (fully automated hypothesis sweeps run against a fixed universe). No order
// execution happens here; this is a discipline tool modeled on the real
// professional-trading-journal genre (Edgewonk/TradeZella/Tradervue):
// risk-defined entries (stop/target -> R-multiple), strategy/emotion/mistake
// tagging, and analytics that surface what's actually working.
//
// Modeled as position + fills (not one row per trade) so averaging in/out
// and partial exits are represented correctly instead of faked as separate
// unrelated trades. Positions use average-cost accounting, same convention
// as PaperPosition/paper-trading-engine.ts elsewhere in this app.

export type JournalInstrumentType = "call" | "put" | "shares";
export type JournalStatus = "open" | "closed";
export type JournalFillSide = "buy" | "sell";
export type JournalSource = "live" | "paper"; // real broker fill vs. this app's Paper Trading account

export type JournalEmotionTag = "confident" | "disciplined" | "neutral" | "fomo" | "impulsive" | "fearful" | "hesitant" | "revenge";

export const JOURNAL_EMOTION_TAGS: { value: JournalEmotionTag; label: string }[] = [
  { value: "disciplined", label: "Disciplined — followed the plan" },
  { value: "confident", label: "Confident" },
  { value: "neutral", label: "Neutral" },
  { value: "hesitant", label: "Hesitant" },
  { value: "fomo", label: "FOMO" },
  { value: "impulsive", label: "Impulsive" },
  { value: "fearful", label: "Fearful" },
  { value: "revenge", label: "Revenge trade" },
];

// Strategy vocabulary grounded in the user's own established playbook
// (event-vol straddles, PM-volume momentum, weekly swing trades) plus the
// generic categories every reviewed competitor journal tags by. "other"
// carries a free-text label.
// Discretionary categories (the user's own established playbook) plus the
// exact signal/strategy types this app's own backtest engines test for
// (historical-backtest.ts's EquityBacktestSignalType, calendar-effects.ts's
// day-of-week/time-of-day effects, opening-range-breakout.ts's long/short
// horizons, and peg-reversion.ts's currency-peg mean reversion) — the same
// strategyType strings hypothesis-sweep.ts logs into the Strategy Ledger,
// reused here rather than inventing a parallel vocabulary.
export const JOURNAL_STRATEGY_TAGS: { value: string; label: string }[] = [
  { value: "event_catalyst", label: "Event / Volatility Catalyst" },
  { value: "pm_volume_momentum", label: "Premarket Volume Momentum" },
  { value: "weekly_swing", label: "Weekly Swing" },
  { value: "mean_reversion", label: "Mean Reversion (discretionary)" },
  { value: "hedge", label: "Hedge / Risk Offset" },
  { value: "volumeDisplacement", label: "Volume Displacement" },
  { value: "momentum", label: "Momentum" },
  { value: "meanReversionOversold", label: "Mean Reversion — Oversold" },
  { value: "meanReversionOverbought", label: "Mean Reversion — Overbought" },
  { value: "orbBreakout_long", label: "Opening Range Breakout — Long" },
  { value: "orbBreakout_short", label: "Opening Range Breakout — Short" },
  { value: "dayOfWeekEffect", label: "Day-of-Week Effect" },
  { value: "timeOfDayEffect", label: "Time-of-Day Effect" },
  { value: "pegReversion", label: "Currency Peg Reversion" },
  { value: "other", label: "Other" },
];

export const JOURNAL_MISTAKE_TAGS = [
  "No stop set",
  "Sized too big",
  "Chased entry",
  "Ignored plan",
  "Exited too early",
  "Held too long",
  "Revenge trade",
  "FOMO entry",
  "No clear catalyst",
] as const;

export interface JournalFill {
  id: string;
  positionId: string;
  side: JournalFillSide;
  quantity: number;
  price: number;
  filledAt: string;
  note: string | null;
}

export interface JournalFillInput {
  side: JournalFillSide;
  quantity: number;
  price: number;
  filledAt?: string;
  note?: string | null;
}

export interface JournalPosition {
  id: string;
  ticker: string;
  instrumentType: JournalInstrumentType;
  strikePrice: number | null;
  expirationDate: string | null; // YYYY-MM-DD, options only
  source: JournalSource;
  strategy: string; // one of JOURNAL_STRATEGY_TAGS's values
  strategyOther: string | null; // free text when strategy === "other"
  thesis: string | null;
  stopLoss: number | null; // price level (same units as fill price) that invalidates the thesis — defines 1R
  targetPrice: number | null; // planned take-profit price level
  emotionTag: JournalEmotionTag | null;
  followedPlan: boolean | null;
  mistakeTags: string[];
  status: JournalStatus;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
  fills: JournalFill[];
}

export interface JournalPositionInput {
  sessionId: string;
  ticker: string;
  instrumentType: JournalInstrumentType;
  strikePrice?: number | null;
  expirationDate?: string | null;
  source: JournalSource;
  strategy: string;
  strategyOther?: string | null;
  thesis?: string | null;
  stopLoss?: number | null;
  targetPrice?: number | null;
  emotionTag?: JournalEmotionTag | null;
  quantity: number;
  entryPrice: number;
  entryDate?: string;
}

// Derived from a position's fills via average-cost accounting — never
// stored, always recomputed on read so it can't drift from the real fills.
export interface JournalPositionMetrics {
  openQuantity: number;
  avgEntryPrice: number | null;
  avgExitPrice: number | null;
  peakQuantity: number; // largest open size reached — used as the R-multiple's risk base when lots were added over time
  costBasisOpen: number; // $ notional still open, at avg cost
  realizedPnl: number;
  realizedR: number | null; // realizedPnl / (|avgEntryPrice - stopLoss| * peakQuantity * multiplier); null if no stop set
  plannedRiskAmount: number | null; // |avgEntryPrice - stopLoss| * peakQuantity * multiplier
  unrealizedR: number | null;
}

export interface JournalStrategyBreakdown {
  strategy: string;
  count: number;
  winRate: number | null;
  expectancyR: number | null;
  totalRealizedPnl: number;
}

export interface JournalDayOfWeekBreakdown {
  dayOfWeek: string;
  count: number;
  winRate: number | null;
  avgR: number | null;
}

export interface JournalEmotionBreakdown {
  emotion: string;
  count: number;
  winRate: number | null;
  avgR: number | null;
}

export interface JournalMistakeFrequency {
  mistake: string;
  count: number;
  totalPnlImpact: number;
}

export interface JournalEquityCurvePoint {
  date: string;
  cumulativePnl: number;
}

export interface JournalAnalytics {
  closedCount: number;
  winRate: number | null;
  expectancyR: number | null; // mean(realizedR) across closed positions with a stop set
  profitFactorR: number | null; // sum(winning R) / abs(sum(losing R))
  avgWinR: number | null;
  avgLossR: number | null;
  totalRealizedPnl: number;
  currentStreak: { type: "win" | "loss" | null; count: number };
  byStrategy: JournalStrategyBreakdown[];
  byDayOfWeek: JournalDayOfWeekBreakdown[];
  byEmotion: JournalEmotionBreakdown[];
  mistakeFrequency: JournalMistakeFrequency[];
  equityCurve: JournalEquityCurvePoint[];
  maxDrawdownPct: number | null;
  planAdherenceRate: number | null; // % of closed positions where followedPlan === true
  noStopRate: number | null; // % of closed positions with no stopLoss set — a real risk-management red flag
  dataLimitations: string[];
}

// --- Rolling Move Stats ---
// Real up-day/down-day/absolute average move, computed directly from actual
// daily bars — deliberately NOT the symmetric folded-normal shortcut
// (E[|R|] = sigma*sqrt(2/pi)), since that assumes zero skew and throws away
// exactly the asymmetry a real strategy would want to know about.

export type RollingMoveWindow = 20 | 40 | 100;

export interface RollingMoveWindowStats {
  windowDays: RollingMoveWindow;
  tradingDaysUsed: number;
  avgAbsMovePct: number | null;
  avgUpDayPct: number | null;
  upDayCount: number;
  avgDownDayPct: number | null;
  downDayCount: number;
}

export interface RollingMoveStatsResult {
  ticker: string;
  assetClass: AssetClass;
  windows: RollingMoveWindowStats[];
  dataLimitations: string[];
}

// --- Strategy Hypothesis Ledger ---
// Real, automatically-logged results from this app's own already-validated
// backtest engines (BH-FDR + bootstrap CI + out-of-sample sign check — the
// "three bars" gate already used everywhere else) — not a new statistical
// method, just disciplined, automated reuse of what's already proven
// rigorous. Every row states its exit type explicitly: "time" = fixed
// forward-holding-period, no price trigger; "price" = stop/target level.

export type HypothesisExitType = "time" | "price";
export type HypothesisStatus = "validated" | "rejected";

export interface StrategyHypothesis {
  id: string;
  createdAt: string;
  ticker: string;
  assetClass: AssetClass;
  strategyType: string;
  horizonLabel: string;
  entryRule: string;
  exitType: HypothesisExitType;
  exitRule: string;
  sampleSize: number;
  winRatePct: number | null;
  profitFactor: number | null;
  passesThreeBars: boolean;
  pValueFdr: number | null;
  bootstrapCiLower: number | null;
  bootstrapCiUpper: number | null;
  status: HypothesisStatus;
  rejectionReason: string | null;
  sourceEngine: string;
  // Shannon entropy of the ticker's real daily-return series during this
  // sweep (0 = maximally structured, 1 = maximally random), logged for
  // transparency — not used to filter results. Null if there wasn't enough
  // real bar history to compute a meaningful histogram.
  entropyScore: number | null;
}

// --- Treasury Buyback / GLD Event-Study Regression ---

/** One real Treasury buyback operation (U.S. Treasury Fiscal Data API — verified live endpoint, not guessed). */
export interface BuybackOperation {
  operationDate: string; // YYYY-MM-DD
  operationType: string; // Treasury's own stated purpose, e.g. "Liquidity Support" — not "yield suppression"
  maturityBucket: string; // e.g. "20Y to 30Y"
  totalParAmtAccepted: number; // USD
  totalParAmtOffered: number | null; // USD
  nbrIssuesAccepted: number | null;
}

/**
 * One matched buyback-operation + price-reaction row. Both a raw return
 * (naive % move) and a market-model abnormal return (raw return minus the
 * return a benchmark-implied market model would have predicted, per
 * MacKinlay's standard event-study methodology) are kept side by side —
 * the raw figure alone conflates the event's real effect with whatever the
 * broader dollar/rates market was doing that same day.
 */
export interface BuybackEventRow {
  operationDate: string;
  amountAcceptedUsdBillions: number;
  day0ReturnPct: number; // prior close -> operation-day close (raw)
  day1ReturnPct: number; // operation-day close -> next trading day close (raw)
  day0AbnormalReturnPct: number | null; // raw day0 return minus market-model-expected return
  day1AbnormalReturnPct: number | null;
}

export interface BuybackRegressionResult {
  slope: number; // % return per $1B accepted
  intercept: number;
  rSquared: number;
  n: number;
  bootstrapSlopeLower: number | null;
  bootstrapSlopeUpper: number | null;
  ciExcludesZero: boolean;
}

/** The market model itself (GLD ~ benchmark), fit once over the full non-event sample — the beta/alpha used to compute every event's abnormal return. */
export interface MarketModelFit {
  benchmarkTicker: string;
  beta: number;
  alpha: number;
  rSquared: number;
  n: number;
}

/**
 * The real, standard single-pass event-study form (Karafiath 1988; Binder
 * 1985/1998): R_t = α + β·R_m,t + γ·D_t + ε, fit once over ALL trading days
 * at once (D_t = the buyback $ amount on an event day, 0 otherwise) rather
 * than the two-step estimate-then-subtract approach `BuybackRegressionResult`
 * above uses. γ should land close to the two-step slope (Binder's own
 * finding) — reported alongside it as a real cross-check, not a replacement.
 */
export interface DummyVariableRegressionResult {
  gamma: number; // % return per $1B accepted, jointly controlling for the market's move that day
  gammaBootstrapLower: number | null;
  gammaBootstrapUpper: number | null;
  ciExcludesZero: boolean;
  marketBeta: number; // the same fit's coefficient on the benchmark return
  rSquared: number;
  n: number;
}

/**
 * Time-varying-beta / structural-break check (Chow 1960; Bai & Perron 1998
 * for the general concept — implemented here via bootstrap rather than a
 * parametric F-test, consistent with this app's existing bootstrap-first
 * convention elsewhere): does the market model's beta differ between the
 * first and second half of the sample?
 */
export interface BetaDriftResult {
  splitDateKey: string;
  earlyBeta: number;
  earlyN: number;
  lateBeta: number;
  lateN: number;
  betaDiff: number; // lateBeta - earlyBeta
  diffBootstrapLower: number | null;
  diffBootstrapUpper: number | null;
  ciExcludesZero: boolean;
}

export interface BuybackAnomalyResult {
  ticker: string;
  maturityBucket: string;
  events: BuybackEventRow[];
  marketModel: MarketModelFit | null;
  day0Regression: BuybackRegressionResult | null;
  day1Regression: BuybackRegressionResult | null;
  day0AbnormalRegression: BuybackRegressionResult | null;
  day1AbnormalRegression: BuybackRegressionResult | null;
  day0DummyRegression: DummyVariableRegressionResult | null;
  day1DummyRegression: DummyVariableRegressionResult | null;
  betaDrift: BetaDriftResult | null;
  dataLimitations: string[];
}

// --- Guided Trade Signal Card ---

/**
 * A single beginner-facing card: real historical validation (from the
 * Strategy Hypothesis Ledger's weekly sweep, already passing the "three
 * bars" statistical gate) crossed with a real LIVE check that the same
 * signal is triggering today. Only ever the intersection of both —
 * never a live trigger alone (unvalidated) and never a validated
 * historical result alone (not actionable today).
 */
export interface GuidedTradeSignal {
  ticker: string;
  assetClass: AssetClass;
  strategyType: string;
  headline: string; // plain-language, e.g. "Momentum Breakout"
  currentPrice: number;
  historicalWinRatePct: number;
  sampleSize: number;
  bootstrapCiLower: number | null;
  bootstrapCiUpper: number | null;
  horizonLabel: string;
  exitType: HypothesisExitType;
  exitRule: string;
  entryRule: string;
  // Populated only when the request comes from an authenticated user with a
  // linked advisor_clients portfolio — null/false for the general public.
  ownedByUser: boolean;
  relatedHoldingSymbol: string | null; // e.g. "NLR" if this signal is on OKLO and OKLO shares NLR's sector
}
