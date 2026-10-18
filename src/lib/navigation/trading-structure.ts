/**
 * The shape of the Trading Agent's navigation: which sections exist, which asset-class group each study lives in, and
 * which tabs are shown directly inside a group. Plain data, shared by page.tsx, the group workspace, the command palette,
 * the route resolver and the reachability test.
 */
import type { AssetClass } from "@/lib/agents/trading-agent/types";

export interface DirectTab {
  /** A registry study id (the tab id is the same string, so URLs stay short). */
  studyId: string;
  label: string;
}

export interface AssetGroup {
  /** The Trading Agent secondary tab id, kept identical to the pre-rework ids so existing links keep working. */
  id: string;
  label: string;
  assetClass: AssetClass;
  /** Shown as tabs inside the group, in order. The first is the group's default view. */
  directTabs: DirectTab[];
}

export const ASSET_GROUPS: AssetGroup[] = [
  { id: "equities", label: "Equities", assetClass: "equity", directTabs: [{ studyId: "charts", label: "Charts" }, { studyId: "dashboard", label: "Dashboard" }] },
  { id: "bonds", label: "Bonds", assetClass: "bond", directTabs: [{ studyId: "charts", label: "Charts" }, { studyId: "dashboard", label: "Overview" }] },
  { id: "options", label: "Options", assetClass: "option", directTabs: [{ studyId: "dashboard", label: "Dashboard" }, { studyId: "trade-options", label: "Trade Options" }] },
  { id: "currency", label: "Currency", assetClass: "forex", directTabs: [{ studyId: "charts", label: "Charts" }, { studyId: "dashboard", label: "Dashboard" }] },
  { id: "futures", label: "Futures", assetClass: "future", directTabs: [{ studyId: "charts", label: "Charts" }, { studyId: "dashboard", label: "Dashboard" }] },
  { id: "commodities", label: "Commodities", assetClass: "commodity", directTabs: [{ studyId: "charts", label: "Charts" }, { studyId: "dashboard", label: "Dashboard" }] },
  {
    id: "crypto",
    label: "Crypto",
    assetClass: "crypto",
    directTabs: [{ studyId: "charts", label: "Charts" }, { studyId: "crypto-regime", label: "Regime" }, { studyId: "crypto-watchlist", label: "Watchlist" }],
  },
];

/** Trading Agent secondary tabs that are not asset-class groups. Each is also a trading-wide registry entry (except "studies"). */
export const TRADING_WIDE_TABS: Array<{ id: string; label: string }> = [
  { id: "guided-signals", label: "Guided Signals" },
  { id: "glossary", label: "Glossary" },
  { id: "alerts", label: "Alerts" },
  { id: "paper-trading", label: "Paper Trading" },
  { id: "strategy-ledger", label: "Strategy Ledger" },
  { id: "trade-journal", label: "Trade Journal" },
];

/** The first-class Studies entry: the whole library across asset classes. */
export const STUDIES_SECTION = { id: "studies", label: "Studies" };

/** Order of the Trading Agent's secondary tab strip. */
export const TRADING_SECTION_ORDER: string[] = [
  "guided-signals",
  STUDIES_SECTION.id,
  ...ASSET_GROUPS.map((g) => g.id),
  "glossary",
  "alerts",
  "paper-trading",
  "strategy-ledger",
  "trade-journal",
];

/** The group's tab that lists the library for that group. */
export const GROUP_STUDIES_TAB = "studies";

export const PRIMARY_TABS: Array<{ id: string; label: string }> = [
  { id: "top-down", label: "Research Agent" },
  { id: "trading", label: "Trading Agent" },
  { id: "portfolio", label: "Portfolio Tracking Agent" },
  { id: "literacy", label: "Financial Literacy" },
  { id: "assistant", label: "Assistant" },
];

/** First secondary tab of each agent (what a Tabs instance shows when nothing else is chosen). Checked against page.tsx by the test. */
export const DEFAULT_SECONDARY: Record<string, string> = {
  "top-down": "macro",
  trading: "guided-signals",
  portfolio: "dashboard",
};

/** Agents whose secondary tabs are addressable by URL and by navigateTo (checked against page.tsx by the test). */
export const SECONDARY_TABS: Record<string, Array<{ id: string; label: string }>> = {
  "top-down": [
    { id: "macro", label: "Macro" },
    { id: "sector", label: "Sector" },
    { id: "security", label: "Security Analysis" },
  ],
  trading: TRADING_SECTION_ORDER.map((id) => {
    const group = ASSET_GROUPS.find((g) => g.id === id);
    const wide = TRADING_WIDE_TABS.find((w) => w.id === id);
    return { id, label: group?.label ?? wide?.label ?? STUDIES_SECTION.label };
  }),
  portfolio: [
    { id: "dashboard", label: "Dashboard" },
    { id: "traditional", label: "Traditional" },
    { id: "modern", label: "Modern Portfolio Theory" },
    { id: "correlation", label: "Correlation Finder" },
    { id: "scenario", label: "Scenario Simulation" },
    { id: "rebalancing", label: "Risk & Rebalancing" },
    { id: "retirement", label: "401(k) Optimizer" },
    { id: "guide", label: "Methodology Guide" },
  ],
};

export function groupForAssetClass(assetClass: AssetClass): AssetGroup | undefined {
  return ASSET_GROUPS.find((g) => g.assetClass === assetClass);
}

export function groupById(id: string | null | undefined): AssetGroup | undefined {
  return id ? ASSET_GROUPS.find((g) => g.id === id) : undefined;
}
