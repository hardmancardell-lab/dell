// Same shape and query-building convention as geopolitical-news.ts's
// MAJOR_PAIR_KEYWORDS — a raw GDELT boolean-OR query string plus a
// human-readable note on why those keywords actually move the ticker.
//
// Confirmed live this session: GDELT's TimelineVol mode rejects a bare
// OR-chain with "Queries containing OR'd terms must be surrounded by ()" —
// every query here wraps the whole OR expression in outer parens, unlike
// MAJOR_PAIR_KEYWORDS (untouched, working, not re-verified against this
// specific requirement).

/** Keyed off the exact sector strings FMP's /profile endpoint returns (same set used by research-agent/skills/sector-fundamentals.ts's SECTOR_CONSTITUENTS). */
export const SECTOR_NEWS_KEYWORDS: Record<string, { query: string; mechanismNote: string }> = {
  "Basic Materials": {
    query: `("raw materials" OR mining OR "commodity prices" OR "industrial metals")`,
    mechanismNote: "Basic materials companies are price-takers on global commodity markets — mining output, tariffs, and input-cost news move them directly.",
  },
  "Communication Services": {
    query: `("media regulation" OR streaming OR "telecom spectrum" OR "content licensing")`,
    mechanismNote: "A mix of media, telecom, and internet platform companies — regulatory action (antitrust, spectrum auctions, content rules) is the dominant sector-wide driver.",
  },
  "Consumer Cyclical": {
    query: `("consumer spending" OR "retail sales" OR "auto sales" OR "discretionary spending")`,
    mechanismNote: "Demand is tied to consumer confidence and disposable income — spending/retail-sales data and recession signals move this sector as a block.",
  },
  "Consumer Defensive": {
    query: `("consumer staples" OR "food prices" OR "grocery inflation")`,
    mechanismNote: "Staples demand is relatively inelastic — input-cost inflation (food, packaging) matters more here than demand shocks.",
  },
  Energy: {
    query: `("oil prices" OR OPEC OR "energy production" OR "natural gas prices")`,
    mechanismNote: "Directly tracks crude and natural gas prices, OPEC+ production decisions, and energy-policy news.",
  },
  "Financial Services": {
    query: `("Federal Reserve" OR "interest rates" OR "bank regulation" OR "credit conditions")`,
    mechanismNote: "Bank/insurer/asset-manager profitability is directly tied to interest-rate policy and credit conditions.",
  },
  Healthcare: {
    query: `("drug pricing" OR "FDA approval" OR "healthcare policy" OR "clinical trial")`,
    mechanismNote: "Regulatory decisions (FDA approvals, drug-pricing policy) and clinical-trial news drive outsized, company-specific moves within this sector.",
  },
  Industrials: {
    query: `("manufacturing PMI" OR "supply chain" OR "industrial production" OR tariffs)`,
    mechanismNote: "Tracks manufacturing activity data, supply-chain disruption news, and tariff policy.",
  },
  "Real Estate": {
    query: `("mortgage rates" OR "housing market" OR "commercial real estate" OR "REIT")`,
    mechanismNote: "Highly sensitive to mortgage/long-term interest rates and housing-market data.",
  },
  Technology: {
    query: `(Technology OR semiconductor OR "AI regulation" OR "big tech antitrust")`,
    mechanismNote: "Semiconductor export controls, AI-related regulation, and antitrust action are the dominant sector-wide news drivers beyond individual earnings.",
  },
  Utilities: {
    query: `("utility regulation" OR "power grid" OR "electricity demand" OR "rate case")`,
    mechanismNote: "A regulated sector — rate-case decisions and grid/demand news matter more than broad market sentiment.",
  },
};

export const FALLBACK_SECTOR_KEYWORDS = {
  query: `("stock market" OR "corporate earnings")`,
  mechanismNote: "No specific sector keyword mapping exists for this ticker's sector — falling back to a generic market-news query.",
};

/** Union of TOP_TRADED_COMMODITIES and TOP_TRADED_FUTURES_PROXIES symbols. */
export const COMMODITY_FUTURES_NEWS_KEYWORDS: Record<string, { query: string; mechanismNote: string }> = {
  GLD: { query: `("gold price" OR "central bank gold reserves" OR "safe haven demand")`, mechanismNote: "Gold is a safe-haven asset — moves on real interest rates, dollar strength, and geopolitical risk." },
  SLV: { query: `("silver price" OR "industrial metals demand")`, mechanismNote: "Silver trades as both a precious and industrial metal — sensitive to both safe-haven flows and manufacturing demand." },
  USO: { query: `("crude oil" OR OPEC OR "oil supply")`, mechanismNote: "Tracks crude oil prices directly — OPEC+ production decisions are the dominant driver." },
  UNG: { query: `("natural gas prices" OR "natural gas supply")`, mechanismNote: "Tracks natural gas prices — weather-driven demand and storage/supply data are the key drivers." },
  DBA: { query: `("agricultural commodity prices" OR "crop yields" OR "food supply")`, mechanismNote: "A broad agricultural-commodity basket — weather and crop-yield news are the dominant drivers." },
  CPER: { query: `("copper price" OR "industrial metals demand" OR "China manufacturing")`, mechanismNote: "Copper is a global-growth bellwether — closely tied to Chinese manufacturing demand." },
  PPLT: { query: `("platinum price" OR "automotive catalytic converter demand")`, mechanismNote: "Platinum demand is heavily tied to automotive catalytic-converter manufacturing." },
  PALL: { query: `("palladium price" OR "automotive catalytic converter demand")`, mechanismNote: "Palladium demand is heavily tied to automotive catalytic-converter manufacturing, similar to platinum." },
  WEAT: { query: `("wheat price" OR "wheat crop" OR "grain exports")`, mechanismNote: "Tracks wheat prices — weather, crop yields, and export-restriction news are the dominant drivers." },
  CORN: { query: `("corn price" OR "corn crop" OR "grain exports")`, mechanismNote: "Tracks corn prices — weather, crop yields, and export-restriction news are the dominant drivers." },
  SPY: { query: `("S&P 500" OR "stock market" OR "Federal Reserve")`, mechanismNote: "Tracks the broad US equity market — Fed policy and macro data are the dominant drivers." },
  QQQ: { query: `("Nasdaq 100" OR "tech stocks" OR "big tech earnings")`, mechanismNote: "Tracks large-cap tech — concentrated in a handful of mega-cap names, so their earnings/regulatory news dominate." },
  DIA: { query: `("Dow Jones" OR "blue chip stocks" OR "industrial earnings")`, mechanismNote: "Tracks large-cap industrial/blue-chip names — broad economic data matters more than any single sector." },
  IWM: { query: `("Russell 2000" OR "small cap stocks" OR "interest rates")`, mechanismNote: "Small caps are more rate-sensitive and domestically focused than large caps — interest-rate policy is a dominant driver." },
  TLT: { query: `("Treasury yields" OR "Federal Reserve" OR "bond market")`, mechanismNote: "Long-duration Treasury bond prices move inversely to long-term interest-rate expectations." },
};
