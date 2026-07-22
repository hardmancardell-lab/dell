export interface ResearchSource {
  name: string;
  description: string;
}

export interface ResearchSourceCategory {
  id: string;
  title: string;
  intro: string;
  sources: ResearchSource[];
}

export const RESEARCH_SOURCE_CATEGORIES: ResearchSourceCategory[] = [
  {
    id: "regulatory",
    title: "1. Primary Regulatory & Corporate Sources",
    intro:
      "Graham's discipline: the truth about a sector is in the audited numbers, not the management narrative.",
    sources: [
      {
        name: "SEC EDGAR (10-K, 10-Q, 8-K Filings)",
        description:
          "You cannot understand an industry without aggregating the financial statements of its top 5-10 players. Look specifically at Item 1 (Business Overview) and Item 7 (MD&A) — where companies are legally required to disclose structural threats, supply chain dependencies, and pricing power dynamics.",
      },
      {
        name: "Aggregated Sector Proxies (S&P 500 Sector Indexes)",
        description:
          "S&P Dow Jones Indices publishes historical accounting data (earnings, book value, cash flows) aggregated at the sector and sub-industry level — enough to compute a Sector CAPE ratio and see whether an entire industry's valuation is stretched relative to its 10-year baseline.",
      },
    ],
  },
  {
    id: "macro-aggregators",
    title: "2. Macroeconomic & Industrial Production Aggregators",
    intro:
      "An economic moat can be eroded if the industry's secular macro-dynamics shift. These sources give raw data on physical output, inventory cycles, and utilization.",
    sources: [
      {
        name: "Federal Reserve Board (G.17 Release)",
        description:
          "The definitive source for Industrial Production and Capacity Utilization, broken down by market group (automotive, high-tech, utilities, etc.). A structural decline in a sector's capacity utilization is an immediate warning sign of overcapacity and impending margin compression. Already wired into this app's Industry Groups sub-tab.",
      },
      {
        name: "U.S. Census Bureau (M3 Survey)",
        description:
          "Manufacturers' Shipments, Inventories, and Orders — real-time Inventory-to-Sales ratios by industry. A sudden spike in sector-wide inventories means companies will soon be forced to cut prices, destroying short-term earning power. Already wired in via the Inventory-to-Sales metric in Industry Groups.",
      },
      {
        name: "Bureau of Labor Statistics (PPI by industry)",
        description:
          "PPI splits inflation data down to specific industry inputs (chemical manufacturing, steel fabrication, etc.). Comparing an industry's PPI (input costs) to its consumer pricing metrics lets you mathematically track sector-wide margin expansion or compression.",
      },
    ],
  },
  {
    id: "credit-monitors",
    title: "3. Structural Credit & Capital Allocation Monitors",
    intro:
      "Credit markets are more disciplined than equity markets. Watching where capital moves — and at what cost — reveals a sector's true structural stability before it shows up in earnings.",
    sources: [
      {
        name: "Fixed Income Indexes (ICE BofA Sector Bond Spreads)",
        description:
          "Option-Adjusted Spreads (OAS) across specific sector corporate bonds (e.g. High-Yield Energy vs. Investment-Grade Tech). Widening spreads in a specific sector mean bond investors are pricing in higher default risk — signaling structural distress long before it shows up in trailing equity earnings.",
      },
      {
        name: "NAREIT (National Association of REITs)",
        description:
          "Granular, institutional data on Funds From Operations (FFO) and occupancy trends for real estate — the REIT-specific equivalent of an earnings report.",
      },
      {
        name: "FDIC Quarterly Banking Profile",
        description:
          "Aggregate data on Net Interest Margin (NIM), Tier 1 Capital ratios, and non-performing loan allocations across the entire financial system — the banking-specific equivalent of an industry census.",
      },
    ],
  },
  {
    id: "academic",
    title: "4. Academic Journals & Quantitative Research Engines",
    intro:
      "Security Analysis was essentially the first rigorous textbook in empirical corporate finance. Peer-reviewed literature carries that tradition forward for modern sub-sectors.",
    sources: [
      {
        name: "The Journal of Finance, Journal of Financial Economics, Review of Financial Studies",
        description:
          "Empirical studies on factor anomalies, industry asset-pricing models, and cross-sectional returns — the mathematical proof behind, e.g., why software companies command structural valuation premiums or how bank capital regulations affect loan pricing.",
      },
      {
        name: "SSRN & NBER Working Papers",
        description:
          "Repositories hosting research before formal peer review — where you find cutting-edge work on modern sub-sectors (AI capex productivity, systemic risk in private credit markets, etc.) years before it reaches a textbook.",
      },
    ],
  },
  {
    id: "trade-journals",
    title: "5. Specialized Industry Trade Journals",
    intro:
      "Buffett reads trade publications because they reveal operational bottlenecks and raw industry economics long before Wall Street analysts notice.",
    sources: [
      {
        name: "American Banker / The Geneva Papers on Risk and Insurance",
        description: "Regulatory capital constraints and underwriting cycles for banking and insurance.",
      },
      {
        name: "IEEE Spectrum / DigiTimes / SemiAnalysis",
        description:
          "Supply-chain intelligence for tech, semiconductors, and hardware — lithography bottlenecks and wafer fabrication yields, the physical reality behind a chipmaker's margin of safety.",
      },
      {
        name: "Platts (S&P Global Commodity Insights) / IEA reports",
        description:
          "Exact structural spreads (refining margins, storage capacities) that dictate energy, utility, and commodity sectors' normalized earning power.",
      },
    ],
  },
  {
    id: "institutional",
    title: "6. Elite Professional Newsletters & Institutional Briefings",
    intro:
      "Wall Street sell-side research is often compromised by investment-banking conflicts of interest. Independent macro strategists and central bank research avoid that bias.",
    sources: [
      {
        name: "Regional Federal Reserve Bank Research (St. Louis, NY, Kansas City, etc.)",
        description:
          "High-quality, objective economic briefs on industry-specific impacts — e.g. how the agricultural sector is handling commercial debt service.",
      },
      {
        name: "Boutique Independent Macro Research (Institutional Risk Analyst, Gavekal, BCA Research)",
        description:
          "Deep dives into banking-system plumbing, mortgage finance, and top-tier macro/sector allocation frameworks, without sell-side conflicts.",
      },
      {
        name: "Aswath Damodaran's Data Sheets (NYU Stern)",
        description:
          "Updated every January: ROIC, cost of capital, margins, and growth rates across 100+ industries. The closest modern equivalent to a comprehensive Graham-and-Dodd screening baseline.",
      },
    ],
  },
];

export interface SynthesisRow {
  question: string;
  metric: string;
  source: string;
}

export const SYNTHESIS_TABLE: SynthesisRow[] = [
  {
    question: "Is the sector structurally over-expanding?",
    metric: "CapEx-to-Depreciation Ratio",
    source: "SEC EDGAR (aggregated 10-Ks) — see Sector Fundamentals sub-tab",
  },
  {
    question: "Are industry profit margins under pressure?",
    metric: "Input/Output PPI Spreads",
    source: "Bureau of Labor Statistics",
  },
  {
    question: "Is there a systemic supply glut?",
    metric: "Inventory-to-Sales Ratio",
    source: "U.S. Census Bureau (M3 Survey) — see Industry Groups sub-tab",
  },
  {
    question: "Is the industry facing credit insolvency?",
    metric: "Sector Bond Spreads / Default Rates",
    source: "ICE BofA Fixed Income Indices",
  },
];
