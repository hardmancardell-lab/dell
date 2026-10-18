/**
 * The single source of truth for every study and tool in the Trading Agent.
 *
 * Why this exists: the same studies (Backtest, Calendar Effects, VWAP tools, Gap and Calendar, ORB, rolling stats,
 * shock scan, session analysis) used to be repeated as separate tabs in Equities, Bonds, Currency, Futures and
 * Commodities. Here each one is ONE entry with an applicability list and, per asset class, the exact props the old tab
 * passed. The Study Library, the command palette, deep links and the "Open in place" views are all built from this list,
 * and scripts/quality/study-reachability.test.mts fails the build if a study that used to be reachable is not covered
 * here or has no route.
 *
 * This file is plain data (no React, no next/dynamic) so tests can import it under plain Node. The lazy component for
 * each `component` key lives in src/components/navigation/study-components.tsx and reuses the existing dynamic
 * imports from src/app/page-tabs.tsx.
 */
import type { AssetClass } from "@/lib/agents/trading-agent/types";

export type { AssetClass };

export const STUDY_CATEGORIES = [
  "Test an idea",
  "Event studies",
  "Timing",
  "Levels and positioning",
  "Corporate actions",
  "Reference and tools",
] as const;
export type StudyCategory = (typeof STUDY_CATEGORIES)[number];

export const ASSET_CLASSES: readonly AssetClass[] = ["equity", "bond", "option", "forex", "future", "commodity", "crypto"];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  equity: "Equities",
  bond: "Bonds",
  option: "Options",
  forex: "Currency",
  future: "Futures",
  commodity: "Commodities",
  crypto: "Crypto",
};

/** Every component a registry entry can render. The renderer (study-components.tsx) must have one loader per key. */
export type StudyComponentKey =
  | "AnchoredVolumeProfileTab"
  | "AssetChartsTab"
  | "BacktestSuiteTab"
  | "BondDashboardTab"
  | "BuybackAnomalyTab"
  | "CalendarEffectsTab"
  | "CommoditiesDashboardTab"
  | "CorporateBuybackOfferingTab"
  | "CryptoChartsTab"
  | "CryptoRegimeTab"
  | "CryptoWatchlistTab"
  | "CurrencyDashboardTab"
  | "CurrencyDriversTab"
  | "CurrencyPegsTab"
  | "EquityChartsTab"
  | "FuturesCommoditiesResearchSourcesTab"
  | "FuturesDashboardTab"
  | "FxResearchSourcesTab"
  | "GammaHeatMapTab"
  | "GapCalendarStudyTab"
  | "GlossaryTab"
  | "GuidedTradeSignalsTab"
  | "AlertsSubscribeTab"
  | "HistoricalBacktestTab"
  | "InternationalCentralBanksView"
  | "InternationalEconomicsTab"
  | "LowOfDayTimingTab"
  | "NewsHubTab"
  | "OptionFlowTab"
  | "OptionsCalculatorTab"
  | "OptionsChainTradeTab"
  | "OptionsDashboardTab"
  | "OptionsStrategiesTab"
  | "OrbStrategyTab"
  | "OvernightIntradayPatternTab"
  | "PaperBacktestLogTab"
  | "PaperTradingTab"
  | "PostBigDayStudyTab"
  | "PremarketGapHodLodTab"
  | "QuadWitchingStudyTab"
  | "RollingMoveStatsTab"
  | "SessionAnalysisTab"
  | "StrategyLedgerTab"
  | "SupplyDemandShockScanTab"
  | "TradeJournalTab"
  | "TradingDashboardTab"
  | "VwapBandStudyTab"
  | "VwapReversionBacktestTab"
  | "WeekStartMomentumTab"
  | "WitchingRangeContainmentTab"
  | "YieldAlertThresholdTab"
  | "YieldCurveTab";

export type StudyProps = Record<string, string | boolean>;

export interface StudyVariant {
  /** Overrides the entry's component for this asset class (for example Currency Backtest uses BacktestSuiteTab). */
  component?: StudyComponentKey;
  /** The props the old tab passed for this asset class, minus React's `key`. A `defaultTicker` here is the default ticker. */
  props: StudyProps;
  /**
   * The old tab path this variant replaces, for example "trading/equities/backtest". Used by the reachability test.
   * Omitted for entries added after the navigation rework (they have no old tab to preserve).
   */
  legacyTab?: string;
}

