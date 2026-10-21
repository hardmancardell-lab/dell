import { getMacroOverview, getMacroBriefing } from "@/lib/agents/research-agent/skills/macro-overview";
import { StatCard } from "@/components/StatCard";
import { ResearchGlossaryTerm } from "@/components/ResearchGlossaryTerm";
import { getSectorOverview } from "@/lib/agents/research-agent/skills/sector-overview";
import { Tabs } from "@/components/Tabs";
// Every tab body is a lazy client component (see page-tabs.tsx): only the active tab's code is downloaded.
import {
  AlertsSubscribeTab,
  AssistantChatTab,
  BusinessPhaseTab,
  CatalystCalendarTab,
  CorrelationFinderTab,
  EconomicOutlookTab,
  FinancialLiteracyTab,
  FomcReactionStudyTab,
  FomcWeekVarianceTab,
  GlobalFinancialNewsTab,
  GlossaryTab,
  GuidedTradeSignalsTab,
  IndustryImpactTab,
  ModernPortfolioTab,
  PaperTradingTab,
  PortfolioDashboardTab,
  PortfolioMethodologyTab,
  RebalancingTab,
  ResearchSourcesTab,
  ResearchWatchlistTab,
  RetirementPlanTab,
  ScenarioSimulationTab,
  ScreenerTab,
  SectorFundamentalsTab,
  SectorRecommendationsTab,
  SectorStockAnalysisTab,
  SecurityAnalystTab,
  StrategyLedgerTab,
  TradeJournalTab,
  TraditionalPortfolioTab,
} from "./page-tabs";
import { AppNavigationProvider } from "@/lib/navigation/app-navigation";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { HelpMenu } from "@/components/HelpMenu";
import { FayeChatWidget } from "@/components/FayeChatWidget";
import { MacroDashboardTab } from "@/components/MacroDashboardTab";
import { AssetGroupWorkspace, NewsHubTab, StudiesTab } from "@/components/navigation/lazy";
import { PaletteHost } from "@/components/navigation/PaletteHost";

// The navigation surfaces (Study Library, group workspace) use the jarvis tokens, and the Trading Agent's page is not
// inside a jarvis island, so they render inside this transparent one. It lives in page.tsx, which already opens islands.
function NavScope({ children }: { children: React.ReactNode }) {
  return (
    <div className="jarvis" style={{ padding: 0, background: "none", backgroundImage: "none", borderRadius: 0 }}>
      {children}
    </div>
  );
}

function ConditionBadge({ text }: { text: string }) {
  return <span className="jv-badge c-neutral">{text}</span>;
}

