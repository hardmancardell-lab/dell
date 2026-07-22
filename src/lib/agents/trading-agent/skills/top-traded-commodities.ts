// Pure, zero-dependency — same client-safe pattern as top-traded-pairs.ts,
// deliberately kept out of commodity-rates.ts (which transitively imports
// market-data.ts -> schwab.ts -> node:fs) so client components can import
// this list without pulling server-only code into the browser bundle.

// Real, liquid ETF proxies — no free source exists for literal commodity
// futures contracts, but these trade as regular equities on Alpaca and
// track the same underlying commodities (see ALPACA_INTEGRATION_NOTES.md
// item 7). One ticker per major commodity category: precious metals,
// energy, industrial metals, and agriculture.
export const TOP_TRADED_COMMODITIES: string[] = [
  "GLD", // Gold
  "SLV", // Silver
  "USO", // Crude Oil
  "UNG", // Natural Gas
  "DBA", // Agriculture (broad)
  "CPER", // Copper
  "PPLT", // Platinum
  "PALL", // Palladium
  "WEAT", // Wheat
  "CORN", // Corn
];
