// Pure, zero-dependency — same client-safe pattern as timeframe-presets.ts,
// deliberately kept out of forex-rates.ts (which transitively imports
// market-data.ts -> schwab.ts -> node:fs) so client components can import
// this list without pulling server-only code into the browser bundle.

// The 6 pairs already seeded in geopolitical-news.ts's MAJOR_PAIR_KEYWORDS,
// plus 4 more to round out a standard top-10-most-traded list (BIS Triennial
// Survey convention).
export const TOP_TRADED_PAIRS: string[] = [
  "EUR/USD",
  "USD/JPY",
  "GBP/USD",
  "USD/CHF",
  "AUD/USD",
  "USD/CAD",
  "NZD/USD",
  "USD/CNH",
  "EUR/GBP",
  "EUR/JPY",
];
