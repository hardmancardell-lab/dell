// Pure, zero-dependency — same client-safe pattern as top-traded-pairs.ts.

// No free source exists anywhere for literal futures-contract data (CME's
// own API is pay-per-use; every third-party vendor — Databento, Massive,
// dxFeed — requires a paid plan; researched exhaustively). These are real,
// live ETF proxies for the underlying exposure a futures desk would
// actually watch — equity index, rates, energy, metals, agriculture — not
// the futures contracts themselves. Broader than top-traded-commodities.ts
// (which is pure raw materials) since futures markets also cover equity
// indices and interest rates.
export const TOP_TRADED_FUTURES_PROXIES: string[] = [
  "SPY", // S&P 500 (/ES proxy)
  "QQQ", // Nasdaq 100 (/NQ proxy)
  "DIA", // Dow Jones (/YM proxy)
  "IWM", // Russell 2000 (/RTY proxy)
  "TLT", // 20+ Year Treasury (/ZB proxy)
  "GLD", // Gold (/GC proxy)
  "USO", // Crude Oil (/CL proxy)
  "SLV", // Silver (/SI proxy)
  "UNG", // Natural Gas (/NG proxy)
  "DBA", // Agriculture (/ZC, /ZW proxy)
];
