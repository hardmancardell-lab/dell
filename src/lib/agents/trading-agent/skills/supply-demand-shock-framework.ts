// Static reference content, same pattern as currency-drivers.ts/options-strategies.ts
// — a real, structured taxonomy of classic supply/demand shock categories
// per asset class, written in the requested PhD-economist voice. Not a
// live model; the live half of this feature (portfolio-shock-scan.ts)
// cross-references real, already-fetched news-spike data against this
// framework's categories.

export interface ShockCategory {
  category: string;
  description: string;
  realExamples: string[];
}

export interface AssetClassShockFramework {
  assetClass: string;
  categories: ShockCategory[];
}

export const SUPPLY_DEMAND_SHOCK_FRAMEWORK: AssetClassShockFramework[] = [
  {
    assetClass: "Equities",
    categories: [
      {
        category: "Earnings/guidance shocks",
        description: "A firm-specific demand-side surprise — reported results or forward guidance diverge sharply from consensus expectations, repricing the stock's expected future cash flows.",
        realExamples: ["Quarterly earnings beats/misses vs. consensus", "Guidance cuts/raises", "Unexpected margin compression from input costs"],
      },
      {
        category: "Capacity/supply shocks",
        description: "A shock to the firm's or its sector's ability to produce — plant outages, supply-chain disruption, or regulatory shutdowns constrain output regardless of demand.",
        realExamples: ["Factory fires/outages", "Chip shortages constraining production", "Regulatory plant shutdowns"],
      },
    ],
  },
  {
    assetClass: "Commodities",
    categories: [
      {
        category: "Supply shocks",
        description: "A change in the physical quantity available to the market — production decisions, weather, or geopolitical disruption to supply chains.",
        realExamples: ["OPEC+ production quota changes", "Weather-driven crop failures/bumper harvests", "Mine strikes or shipping-lane disruptions (e.g. a canal blockage)", "Strategic reserve releases or purchases"],
      },
      {
        category: "Demand shocks",
        description: "A change in consumption intentions — industrial activity, substitution effects, or seasonal demand swings.",
        realExamples: ["Chinese manufacturing PMI surprises (industrial metals)", "Unseasonable weather shifting energy demand", "Substitution toward/away from a commodity on price"],
      },
    ],
  },
  {
    assetClass: "Currencies",
    categories: [
      {
        category: "Monetary policy shocks",
        description: "A surprise central-bank action or communication — the single most direct lever on a currency's relative yield attractiveness.",
        realExamples: ["Surprise rate hikes/cuts vs. consensus", "Unscheduled emergency policy statements", "Shifts in forward guidance language"],
      },
      {
        category: "Capital flow / balance-of-payments shocks",
        description: "A shift in cross-border capital movement — trade balance surprises, sudden capital flight, or shifts in foreign reserve allocation.",
        realExamples: ["Trade balance data surprises", "Sovereign credit rating changes", "Large sovereign-wealth-fund reserve reallocations"],
      },
    ],
  },
  {
    assetClass: "Bonds / Rates",
    categories: [
      {
        category: "Monetary and fiscal policy shocks",
        description: "Central bank rate decisions and government borrowing/spending surprises directly reprice the yield curve.",
        realExamples: ["FOMC rate decisions and dot-plot shifts", "Unexpected fiscal stimulus or austerity announcements", "Treasury issuance-size surprises"],
      },
      {
        category: "Flight-to-quality shocks",
        description: "A shift in risk appetite that moves demand for safe-haven government debt independent of the policy rate itself.",
        realExamples: ["Equity market selloffs driving bond-buying", "Geopolitical crises", "Banking-sector stress events"],
      },
    ],
  },
];

export function getShockFrameworkForAssetClass(assetClass: string): AssetClassShockFramework | null {
  return SUPPLY_DEMAND_SHOCK_FRAMEWORK.find((f) => f.assetClass.toLowerCase().includes(assetClass.toLowerCase())) ?? null;
}
