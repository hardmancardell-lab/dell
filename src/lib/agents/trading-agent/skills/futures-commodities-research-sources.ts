export interface FuturesCommoditiesResearchSource {
  name: string;
  description: string;
}

export interface FuturesCommoditiesResearchCategory {
  id: string;
  title: string;
  intro: string;
  sources: FuturesCommoditiesResearchSource[];
}

// Intentionally lighter than the Currency reference guide (fx-research-sources.ts)
// — this is a starting scaffold, not the finished strategy/signal content the
// Currency guide has. Expand this when the Futures/Commodities tabs are next
// in line to be built out.
export const FUTURES_COMMODITIES_RESEARCH_CATEGORIES: FuturesCommoditiesResearchCategory[] = [
  {
    id: "official-data",
    title: "1. Official Data Sources",
    intro: "Government agencies publishing the physical supply/demand data that ultimately sets futures prices.",
    sources: [
      {
        name: "EIA (U.S. Energy Information Administration)",
        description:
          "Free, no key required — weekly petroleum/natural gas inventory reports, production data, and short-term energy outlooks. The primary driver of near-term oil and gas futures moves.",
      },
      {
        name: "USDA (U.S. Department of Agriculture)",
        description:
          "WASDE (World Agricultural Supply and Demand Estimates) reports and crop progress data — the equivalent inventory/supply reference for grain and soft-commodity futures.",
      },
      {
        name: "USGS (U.S. Geological Survey)",
        description:
          "Mineral commodity summaries covering production and reserves for metals (copper, gold, industrial metals) — the supply-side reference for metals futures.",
      },
    ],
  },
  {
    id: "positioning",
    title: "2. Positioning",
    intro: "Same source as the Currency guide's positioning category, read here for the futures side instead.",
    sources: [
      {
        name: "CFTC Commitment of Traders (COT) Report — Futures side",
        description:
          "Weekly, free, contract-level speculative and commercial positioning — useful for detecting when a commodity or futures trade is already crowded before entering.",
      },
    ],
  },
];