export interface StudyNeeds {
  ticker: boolean;
  dateRange: boolean;
  /** Intraday (minute or 5-minute) bars, which the free data feeds only keep for a limited window. */
  minuteData: boolean;
}

export interface StudyEntry {
  /** Stable. Used in URLs (?study=<id>), recents and pins. Never rename; add a new id instead. */
  id: string;
  title: string;
  /** One plain sentence a beginner understands: the question this study answers. */
  question: string;
  category: StudyCategory;
  /** Asset classes the study applies to. Empty means a Trading Agent tool that is not tied to one asset class. */
  assetClasses: AssetClass[];
  needs: StudyNeeds;
  /** Rough, human-readable run time. These are estimates, not measurements. */
  runTime: string;
  /** The lazy component rendered in place. Null for an entry that lives elsewhere in the app and is reached through `location`. */
  component: StudyComponentKey | null;
  /**
   * For an entry that is its own place in the app rather than a study run inside the Trading Agent (the News hub, Client
   * Research): where "Open" goes. The target must be a real tab in page.tsx and in trading-structure.ts (the reachability
   * test checks it once the entry is no longer "planned").
   */
  location?: { primaryId: string; secondaryId?: string };
  /**
   * "planned": the destination is being built by another team. The Study Library lists the card with a disabled
   * "Coming soon" button. To go live: add the tab to page.tsx and trading-structure.ts, set `location`, delete `status`.
   */
  status?: "planned";
  /** Gated behind the Financial Literacy placement quiz (the old RequiresPlacementTier wrapper). */
  tier?: "intermediate";
  /** Per asset class. Trading-wide tools (assetClasses = []) use the single key "all". */
  variants: Partial<Record<AssetClass | "all", StudyVariant>>;
  /** Extra words the search should match. */
  keywords?: string;
}

const NO_NEEDS: StudyNeeds = { ticker: false, dateRange: false, minuteData: false };
const TICKER: StudyNeeds = { ticker: true, dateRange: false, minuteData: false };
const TICKER_RANGE: StudyNeeds = { ticker: true, dateRange: true, minuteData: false };
const TICKER_MINUTES: StudyNeeds = { ticker: true, dateRange: true, minuteData: true };

function t(ticker: string, extra: StudyProps = {}): StudyProps {
  return { defaultTicker: ticker, ...extra };
}

