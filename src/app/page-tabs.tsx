"use client";

import dynamic from "next/dynamic";

/**
 * Lazy tab bodies for the home route (page.tsx).
 *
 * page.tsx is a server component that builds every tab's JSX up front. When it imported 76 client components
 * directly, all of their chunks were referenced by the server payload, so the first load shipped about 2.3 MB of JS
 * (637 KB gzip) before any tab was opened. The dynamic() calls live in THIS client module so the chunks are fetched
 * only when a tab actually mounts (Tabs renders only the active tab). The component names are unchanged, so page.tsx
 * reads exactly as before. Games already split their engines (Phaser, Three, Rapier) the same way inside
 * FinancialLiteracyTab; scripts/quality/bundle-budget.cjs checks the result after `next build`.
 *
 * ssr stays on (the default): a lazy tab that is active on the first render is still server-rendered, and its
 * chunk is preloaded for hydration.
 */

function TabLoading() {
  return (
    <div role="status" aria-live="polite" className="jarvis" style={{ minHeight: 120, padding: 0, background: "none" }}>
      <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading…</p>
    </div>
  );
}

export const IndustryImpactTab = dynamic(() => import("@/components/IndustryImpactTab").then((m) => m.IndustryImpactTab), { loading: TabLoading });
export const GlobalFinancialNewsTab = dynamic(() => import("@/components/GlobalFinancialNewsTab").then((m) => m.GlobalFinancialNewsTab), { loading: TabLoading });
export const EconomicOutlookTab = dynamic(() => import("@/components/EconomicOutlookTab").then((m) => m.EconomicOutlookTab), { loading: TabLoading });
export const InternationalCentralBanksView = dynamic(() => import("@/components/EconomicOutlookTab").then((m) => m.InternationalCentralBanksView), { loading: TabLoading });
export const FomcReactionStudyTab = dynamic(() => import("@/components/FomcReactionStudyTab").then((m) => m.FomcReactionStudyTab), { loading: TabLoading });
export const FomcWeekVarianceTab = dynamic(() => import("@/components/FomcWeekVarianceTab").then((m) => m.FomcWeekVarianceTab), { loading: TabLoading });
export const CatalystCalendarTab = dynamic(() => import("@/components/CatalystCalendarTab").then((m) => m.CatalystCalendarTab), { loading: TabLoading });
export const CryptoRegimeTab = dynamic(() => import("@/components/CryptoRegimeTab").then((m) => m.CryptoRegimeTab), { loading: TabLoading });
export const CryptoChartsTab = dynamic(() => import("@/components/CryptoChartsTab").then((m) => m.CryptoChartsTab), { loading: TabLoading });
export const CryptoWatchlistTab = dynamic(() => import("@/components/CryptoWatchlistTab").then((m) => m.CryptoWatchlistTab), { loading: TabLoading });
export const QuadWitchingStudyTab = dynamic(() => import("@/components/QuadWitchingStudyTab").then((m) => m.QuadWitchingStudyTab), { loading: TabLoading });
export const WeekStartMomentumTab = dynamic(() => import("@/components/WeekStartMomentumTab").then((m) => m.WeekStartMomentumTab), { loading: TabLoading });
export const OvernightIntradayPatternTab = dynamic(() => import("@/components/OvernightIntradayPatternTab").then((m) => m.OvernightIntradayPatternTab), { loading: TabLoading });
export const PostBigDayStudyTab = dynamic(() => import("@/components/PostBigDayStudyTab").then((m) => m.PostBigDayStudyTab), { loading: TabLoading });
export const LowOfDayTimingTab = dynamic(() => import("@/components/LowOfDayTimingTab").then((m) => m.LowOfDayTimingTab), { loading: TabLoading });
export const WitchingRangeContainmentTab = dynamic(() => import("@/components/WitchingRangeContainmentTab").then((m) => m.WitchingRangeContainmentTab), { loading: TabLoading });
export const SectorFundamentalsTab = dynamic(() => import("@/components/SectorFundamentalsTab").then((m) => m.SectorFundamentalsTab), { loading: TabLoading });
export const SectorRecommendationsTab = dynamic(() => import("@/components/SectorRecommendationsTab").then((m) => m.SectorRecommendationsTab), { loading: TabLoading });
export const SectorStockAnalysisTab = dynamic(() => import("@/components/SectorStockAnalysisTab").then((m) => m.SectorStockAnalysisTab), { loading: TabLoading });
export const ResearchSourcesTab = dynamic(() => import("@/components/ResearchSourcesTab").then((m) => m.ResearchSourcesTab), { loading: TabLoading });
export const SecurityAnalystTab = dynamic(() => import("@/components/SecurityAnalystTab").then((m) => m.SecurityAnalystTab), { loading: TabLoading });
export const ScreenerTab = dynamic(() => import("@/components/ScreenerTab").then((m) => m.ScreenerTab), { loading: TabLoading });
export const ResearchWatchlistTab = dynamic(() => import("@/components/ResearchWatchlistTab").then((m) => m.ResearchWatchlistTab), { loading: TabLoading });
export const OptionsCalculatorTab = dynamic(() => import("@/components/OptionsCalculatorTab").then((m) => m.OptionsCalculatorTab), { loading: TabLoading });
export const EquityChartsTab = dynamic(() => import("@/components/EquityChartsTab").then((m) => m.EquityChartsTab), { loading: TabLoading });
export const AssetChartsTab = dynamic(() => import("@/components/AssetChartsTab").then((m) => m.AssetChartsTab), { loading: TabLoading });
export const BacktestSuiteTab = dynamic(() => import("@/components/BacktestSuiteTab").then((m) => m.BacktestSuiteTab), { loading: TabLoading });
export const HistoricalBacktestTab = dynamic(() => import("@/components/HistoricalBacktestTab").then((m) => m.HistoricalBacktestTab), { loading: TabLoading });
export const CalendarEffectsTab = dynamic(() => import("@/components/CalendarEffectsTab").then((m) => m.CalendarEffectsTab), { loading: TabLoading });
export const VwapReversionBacktestTab = dynamic(() => import("@/components/VwapReversionBacktestTab").then((m) => m.VwapReversionBacktestTab), { loading: TabLoading });
export const VwapBandStudyTab = dynamic(() => import("@/components/VwapBandStudyTab").then((m) => m.VwapBandStudyTab), { loading: TabLoading });
export const AnchoredVolumeProfileTab = dynamic(() => import("@/components/AnchoredVolumeProfileTab").then((m) => m.AnchoredVolumeProfileTab), { loading: TabLoading });
export const PremarketGapHodLodTab = dynamic(() => import("@/components/PremarketGapHodLodTab").then((m) => m.PremarketGapHodLodTab), { loading: TabLoading });
export const GapCalendarStudyTab = dynamic(() => import("@/components/GapCalendarStudyTab").then((m) => m.GapCalendarStudyTab), { loading: TabLoading });
export const RequiresPlacementTier = dynamic(() => import("@/components/RequiresPlacementTier").then((m) => m.RequiresPlacementTier), { loading: TabLoading });
export const OrbStrategyTab = dynamic(() => import("@/components/OrbStrategyTab").then((m) => m.OrbStrategyTab), { loading: TabLoading });
export const TradingDashboardTab = dynamic(() => import("@/components/TradingDashboardTab").then((m) => m.TradingDashboardTab), { loading: TabLoading });
export const GlossaryTab = dynamic(() => import("@/components/GlossaryTab").then((m) => m.GlossaryTab), { loading: TabLoading });
export const AlertsSubscribeTab = dynamic(() => import("@/components/AlertsSubscribeTab").then((m) => m.AlertsSubscribeTab), { loading: TabLoading });
export const PaperTradingTab = dynamic(() => import("@/components/PaperTradingTab").then((m) => m.PaperTradingTab), { loading: TabLoading });
export const StrategyLedgerTab = dynamic(() => import("@/components/StrategyLedgerTab").then((m) => m.StrategyLedgerTab), { loading: TabLoading });
export const TradeJournalTab = dynamic(() => import("@/components/TradeJournalTab").then((m) => m.TradeJournalTab), { loading: TabLoading });
export const InternationalEconomicsTab = dynamic(() => import("@/components/InternationalEconomicsTab").then((m) => m.InternationalEconomicsTab), { loading: TabLoading });
export const BondDashboardTab = dynamic(() => import("@/components/BondDashboardTab").then((m) => m.BondDashboardTab), { loading: TabLoading });
export const YieldCurveTab = dynamic(() => import("@/components/YieldCurveTab").then((m) => m.YieldCurveTab), { loading: TabLoading });
export const YieldAlertThresholdTab = dynamic(() => import("@/components/YieldAlertThresholdTab").then((m) => m.YieldAlertThresholdTab), { loading: TabLoading });
export const OptionsDashboardTab = dynamic(() => import("@/components/OptionsDashboardTab").then((m) => m.OptionsDashboardTab), { loading: TabLoading });
export const GammaHeatMapTab = dynamic(() => import("@/components/GammaHeatMapTab").then((m) => m.GammaHeatMapTab), { loading: TabLoading });
export const OptionFlowTab = dynamic(() => import("@/components/OptionFlowTab").then((m) => m.OptionFlowTab), { loading: TabLoading });
export const OptionsStrategiesTab = dynamic(() => import("@/components/OptionsStrategiesTab").then((m) => m.OptionsStrategiesTab), { loading: TabLoading });
export const OptionsChainTradeTab = dynamic(() => import("@/components/OptionsChainTradeTab").then((m) => m.OptionsChainTradeTab), { loading: TabLoading });
export const PaperBacktestLogTab = dynamic(() => import("@/components/PaperBacktestLogTab").then((m) => m.PaperBacktestLogTab), { loading: TabLoading });
export const CurrencyDashboardTab = dynamic(() => import("@/components/CurrencyDashboardTab").then((m) => m.CurrencyDashboardTab), { loading: TabLoading });
export const FuturesDashboardTab = dynamic(() => import("@/components/FuturesDashboardTab").then((m) => m.FuturesDashboardTab), { loading: TabLoading });
export const CommoditiesDashboardTab = dynamic(() => import("@/components/CommoditiesDashboardTab").then((m) => m.CommoditiesDashboardTab), { loading: TabLoading });
export const FxResearchSourcesTab = dynamic(() => import("@/components/FxResearchSourcesTab").then((m) => m.FxResearchSourcesTab), { loading: TabLoading });
export const CurrencyDriversTab = dynamic(() => import("@/components/CurrencyDriversTab").then((m) => m.CurrencyDriversTab), { loading: TabLoading });
export const CurrencyPegsTab = dynamic(() => import("@/components/CurrencyPegsTab").then((m) => m.CurrencyPegsTab), { loading: TabLoading });
export const RollingMoveStatsTab = dynamic(() => import("@/components/RollingMoveStatsTab").then((m) => m.RollingMoveStatsTab), { loading: TabLoading });
export const SessionAnalysisTab = dynamic(() => import("@/components/SessionAnalysisTab").then((m) => m.SessionAnalysisTab), { loading: TabLoading });
export const FuturesCommoditiesResearchSourcesTab = dynamic(() => import("@/components/FuturesCommoditiesResearchSourcesTab").then((m) => m.FuturesCommoditiesResearchSourcesTab), { loading: TabLoading });
export const BuybackAnomalyTab = dynamic(() => import("@/components/BuybackAnomalyTab").then((m) => m.BuybackAnomalyTab), { loading: TabLoading });
export const GuidedTradeSignalsTab = dynamic(() => import("@/components/GuidedTradeSignalsTab").then((m) => m.GuidedTradeSignalsTab), { loading: TabLoading });
export const PortfolioDashboardTab = dynamic(() => import("@/components/PortfolioDashboardTab").then((m) => m.PortfolioDashboardTab), { loading: TabLoading });
export const TraditionalPortfolioTab = dynamic(() => import("@/components/TraditionalPortfolioTab").then((m) => m.TraditionalPortfolioTab), { loading: TabLoading });
export const ModernPortfolioTab = dynamic(() => import("@/components/ModernPortfolioTab").then((m) => m.ModernPortfolioTab), { loading: TabLoading });
export const ScenarioSimulationTab = dynamic(() => import("@/components/ScenarioSimulationTab").then((m) => m.ScenarioSimulationTab), { loading: TabLoading });
export const RebalancingTab = dynamic(() => import("@/components/RebalancingTab").then((m) => m.RebalancingTab), { loading: TabLoading });
export const CorrelationFinderTab = dynamic(() => import("@/components/CorrelationFinderTab").then((m) => m.CorrelationFinderTab), { loading: TabLoading });
export const PortfolioMethodologyTab = dynamic(() => import("@/components/PortfolioMethodologyTab").then((m) => m.PortfolioMethodologyTab), { loading: TabLoading });
export const RetirementPlanTab = dynamic(() => import("@/components/RetirementPlanTab").then((m) => m.RetirementPlanTab), { loading: TabLoading });
export const BusinessPhaseTab = dynamic(() => import("@/components/BusinessPhaseTab").then((m) => m.BusinessPhaseTab), { loading: TabLoading });
export const FinancialLiteracyTab = dynamic(() => import("@/components/FinancialLiteracyTab").then((m) => m.FinancialLiteracyTab), { loading: TabLoading });
export const AssistantChatTab = dynamic(() => import("@/components/AssistantChatTab").then((m) => m.AssistantChatTab), { loading: TabLoading });
export const SupplyDemandShockScanTab = dynamic(() => import("@/components/SupplyDemandShockScanTab").then((m) => m.SupplyDemandShockScanTab), { loading: TabLoading });
export const CorporateBuybackOfferingTab = dynamic(() => import("@/components/CorporateBuybackOfferingTab").then((m) => m.CorporateBuybackOfferingTab), { loading: TabLoading });