export default async function Home() {
  let matrix;
  let macroError: string | null = null;
  try {
    matrix = await getMacroOverview();
  } catch (e) {
    macroError = e instanceof Error ? e.message : "Unknown error";
  }

  let briefing;
  let briefingError: string | null = null;
  if (matrix) {
    try {
      briefing = await getMacroBriefing(matrix);
    } catch (e) {
      briefingError = e instanceof Error ? e.message : "Unknown error";
    }
  }

  let sector;
  let sectorError: string | null = null;
  try {
    sector = await getSectorOverview();
  } catch (e) {
    sectorError = e instanceof Error ? e.message : "Unknown error";
  }

  const macroStanceContent = macroError ? (
    <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
      <div className="font-medium">Could not load live data</div>
      <div className="text-sm mt-1">{macroError}</div>
    </div>
  ) : matrix ? (
    <div className="flex flex-col gap-10">
      {briefing && (
        <section>
          <div className="jv-strip-title">National Summary &mdash; Beige-Book-Style Read</div>
          <div className="flex flex-col gap-3 mb-8">
            {briefing.nationalSummary.map((s) => (
              <div key={s.category} className="jv-card">
                <div className="jv-br-b" />
                <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>{s.category}</div>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-1)" }}>{s.narrative}</p>
              </div>
            ))}
          </div>

          <div className="jv-strip-title">Current Conditions &mdash; SEP-Styled Table</div>
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="text-left" style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }}>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Metric</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Current Reading</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">As-Of Date</th>
                  <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Prior Reading</th>
                  <th className="py-2 font-mono text-xs uppercase tracking-wider font-normal">Direction</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {briefing.currentConditionsTable.map((row) => (
                  <tr key={row.metric} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className="py-2 pr-4 font-medium" style={{ color: "var(--text-0)" }}>{row.metric}</td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-1)" }}>
                      {row.currentValue !== null ? `${row.currentValue.toFixed(2)}%` : "N/A"}
                    </td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-2)" }}>{row.currentDate}</td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-2)" }}>
                      {row.yearAgoValue !== null ? `${row.yearAgoValue.toFixed(2)}% (${row.yearAgoDate})` : "N/A"}
                    </td>
                    <td className="py-2 font-mono" style={{ color: "var(--text-1)" }}>
                      {row.direction === "up" ? "↑" : row.direction === "down" ? "↓" : row.direction === "flat" ? "→" : "?"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs" style={{ color: "var(--verdict)" }}>{briefing.asOfNote}</p>
        </section>
      )}
      {briefingError && !briefing && (
        <div className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
          Extended macro briefing view unavailable: {briefingError}. Showing the underlying stance and matrix data below.
        </div>
      )}

      <div className="jv-verdict-panel">
        <div className="jv-vp-label">
          <span className="jv-dot" aria-hidden="true" />
          Overall stance
        </div>
        <h3>
          <ResearchGlossaryTerm term="macroStanceLabel">{matrix.stance.label}</ResearchGlossaryTerm>
        </h3>
        <div className="flex flex-col gap-2">
          {matrix.stance.rationale.map((r) => (
            <p key={r.slice(0, 24)}>{r}</p>
          ))}
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="jv-strip-title" style={{ marginBottom: 0 }}>
            1. Credit &amp; Systemic Liquidity
          </div>
          <ResearchGlossaryTerm term="creditCondition">
            <ConditionBadge text={matrix.credit.creditCondition} />
          </ResearchGlossaryTerm>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatCard
            label={
              <ResearchGlossaryTerm term="yieldCurveInversion">
                {matrix.credit.yieldCurveSpread.label}
              </ResearchGlossaryTerm>
            }
            value={`${matrix.credit.yieldCurveSpread.value.toFixed(2)} pp`}
            sub={matrix.credit.yieldCurveInverted ? "Inverted" : "Not inverted"}
          />
          <StatCard
            label={
              <ResearchGlossaryTerm term="highYieldOas">
                {matrix.credit.highYieldSpread.label}
              </ResearchGlossaryTerm>
            }
            value={`${matrix.credit.highYieldSpread.value.toFixed(2)}%`}
            sub={matrix.credit.highYieldSpread.date}
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="jv-strip-title" style={{ marginBottom: 0 }}>
            2. Valuation &amp; Market Over-Extension
          </div>
          <ResearchGlossaryTerm term="valuationCondition">
            <ConditionBadge text={matrix.valuation.valuationCondition} />
          </ResearchGlossaryTerm>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatCard
            label={
              <ResearchGlossaryTerm term="buffettIndicator">
                Buffett Indicator (Nonfin. Corp. Equities / GDP)
              </ResearchGlossaryTerm>
            }
            value={`${matrix.valuation.buffettIndicator.value.toFixed(0)}%`}
            sub={`as of ${matrix.valuation.buffettIndicator.marketCapDate} — partial proxy, excludes financials/private cos.`}
          />
          <StatCard
            label={<ResearchGlossaryTerm term="cape">Shiller CAPE</ResearchGlossaryTerm>}
            value={matrix.valuation.cape.value !== null ? String(matrix.valuation.cape.value) : "Not available"}
            sub={matrix.valuation.cape.note}
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="jv-strip-title" style={{ marginBottom: 0 }}>
            3. Normalized Earning Power &amp; Production
          </div>
          <ResearchGlossaryTerm term="productionPhase">
            <ConditionBadge text={matrix.production.productionPhase} />
          </ResearchGlossaryTerm>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatCard
            label={
              <ResearchGlossaryTerm term="capacityUtilization">
                {matrix.production.capacityUtilization.label}
              </ResearchGlossaryTerm>
            }
            value={`${matrix.production.capacityUtilization.value.toFixed(1)}%`}
            sub={`Long-run avg ~${matrix.production.capacityUtilizationLongRunAvg}%`}
          />
          <StatCard
            label={matrix.production.industrialProduction.label}
            value={
              matrix.production.industrialProductionYoY !== null
                ? `${matrix.production.industrialProductionYoY.toFixed(1)}% YoY`
                : "N/A"
            }
          />
          <StatCard
            label={matrix.production.realDisposableIncome.label}
            value={
              matrix.production.realDisposableIncomeYoY !== null
                ? `${matrix.production.realDisposableIncomeYoY.toFixed(1)}% YoY`
                : "N/A"
            }
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="jv-strip-title" style={{ marginBottom: 0 }}>
            4. Purchasing Power &amp; Inflation
          </div>
          <ResearchGlossaryTerm term="marginPressure">
            <ConditionBadge text={matrix.inflation.marginPressure} />
          </ResearchGlossaryTerm>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatCard
            label="CPI YoY"
            value={matrix.inflation.cpiYoY !== null ? `${matrix.inflation.cpiYoY.toFixed(1)}%` : "N/A"}
          />
          <StatCard
            label="PPI YoY"
            value={matrix.inflation.ppiYoY !== null ? `${matrix.inflation.ppiYoY.toFixed(1)}%` : "N/A"}
          />
          <StatCard
            label="Real GDP YoY"
            value={matrix.inflation.realGdpYoY !== null ? `${matrix.inflation.realGdpYoY.toFixed(1)}%` : "N/A"}
          />
        </div>
      </section>
    </div>
  ) : null;

  const sectorGroupsContent = sectorError ? (
    <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
      <div className="font-medium">Could not load live data</div>
      <div className="text-sm mt-1">{sectorError}</div>
    </div>
  ) : sector ? (
    <div className="flex flex-col gap-10">
      <div className="jv-verdict-panel">
        <div className="jv-vp-label">
          <span className="jv-dot" aria-hidden="true" />
          Cyclical bargain screen
        </div>
        <h3>
          {sector.cyclicalBargainCandidates.length > 0
            ? sector.cyclicalBargainCandidates.join(", ")
            : "No cyclical bargain candidates flagged"}
        </h3>
        <p>
          Industry groups running meaningfully below their long-run capacity utilization. Classic value
          read: worth screening for asset-rich, low-leverage names trading near liquidation value &mdash;
          but this alone doesn&apos;t confirm balance sheet strength (see gaps below).
        </p>
      </div>

      <section>
        <div className="jv-strip-title">Industry Groups &mdash; Production &amp; Capacity</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sector.industryGroups.map((g) => (
            <div key={g.id} className="jv-card">
              <div className="jv-br-b" />
              <div className="flex items-center justify-between mb-2">
                <div className="jv-label" style={{ marginBottom: 0 }}>
                  {g.label}
                </div>
                <span className="jv-badge c-neutral">{g.classification}</span>
              </div>
              <div className="jv-stat">
                <span>Capacity util.</span>
                <b>
                  {g.capacityUtilization.value.toFixed(1)}% (avg ~{g.capacityUtilizationLongRunAvg}%)
                </b>
              </div>
              <div className="jv-stat">
                <span>Industrial production</span>
                <b>{g.industrialProductionYoY !== null ? `${g.industrialProductionYoY.toFixed(1)}% YoY` : "N/A"}</b>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="jv-strip-title">Supply &amp; Demand</div>
        <div className="jv-card" style={{ maxWidth: 360 }}>
          <div className="jv-label">{sector.inventoryToSales.totalBusiness.label}</div>
          <div className="jv-cond c-neutral" style={{ fontSize: 20 }}>
            {sector.inventoryToSales.totalBusiness.value.toFixed(2)}
          </div>
          <div className="text-xs" style={{ color: "var(--text-2)" }}>
            {sector.inventoryToSales.note}
          </div>
        </div>
      </section>

      <section>
        <div className="jv-strip-title">Not Yet Available</div>
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
          These require a company-fundamentals or ratings data source beyond FRED. Listed explicitly
          rather than faked.
        </p>
        <div className="flex flex-col gap-2">
          {sector.unavailable.map((m) => (
            <div key={m.label} className="jv-card" style={{ borderStyle: "dashed" }}>
              <div className="jv-br-b" />
              <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                {m.label}
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                {m.note}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <AppNavigationProvider>
    <NavScope>
      <PaletteHost />
    </NavScope>
    <OnboardingWizard />
    <FayeChatWidget labHref={process.env.NEXT_PUBLIC_FAYE_LAB_HREF === "/faye-lab" ? "/faye-lab" : undefined} />
    <div className="min-h-screen">
      <main className="mx-auto max-w-4xl px-3 sm:px-6 py-8 sm:py-12">
        <Tabs
          navLevel="primary"
          tabs={[
            {
              id: "top-down",
              label: "Research Agent",
              content: (
                <div>
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">Research Agent</div>
                      <h1 className="text-2xl font-semibold tracking-tight mt-1">Research Agent</h1>
                    </div>
                    <HelpMenu agentId="top-down" />
                  </div>
                  <Tabs
                    size="secondary"
                    navLevel="secondary"
                    navParentId="top-down"
                    tabs={[
                    {
                      id: "macro",
                      label: "Macro",
                      content: (
                        <div className="jarvis">
                          <p className="jv-eyebrow">Layer 1 &middot; Macro Agent</p>
                          <h1 className="jv-title">Macro-Margin Matrix</h1>
                          <p className="jv-lede">
                            A classic value-style read on systemic stability and
                            normalized earning power &mdash; not a market
                            forecast.
                          </p>
                          <Tabs
                            size="tertiary"
                            theme="jarvis"
                            navLevel="tertiary"
                            navParentId="macro"
                            tabs={[
                              { id: "dashboard", label: "Dashboard", content: <MacroDashboardTab /> },
                              { id: "stance", label: "Stance & Details", content: macroStanceContent },
                              { id: "industry", label: "Industry Impact", content: <IndustryImpactTab /> },
                              { id: "global-news", label: "Global News", content: <GlobalFinancialNewsTab /> },
                              { id: "economic-outlook", label: "Economic Outlook", content: <EconomicOutlookTab /> },
                              { id: "fomc-reaction", label: "FOMC Reaction Study", content: <FomcReactionStudyTab /> },
                              { id: "fomc-week-variance", label: "FOMC Week Variance", content: <FomcWeekVarianceTab /> },
                              { id: "catalyst-calendar", label: "Catalyst Calendar", content: <CatalystCalendarTab /> },
                            ]}
                          />
                        </div>
                      ),
                    },
                    {
                      id: "sector",
                      label: "Sector",
                      content: (
                        <div className="jarvis">
                          <p className="jv-eyebrow">Layer 2 &middot; Sector Agent</p>
                          <h1 className="jv-title">Sector-Selection Matrix</h1>
                          <p className="jv-lede">
                            Structural stability and supply/demand
                            equilibrium by industry group &mdash; screening
                            candidates, not verdicts.
                          </p>
                          <Tabs
                            size="tertiary"
                            theme="jarvis"
                            tabs={[
                              { id: "groups", label: "Industry Groups", content: sectorGroupsContent },
                              {
                                id: "fundamentals",
                                label: "Sector Fundamentals",
                                content: <SectorFundamentalsTab />,
                              },
                              {
                                id: "recommendations",
                                label: "Sector Recommendations",
                                content: <SectorRecommendationsTab />,
                              },
                              {
                                id: "stock-picks",
                                label: "Sector Stock Picks",
                                content: <SectorStockAnalysisTab />,
                              },
                              {
                                id: "sources",
                                label: "Research Sources",
                                content: <ResearchSourcesTab />,
                              },
                            ]}
                          />
                        </div>
                      ),
                    },
                    {
                      id: "security",
                      label: "Security Analysis",
                      content: (
                        <div className="jarvis">
                          <p className="jv-eyebrow">Layer 3 &middot; Security Analyst</p>
                          <h1 className="jv-title">Value Checklist</h1>
                          <Tabs
                            size="tertiary"
                            theme="jarvis"
                            tabs={[
                              { id: "analyze", label: "Analyze Ticker", content: <SecurityAnalystTab /> },
                              { id: "phase", label: "Business Phase", content: <BusinessPhaseTab /> },
                              { id: "watchlist", label: "Watchlist", content: <ResearchWatchlistTab /> },
                              { id: "screener", label: "Screener", content: <ScreenerTab /> },
                            ]}
                          />
                        </div>
                      ),
                    },
                    ]}
                  />
                </div>
              ),
            },
            {
              id: "trading",
              label: "Trading Agent",
              content: (
                <div>
                <div className="mb-6 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">Trading Agent</div>
                    <h1 className="text-2xl font-semibold tracking-tight mt-1">Trading Agent</h1>
                  </div>
                  <HelpMenu agentId="trading" />
                </div>
                <Tabs
                  size="secondary"
                  navLevel="secondary"
                  navParentId="trading"
                  mobileDropdown
                  ariaLabel="Trading sections"
                  tabs={[
                    {
                      id: "guided-signals",
                      label: "Guided Signals",
                      content: <GuidedTradeSignalsTab />,
                    },
                    {
                      id: "studies",
                      label: "Studies",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Studies
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Studies</h1>
                          <NavScope>
                            <StudiesTab />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "news-hub",
                      label: "News",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; News
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">News</h1>
                          <NavScope>
                            <NewsHubTab />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "equities",
                      label: "Equities",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Equities
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Equities</h1>
                          <NavScope>
                            <AssetGroupWorkspace groupId="equities" />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "bonds",
                      label: "Bonds",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Bonds
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Bonds</h1>
                          <NavScope>
                            <AssetGroupWorkspace groupId="bonds" />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "options",
                      label: "Options",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Options
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Options</h1>
                          <NavScope>
                            <AssetGroupWorkspace groupId="options" />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "currency",
                      label: "Currency",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Currency
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Currency</h1>
                          <NavScope>
                            <AssetGroupWorkspace groupId="currency" />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "futures",
                      label: "Futures",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Futures
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Futures</h1>
                          <NavScope>
                            <AssetGroupWorkspace groupId="futures" />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "commodities",
                      label: "Commodities",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Commodities
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Commodities</h1>
                          <NavScope>
                            <AssetGroupWorkspace groupId="commodities" />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "crypto",
                      label: "Crypto",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Crypto
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Crypto</h1>
                          <NavScope>
                            <AssetGroupWorkspace groupId="crypto" />
                          </NavScope>
                        </div>
                      ),
                    },
                    {
                      id: "glossary",
                      label: "Glossary",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Glossary
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Glossary</h1>
                          <GlossaryTab />
                        </div>
                      ),
                    },
                    {
                      id: "alerts",
                      label: "Alerts",
                      content: <AlertsSubscribeTab />,
                    },
                    {
                      id: "paper-trading",
                      label: "Paper Trading",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Paper Trading
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Paper Trading</h1>
                          <PaperTradingTab />
                        </div>
                      ),
                    },
                    {
                      id: "strategy-ledger",
                      label: "Strategy Ledger",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Strategy Ledger
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Strategy Ledger</h1>
                          <StrategyLedgerTab />
                        </div>
                      ),
                    },
                    {
                      id: "trade-journal",
                      label: "Trade Journal",
                      content: (
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                            Trading Agent &middot; Trade Journal
                          </div>
                          <h1 className="text-2xl font-semibold tracking-tight mt-1 mb-6">Trade Journal</h1>
                          <TradeJournalTab />
                        </div>
                      ),
                    },
                  ]}
                />
                </div>
              ),
            },
            {
              id: "portfolio",
              label: "Portfolio Tracking Agent",
              content: (
                <div>
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">Portfolio Tracker</div>
                      <h1 className="text-2xl font-semibold tracking-tight mt-1">Portfolio Tracker</h1>
                    </div>
                    <HelpMenu agentId="portfolio" />
                  </div>
                  <Tabs
                    size="secondary"
                    mobileDropdown
                    navLevel="secondary"
                    navParentId="portfolio"
                    tabs={[
                      { id: "dashboard", label: "Dashboard", content: <PortfolioDashboardTab /> },
                      { id: "traditional", label: "Traditional", content: <TraditionalPortfolioTab /> },
                      { id: "modern", label: "Modern Portfolio Theory", content: <ModernPortfolioTab /> },
                      { id: "correlation", label: "Correlation Finder", content: <CorrelationFinderTab /> },
                      { id: "scenario", label: "Scenario Simulation", content: <ScenarioSimulationTab /> },
                      { id: "rebalancing", label: "Risk & Rebalancing", content: <RebalancingTab /> },
                      { id: "retirement", label: "401(k) Optimizer", content: <RetirementPlanTab /> },
                      { id: "guide", label: "Methodology Guide", content: <PortfolioMethodologyTab /> },
                    ]}
                  />
                </div>
              ),
            },
            {
              id: "literacy",
              label: "Financial Literacy",
              content: (
                <div>
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">Financial Literacy</div>
                      <h1 className="text-2xl font-semibold tracking-tight mt-1">Financial Literacy</h1>
                    </div>
                    <HelpMenu agentId="literacy" />
                  </div>
                  <FinancialLiteracyTab />
                </div>
              ),
            },
            {
              id: "assistant",
              label: "Assistant",
              content: (
                <div>
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">Assistant</div>
                      <h1 className="text-2xl font-semibold tracking-tight mt-1">Assistant</h1>
                    </div>
                    <HelpMenu agentId="assistant" />
                  </div>
                  <AssistantChatTab />
                </div>
              ),
            },
          ]}
        />
      </main>
    </div>
    </AppNavigationProvider>
  );
}