export const STUDIES: StudyEntry[] = [
  // ---------------------------------------------------------------- Test an idea
  {
    id: "backtest",
    title: "Signal Backtest",
    question: "If I had followed a simple signal like momentum or mean reversion in this market, did it really pay off, or was it luck?",
    category: "Test an idea",
    assetClasses: ["equity", "bond", "forex", "future", "commodity", "crypto"],
    needs: TICKER_RANGE,
    runTime: "About 10 to 30 seconds",
    component: "HistoricalBacktestTab",
    keywords: "signal momentum mean reversion edge significance out-of-sample",
    variants: {
      equity: { props: t("AAPL", { assetClass: "equity" }), legacyTab: "trading/equities/backtest" },
      bond: { props: t("TLT", { assetClass: "bond" }), legacyTab: "trading/bonds/backtest" },
      forex: { component: "BacktestSuiteTab", props: t("EUR/USD", { assetClass: "forex" }), legacyTab: "trading/currency/backtest" },
      future: { props: t("SPY", { assetClass: "future" }), legacyTab: "trading/futures/backtest" },
      commodity: { props: t("GLD", { assetClass: "commodity" }), legacyTab: "trading/commodities/backtest" },
      crypto: { props: t("BTC-USD", { crypto: true }), legacyTab: "trading/crypto/backtest" },
    },
  },
  {
    id: "calendar-effects",
    title: "Calendar Effects",
    question: "Does this market tend to move on certain weekdays or at certain times of day, or is the pattern just noise?",
    category: "Test an idea",
    assetClasses: ["equity", "bond", "future", "commodity"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 30 seconds",
    component: "CalendarEffectsTab",
    keywords: "day of week weekday time of day seasonality friday monday",
    variants: {
      equity: { props: t("AAPL", { assetClass: "equity" }), legacyTab: "trading/equities/calendar-effects" },
      bond: { props: t("TLT", { assetClass: "bond" }), legacyTab: "trading/bonds/calendar-effects" },
      future: { props: t("SPY", { assetClass: "future" }), legacyTab: "trading/futures/calendar-effects" },
      commodity: { props: t("GLD", { assetClass: "commodity" }), legacyTab: "trading/commodities/calendar-effects" },
    },
  },
  {
    id: "vwap-reversion-backtest",
    title: "VWAP Reversion Backtest",
    question: "When price stretches far from the day's average price (VWAP), does it usually snap back?",
    category: "Test an idea",
    assetClasses: ["equity", "bond", "future", "commodity"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 30 seconds",
    component: "VwapReversionBacktestTab",
    keywords: "vwap mean reversion intraday bands",
    variants: {
      equity: { props: t("AAPL"), legacyTab: "trading/equities/vwap-reversion-backtest" },
      bond: { props: t("TLT"), legacyTab: "trading/bonds/vwap-reversion-backtest" },
      future: { props: t("SPY"), legacyTab: "trading/futures/vwap-reversion-backtest" },
      commodity: { props: t("GLD"), legacyTab: "trading/commodities/vwap-reversion-backtest" },
    },
  },
  {
    id: "vwap-band-study",
    title: "VWAP Band Study",
    question: "After price touches a band around VWAP on unusually heavy volume, what happened next in the past?",
    category: "Test an idea",
    assetClasses: ["equity", "bond", "forex", "future", "commodity"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 40 seconds",
    component: "VwapBandStudyTab",
    keywords: "vwap sigma volume z-score fade intraday",
    variants: {
      equity: { props: t("SPY"), legacyTab: "trading/equities/vwap-band-study" },
      bond: { props: t("TLT"), legacyTab: "trading/bonds/vwap-band-study" },
      forex: { props: t("GBP/JPY"), legacyTab: "trading/currency/vwap-band-study" },
      future: { props: t("SPY"), legacyTab: "trading/futures/vwap-band-study" },
      commodity: { props: t("GLD"), legacyTab: "trading/commodities/vwap-band-study" },
    },
  },
  {
    id: "orb",
    title: "Opening Range Breakout",
    question: "If I traded a break above or below the first few minutes of the day, would that have worked?",
    category: "Test an idea",
    assetClasses: ["equity", "forex", "future", "commodity"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 30 seconds",
    component: "OrbStrategyTab",
    tier: "intermediate",
    keywords: "orb opening range breakout",
    variants: {
      // The old Equities tab passed no props (the component defaults to equity and AAPL); they are written out here so
      // the ticker can be overridden by a deep link. Both equal the component defaults, so behaviour is unchanged.
      equity: { props: t("AAPL", { filterAssetClass: "equity" }), legacyTab: "trading/equities/orb" },
      forex: { props: t("EUR/USD", { filterAssetClass: "forex" }), legacyTab: "trading/currency/orb" },
      future: { props: t("SPY", { filterAssetClass: "future" }), legacyTab: "trading/futures/orb" },
      commodity: { props: t("GLD", { filterAssetClass: "commodity" }), legacyTab: "trading/commodities/orb" },
    },
  },
  {
    id: "overnight-intraday",
    title: "Overnight vs Intraday",
    question: "Do most of this stock's gains happen overnight or during the trading day, and what follows a gap down that closes green?",
    category: "Test an idea",
    assetClasses: ["equity"],
    needs: TICKER_RANGE,
    runTime: "About 5 to 15 seconds",
    component: "OvernightIntradayPatternTab",
    tier: "intermediate",
    keywords: "overnight gap open close",
    variants: { equity: { props: {}, legacyTab: "trading/equities/overnight-intraday" } },
  },

  // ---------------------------------------------------------------- Event studies
  {
    id: "premarket-gaps",
    title: "Premarket Gaps",
    question: "After a stock gaps down before the open, when does its high and low of the day usually happen?",
    category: "Event studies",
    assetClasses: ["equity"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 30 seconds",
    component: "PremarketGapHodLodTab",
    tier: "intermediate",
    keywords: "gap down premarket hod lod high of day low of day",
    variants: { equity: { props: t("AAPL"), legacyTab: "trading/equities/premarket-gaps" } },
  },
  {
    id: "gap-calendar-study",
    title: "Gap and Calendar Study",
    question: "How do gap-up and gap-down days differ, and when in the day do highs and lows form on a given weekday?",
    category: "Event studies",
    assetClasses: ["equity", "forex", "future", "commodity"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 30 seconds",
    component: "GapCalendarStudyTab",
    tier: "intermediate",
    keywords: "gap weekday hod lod calendar",
    variants: {
      equity: { props: t("AAPL"), legacyTab: "trading/equities/gap-calendar-study" },
      forex: { props: t("EUR/USD"), legacyTab: "trading/currency/gap-calendar-study" },
      future: { props: t("SPY"), legacyTab: "trading/futures/gap-calendar-study" },
      commodity: { props: t("GLD"), legacyTab: "trading/commodities/gap-calendar-study" },
    },
  },
  {
    id: "post-big-day",
    title: "Post-Big-Day Study",
    question: "After a stock has a very big up or down day, how does the next day usually behave?",
    category: "Event studies",
    assetClasses: ["equity"],
    needs: TICKER_RANGE,
    runTime: "About 5 to 15 seconds",
    component: "PostBigDayStudyTab",
    tier: "intermediate",
    keywords: "big move follow through reversal next day",
    variants: { equity: { props: {}, legacyTab: "trading/equities/post-big-day" } },
  },
  {
    id: "quad-witching",
    title: "Quad Witching Study",
    question: "Do volume and volatility really change around quad witching, the quarterly options and futures expiry?",
    category: "Event studies",
    assetClasses: ["equity"],
    needs: TICKER_RANGE,
    runTime: "About 5 to 15 seconds",
    component: "QuadWitchingStudyTab",
    tier: "intermediate",
    keywords: "quad witching expiration opex third friday",
    variants: { equity: { props: {}, legacyTab: "trading/equities/quad-witching" } },
  },
  {
    id: "witching-range-containment",
    title: "Witching Range Containment",
    question: "On witching days, how often does price stay inside a tight range, and what would a butterfly spread have paid?",
    category: "Event studies",
    assetClasses: ["equity"],
    needs: TICKER_RANGE,
    runTime: "About 5 to 15 seconds",
    component: "WitchingRangeContainmentTab",
    tier: "intermediate",
    keywords: "witching butterfly options range pin",
    variants: { equity: { props: {}, legacyTab: "trading/equities/witching-range-containment" } },
  },
  {
    id: "shock-scan",
    title: "Supply/Demand Shock Scan",
    question: "Is there an unusual spike in news about this market right now, and does it look like a supply shock or a demand shock?",
    category: "Event studies",
    assetClasses: ["forex", "future", "commodity"],
    needs: TICKER,
    runTime: "Up to a minute (the news source is rate limited)",
    component: "SupplyDemandShockScanTab",
    keywords: "news gdelt supply demand shock spike",
    variants: {
      forex: { props: t("EUR/USD", { assetClass: "forex" }), legacyTab: "trading/currency/shock-scan" },
      future: { props: t("SPY", { assetClass: "future" }), legacyTab: "trading/futures/shock-scan" },
      commodity: { props: t("GLD", { assetClass: "commodity" }), legacyTab: "trading/commodities/shock-scan" },
    },
  },

  // ---------------------------------------------------------------- Timing
  {
    id: "low-of-day-timing",
    title: "Low-of-Day Timing",
    question: "At what time of day does the session low usually happen, and what if it has not happened by 10:30?",
    category: "Timing",
    assetClasses: ["equity"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 30 seconds",
    component: "LowOfDayTimingTab",
    tier: "intermediate",
    keywords: "low of day high of day lod hod time",
    variants: { equity: { props: {}, legacyTab: "trading/equities/low-of-day-timing" } },
  },
  {
    id: "week-start-momentum",
    title: "Week Start Momentum",
    question: "If a stock starts the week strongly or weakly, does the rest of the week tend to continue or reverse?",
    category: "Timing",
    assetClasses: ["equity"],
    needs: TICKER_RANGE,
    runTime: "About 5 to 15 seconds",
    component: "WeekStartMomentumTab",
    tier: "intermediate",
    keywords: "monday week start momentum reversal",
    variants: { equity: { props: {}, legacyTab: "trading/equities/week-start-momentum" } },
  },
  {
    id: "session-analysis",
    title: "Session Analysis",
    question: "Do the Asian, London and New York sessions behave differently, and does one session predict the next?",
    category: "Timing",
    assetClasses: ["forex", "future"],
    needs: TICKER_MINUTES,
    runTime: "About 10 to 30 seconds",
    component: "SessionAnalysisTab",
    keywords: "asia london new york session forex",
    variants: {
      forex: { props: t("EUR/USD"), legacyTab: "trading/currency/session-analysis" },
      future: { props: t("SPY"), legacyTab: "trading/futures/session-analysis" },
    },
  },
  {
    id: "rolling-move-stats",
    title: "Rolling Move Stats",
    question: "How big are the typical up days and down days over the last 20, 40 and 100 days?",
    category: "Timing",
    assetClasses: ["bond", "future", "commodity"],
    needs: TICKER_RANGE,
    runTime: "A few seconds",
    component: "RollingMoveStatsTab",
    keywords: "volatility average move up day down day rolling",
    variants: {
      bond: { props: t("TLT", { defaultAssetClass: "bond" }), legacyTab: "trading/bonds/rolling-move-stats" },
      future: { props: t("SPY", { defaultAssetClass: "future" }), legacyTab: "trading/futures/rolling-move-stats" },
      commodity: { props: t("GLD", { defaultAssetClass: "commodity" }), legacyTab: "trading/commodities/rolling-move-stats" },
    },
  },

  // ---------------------------------------------------------------- Levels and positioning
  {
    id: "volume-profile",
    title: "Volume Profile",
    question: "At which prices did the most trading happen recently, and where is the price now relative to those levels?",
    category: "Levels and positioning",
    assetClasses: ["equity"],
    needs: TICKER_MINUTES,
    runTime: "About 5 to 15 seconds",
    component: "AnchoredVolumeProfileTab",
    keywords: "volume profile point of control value area nodes support resistance",
    variants: { equity: { props: t("SPY"), legacyTab: "trading/equities/volume-profile" } },
  },
  {
    id: "gamma-heat-map",
    title: "Gamma Heat Map",
    question: "At which strikes and dates is options positioning concentrated?",
    category: "Levels and positioning",
    assetClasses: ["option"],
    needs: TICKER,
    runTime: "About 5 to 20 seconds",
    component: "GammaHeatMapTab",
    keywords: "gamma gex strikes dealer positioning",
    variants: { option: { props: {}, legacyTab: "trading/options/gamma-heat-map" } },
  },
  {
    id: "intraday-put-call",
    title: "Intraday Put/Call Flow",
    question: "Through today's session, were traders buying more puts or more calls, and at what prices?",
    category: "Levels and positioning",
    assetClasses: ["option"],
    needs: TICKER,
    runTime: "Instant (recorded every 5 minutes)",
    component: "OptionFlowTab",
    keywords: "options flow put call premium volume open interest",
    variants: { option: { props: {}, legacyTab: "trading/options/intraday-put-call" } },
  },

  // ---------------------------------------------------------------- Corporate actions
  {
    id: "treasury-buyback-anomaly",
    title: "Treasury Buyback Anomaly",
    question: "When the U.S. Treasury buys back long bonds, does the size of the buyback predict how a stock moves?",
    category: "Corporate actions",
    assetClasses: ["equity"],
    needs: TICKER_RANGE,
    runTime: "About 5 to 15 seconds",
    component: "BuybackAnomalyTab",
    keywords: "treasury buyback fiscal data event study",
    variants: { equity: { props: {}, legacyTab: "trading/equities/treasury-buyback-anomaly" } },
  },
  {
    id: "corporate-buyback-offering",
    title: "Corporate Buybacks and Offerings",
    question: "How has this stock reacted when the company sold new shares or reported buying back its own?",
    category: "Corporate actions",
    assetClasses: ["equity"],
    needs: TICKER,
    runTime: "About 5 to 20 seconds",
    component: "CorporateBuybackOfferingTab",
    keywords: "buyback offering sec filings dilution 424b",
    variants: { equity: { props: {}, legacyTab: "trading/equities/corporate-buyback-offering" } },
  },

  // ---------------------------------------------------------------- Reference and tools: per-asset-class
  {
    id: "dashboard",
    title: "Dashboard",
    question: "What is my watchlist doing right now, and which of its names have live signals?",
    category: "Reference and tools",
    assetClasses: ["equity", "bond", "option", "forex", "future", "commodity"],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "TradingDashboardTab",
    keywords: "overview watchlist scan home",
    variants: {
      equity: { props: { filterAssetClass: "equity" }, legacyTab: "trading/equities/dashboard" },
      bond: { component: "BondDashboardTab", props: {}, legacyTab: "trading/bonds/overview" },
      option: { component: "OptionsDashboardTab", props: {}, legacyTab: "trading/options/dashboard" },
      forex: { component: "CurrencyDashboardTab", props: {}, legacyTab: "trading/currency/dashboard" },
      future: { component: "FuturesDashboardTab", props: {}, legacyTab: "trading/futures/dashboard" },
      commodity: { component: "CommoditiesDashboardTab", props: {}, legacyTab: "trading/commodities/dashboard" },
    },
  },
  {
    id: "charts",
    title: "Charts",
    question: "What has this price done, on a chart I can zoom and add indicators to?",
    category: "Reference and tools",
    assetClasses: ["equity", "bond", "forex", "future", "commodity", "crypto"],
    needs: TICKER,
    runTime: "Instant",
    component: "AssetChartsTab",
    keywords: "chart candlestick price indicators",
    variants: {
      equity: { component: "EquityChartsTab", props: {}, legacyTab: "trading/equities/charts" },
      bond: { props: { assetClass: "bond", defaultTicker: "TLT", placeholder: "Ticker, e.g. TLT", watchlistLabel: "Bonds" }, legacyTab: "trading/bonds/charts" },
      forex: { props: { assetClass: "forex", defaultTicker: "EUR/USD", placeholder: "Pair, e.g. EUR/USD", watchlistLabel: "Currency" }, legacyTab: "trading/currency/charts" },
      future: { props: { assetClass: "future", defaultTicker: "SPY", placeholder: "Ticker, e.g. SPY", watchlistLabel: "Futures" }, legacyTab: "trading/futures/charts" },
      commodity: { props: { assetClass: "commodity", defaultTicker: "GLD", placeholder: "Ticker, e.g. GLD", watchlistLabel: "Commodities" }, legacyTab: "trading/commodities/charts" },
      crypto: { component: "CryptoChartsTab", props: {}, legacyTab: "trading/crypto/charts" },
    },
  },
  {
    id: "research-sources",
    title: "Research Sources",
    question: "Where do professionals get official supply, demand and positioning data for this market?",
    category: "Reference and tools",
    assetClasses: ["future", "commodity"],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "FuturesCommoditiesResearchSourcesTab",
    keywords: "sources cftc eia usda data reading list",
    variants: {
      future: { props: { assetLabel: "futures" }, legacyTab: "trading/futures/sources" },
      commodity: { props: { assetLabel: "commodities" }, legacyTab: "trading/commodities/sources" },
    },
  },

  // ---------------------------------------------------------------- Reference and tools: bonds
  {
    id: "yield-curve",
    title: "Yield Curve",
    question: "What does the Treasury yield curve look like today, and are credit spreads widening?",
    category: "Reference and tools",
    assetClasses: ["bond"],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "YieldCurveTab",
    keywords: "treasury yields curve inversion spreads",
    variants: { bond: { props: {}, legacyTab: "trading/bonds/yield-curve" } },
  },
  {
    id: "yield-alert-threshold",
    title: "Yield Alert Threshold",
    question: "What price on a Treasury ETF matches the yield level I want to be alerted at?",
    category: "Reference and tools",
    assetClasses: ["bond"],
    needs: TICKER_RANGE,
    runTime: "A few seconds",
    component: "YieldAlertThresholdTab",
    keywords: "yield alert threshold etf price",
    variants: { bond: { props: {}, legacyTab: "trading/bonds/yield-alert-threshold" } },
  },

  // ---------------------------------------------------------------- Reference and tools: options
  {
    id: "options-strategy-guide",
    title: "Options Strategy Guide",
    question: "What does each common options strategy look like, and when does it make or lose money?",
    category: "Reference and tools",
    assetClasses: ["option"],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "OptionsStrategiesTab",
    tier: "intermediate",
    keywords: "options strategies spreads covered call straddle guide",
    variants: { option: { props: {}, legacyTab: "trading/options/strategy-guide" } },
  },
  {
    id: "options-calculator",
    title: "Options Calculator",
    question: "What is a call or put worth in theory, and how sensitive is it to price, time and volatility?",
    category: "Reference and tools",
    assetClasses: ["option"],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "OptionsCalculatorTab",
    keywords: "black scholes greeks delta theta calculator price",
    variants: { option: { props: {}, legacyTab: "trading/options/calculator" } },
  },
  {
    id: "paper-backtest-log",
    title: "Paper Backtest Log",
    question: "What happened after the gamma checks I have already run, as the results come in?",
    category: "Reference and tools",
    assetClasses: ["option"],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "PaperBacktestLogTab",
    keywords: "log forward test gex outcomes",
    variants: { option: { props: {}, legacyTab: "trading/options/paper-backtest" } },
  },
  {
    id: "trade-options",
    title: "Trade Options (paper)",
    question: "What does the option chain look like, and how would a paper trade in one contract go?",
    category: "Reference and tools",
    assetClasses: ["option"],
    needs: TICKER,
    runTime: "A few seconds",
    component: "OptionsChainTradeTab",
    keywords: "options chain contracts bid ask paper trade order",
    variants: { option: { props: {}, legacyTab: "trading/options/trade-options" } },
  },

  // ---------------------------------------------------------------- Reference and tools: currency
  {
    id: "fx-reference-guide",
    title: "Currency Reference Guide",
    question: "Where can I read the official sources and basic mechanics behind currency markets?",
    category: "Reference and tools",
    assetClasses: ["forex"],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "FxResearchSourcesTab",
    keywords: "fx reference guide sources spot forward swap",
    variants: { forex: { props: {}, legacyTab: "trading/currency/reference" } },
  },
  {
    id: "currency-macro-drivers",
    title: "Macro Drivers",
    question: "Which economic forces, like rates and inflation gaps, are pushing a currency pair right now?",
    category: "Reference and tools",
    assetClasses: ["forex"],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "CurrencyDriversTab",
    keywords: "interest rate differential inflation macro drivers",
    variants: { forex: { props: {}, legacyTab: "trading/currency/macro-drivers" } },
  },
  {
    id: "central-banks",
    title: "Central Banks",
    question: "What are the major central banks doing with interest rates?",
    category: "Reference and tools",
    assetClasses: ["forex"],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "InternationalCentralBanksView",
    keywords: "fed ecb boj boe rates policy central bank",
    variants: { forex: { props: {}, legacyTab: "trading/currency/central-banks" } },
  },
  {
    id: "currency-pegs",
    title: "Currency Pegs",
    question: "Which currencies are pegged to another, and how stable are those pegs?",
    category: "Reference and tools",
    assetClasses: ["forex"],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "CurrencyPegsTab",
    keywords: "peg hkd dollar peg",
    variants: { forex: { props: {}, legacyTab: "trading/currency/pegs" } },
  },
  {
    id: "fx-news-search",
    title: "Currency News Search",
    question: "What is the international news saying about a country or currency?",
    category: "Reference and tools",
    assetClasses: ["forex"],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "InternationalEconomicsTab",
    keywords: "news search international economics",
    variants: { forex: { props: {}, legacyTab: "trading/currency/news" } },
  },

  // ---------------------------------------------------------------- Reference and tools: crypto
  {
    id: "crypto-regime",
    title: "Crypto Regime",
    question: "Are liquidity and trend conditions in crypto currently supportive or not?",
    category: "Reference and tools",
    assetClasses: ["crypto"],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "CryptoRegimeTab",
    keywords: "regime stablecoin etf flows dominance fear greed",
    variants: { crypto: { props: {}, legacyTab: "trading/crypto/regime" } },
  },
  {
    id: "crypto-watchlist",
    title: "Crypto Watchlist",
    question: "How have my coins moved over the last 24 hours and 7 days?",
    category: "Reference and tools",
    assetClasses: ["crypto"],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "CryptoWatchlistTab",
    keywords: "coins watchlist bitcoin ethereum",
    variants: { crypto: { props: {}, legacyTab: "trading/crypto/watchlist" } },
  },

  // ---------------------------------------------------------------- Sections other teams built.
  // News Hub: live. NewsHubTab (commit 234070b) is a trading-wide tool with its own Trading Agent tab, "News".
  {
    id: "news-hub",
    title: "News Hub",
    question: "What is the news saying about the markets and the tickers I follow?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "NewsHubTab",
    keywords: "news headlines feed articles hub watchlist filings press releases",
    variants: { all: { props: {} } },
  },
  // Client Research: ClientResearchView takes a client `slug` and lives in the client portal (ClientDashboardView at
  // /client/[slug]), so it has no tab in the advisor-facing app. The slot stays "planned" until an advisor-side entry point
  // exists; then set `location` (a real tab id in page.tsx and trading-structure.ts) and delete `status`.
  {
    id: "client-research",
    title: "Client Research",
    question: "What research is ready to share with my clients, and what did each client ask about?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: null,
    status: "planned",
    location: { primaryId: "clients" },
    keywords: "clients advisor research reports share ClientResearchView",
    variants: {},
  },

  // ---------------------------------------------------------------- Trading-wide tools (their own Trading Agent tab each)
  {
    id: "guided-signals",
    title: "Guided Signals",
    question: "Which setups are live right now, and how did the same setup do in this ticker's past?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "A few seconds",
    component: "GuidedTradeSignalsTab",
    keywords: "signals setups live win rate",
    variants: { all: { props: {}, legacyTab: "trading/guided-signals" } },
  },
  {
    id: "glossary",
    title: "Glossary",
    question: "What does this trading term mean, in plain words?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "GlossaryTab",
    keywords: "terms definitions dictionary jargon",
    variants: { all: { props: {}, legacyTab: "trading/glossary" } },
  },
  {
    id: "alerts",
    title: "Alerts",
    question: "How do I get an email or text when a price, volume or signal condition fires?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "AlertsSubscribeTab",
    keywords: "alerts notifications email sms threshold",
    variants: { all: { props: {}, legacyTab: "trading/alerts" } },
  },
  {
    id: "paper-trading",
    title: "Paper Trading",
    question: "How would this trade have gone if I placed it with pretend money?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "PaperTradingTab",
    keywords: "paper trading simulated orders account practice",
    variants: { all: { props: {}, legacyTab: "trading/paper-trading" } },
  },
  {
    id: "strategy-ledger",
    title: "Strategy Ledger",
    question: "Which strategies has the app already tested, and which passed or failed the statistical checks?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "StrategyLedgerTab",
    keywords: "ledger validated rejected sweep results",
    variants: { all: { props: {}, legacyTab: "trading/strategy-ledger" } },
  },
  {
    id: "trade-journal",
    title: "Trade Journal",
    question: "What do my own trades say about what I do well and badly?",
    category: "Reference and tools",
    assetClasses: [],
    needs: NO_NEEDS,
    runTime: "Instant",
    component: "TradeJournalTab",
    keywords: "journal log thesis stop review r multiple",
    variants: { all: { props: {}, legacyTab: "trading/trade-journal" } },
  },
];

const BY_ID = new Map(STUDIES.map((s) => [s.id, s]));

export function getStudy(id: string | null | undefined): StudyEntry | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** The variant of a study for an asset class (or the trading-wide "all" variant). */
export function getVariant(study: StudyEntry, assetClass?: AssetClass | null): { key: AssetClass | "all"; variant: StudyVariant } | undefined {
  if (!study.component) return undefined;
  if (study.assetClasses.length === 0) {
    const variant = study.variants.all;
    return variant ? { key: "all", variant } : undefined;
  }
  const key = assetClass && study.assetClasses.includes(assetClass) ? assetClass : study.assetClasses[0];
  const variant = study.variants[key];
  return variant ? { key, variant } : undefined;
}

/** The component and final props to render a study, with an optional ticker override. */
export function resolveStudyRender(
  study: StudyEntry,
  assetClass?: AssetClass | null,
  ticker?: string | null
): { component: StudyComponentKey; props: StudyProps; assetClass: AssetClass | "all"; tier?: "intermediate" } | undefined {
  const picked = getVariant(study, assetClass);
  if (!picked) return undefined;
  const props: StudyProps = { ...picked.variant.props };
  const clean = ticker?.trim();
  if (clean && "defaultTicker" in props) props.defaultTicker = clean;
  const component = picked.variant.component ?? study.component;
  if (!component) return undefined;
  return { component, props, assetClass: picked.key, tier: study.tier };
}

export function studiesForAssetClass(assetClass: AssetClass): StudyEntry[] {
  return STUDIES.filter((s) => s.assetClasses.includes(assetClass));
}

/** Plain-language list of what a study needs, for the cards. */
export function describeNeeds(needs: StudyNeeds): string {
  const parts: string[] = [];
  if (needs.ticker) parts.push("a ticker");
  if (needs.dateRange) parts.push("a look-back range");
  if (needs.minuteData) parts.push("intraday (minute) data");
  return parts.length ? parts.join(", ") : "nothing to fill in";
}
