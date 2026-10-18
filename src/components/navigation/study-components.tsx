"use client";

/**
 * Renders a registry study. The lazy components are the existing next/dynamic wrappers from src/app/page-tabs.tsx, so
 * nothing here adds to the first-load JavaScript: a study's code is fetched only when it is opened.
 * Every StudyComponentKey in study-registry.ts must have an entry in STUDY_COMPONENTS (the reachability test checks).
 */
import type { ComponentType } from "react";
import {
  AlertsSubscribeTab,
  AnchoredVolumeProfileTab,
  AssetChartsTab,
  BacktestSuiteTab,
  BondDashboardTab,
  BuybackAnomalyTab,
  CalendarEffectsTab,
  CommoditiesDashboardTab,
  CorporateBuybackOfferingTab,
  CryptoChartsTab,
  CryptoRegimeTab,
  CryptoWatchlistTab,
  CurrencyDashboardTab,
  CurrencyDriversTab,
  CurrencyPegsTab,
  EquityChartsTab,
  FuturesCommoditiesResearchSourcesTab,
  FuturesDashboardTab,
  FxResearchSourcesTab,
  GammaHeatMapTab,
  GapCalendarStudyTab,
  GlossaryTab,
  GuidedTradeSignalsTab,
  HistoricalBacktestTab,
  InternationalCentralBanksView,
  InternationalEconomicsTab,
  LowOfDayTimingTab,
  OptionFlowTab,
  OptionsCalculatorTab,
  OptionsChainTradeTab,
  OptionsDashboardTab,
  OptionsStrategiesTab,
  OrbStrategyTab,
  OvernightIntradayPatternTab,
  PaperBacktestLogTab,
  PaperTradingTab,
  PostBigDayStudyTab,
  PremarketGapHodLodTab,
  QuadWitchingStudyTab,
  RollingMoveStatsTab,
  SessionAnalysisTab,
  StrategyLedgerTab,
  SupplyDemandShockScanTab,
  TradeJournalTab,
  TradingDashboardTab,
  VwapBandStudyTab,
  VwapReversionBacktestTab,
  WeekStartMomentumTab,
  WitchingRangeContainmentTab,
  YieldAlertThresholdTab,
  YieldCurveTab,
  RequiresPlacementTier,
} from "@/app/page-tabs";
import { getStudy, resolveStudyRender, type StudyComponentKey } from "@/lib/navigation/study-registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const STUDY_COMPONENTS: Record<StudyComponentKey, ComponentType<any>> = {
  AlertsSubscribeTab,
  AnchoredVolumeProfileTab,
  AssetChartsTab,
  BacktestSuiteTab,
  BondDashboardTab,
  BuybackAnomalyTab,
  CalendarEffectsTab,
  CommoditiesDashboardTab,
  CorporateBuybackOfferingTab,
  CryptoChartsTab,
  CryptoRegimeTab,
  CryptoWatchlistTab,
  CurrencyDashboardTab,
  CurrencyDriversTab,
  CurrencyPegsTab,
  EquityChartsTab,
  FuturesCommoditiesResearchSourcesTab,
  FuturesDashboardTab,
  FxResearchSourcesTab,
  GammaHeatMapTab,
  GapCalendarStudyTab,
  GlossaryTab,
  GuidedTradeSignalsTab,
  HistoricalBacktestTab,
  InternationalCentralBanksView,
  InternationalEconomicsTab,
  LowOfDayTimingTab,
  OptionFlowTab,
  OptionsCalculatorTab,
  OptionsChainTradeTab,
  OptionsDashboardTab,
  OptionsStrategiesTab,
  OrbStrategyTab,
  OvernightIntradayPatternTab,
  PaperBacktestLogTab,
  PaperTradingTab,
  PostBigDayStudyTab,
  PremarketGapHodLodTab,
  QuadWitchingStudyTab,
  RollingMoveStatsTab,
  SessionAnalysisTab,
  StrategyLedgerTab,
  SupplyDemandShockScanTab,
  TradeJournalTab,
  TradingDashboardTab,
  VwapBandStudyTab,
  VwapReversionBacktestTab,
  WeekStartMomentumTab,
  WitchingRangeContainmentTab,
  YieldAlertThresholdTab,
  YieldCurveTab,
};

export function StudyBody({ studyId, assetClass, ticker }: { studyId: string; assetClass?: string | null; ticker?: string | null }) {
  const study = getStudy(studyId);
  const r = study ? resolveStudyRender(study, assetClass as never, ticker) : undefined;
  if (!r) {
    return (
      <p role="alert" className="text-sm" style={{ color: "var(--text-1)" }}>
        This study is not available. Pick another one from the library.
      </p>
    );
  }
  const Component = STUDY_COMPONENTS[r.component];
  // The key restarts the study when the asset class or ticker changes, because the studies read their defaults once.
  const node = <Component key={`${studyId}:${r.assetClass}:${ticker ?? ""}`} {...r.props} />;
  return r.tier ? <RequiresPlacementTier minTier={r.tier}>{node}</RequiresPlacementTier> : node;
}
