import { fetchReturnsFor } from "./portfolio-analytics";
import { correlation } from "../stats";
import type { CorrelationFinderResult } from "../types";

/**
 * "Find a stock that negatively correlates with X" — a direct, reusable
 * version of the ad-hoc analysis done manually via the Modern Portfolio
 * Theory engine's raw API. Deliberately doesn't touch portfolio-storage.ts
 * (no shares/cost-basis needed for correlation, and this shouldn't write
 * test symbols into a user's real holdings).
 */

const LOOKBACK_DAYS = 395; // ~1yr + buffer, matches portfolio-analytics.ts
const MIN_OVERLAPPING_DAYS = 30;

// A deliberately cross-asset-class default set — other mega-cap tech names
// would just come back positively correlated with almost anything, which
// isn't useful as a default. Spans commodities, rates, defensive equity
// sectors, and volatility so a first run without custom candidates still
// says something real.
export const DEFAULT_CORRELATION_CANDIDATES = [
  "GLD", // gold
  "TLT", // long-term Treasuries
  "XLU", // utilities
  "XLP", // consumer staples
  "XLE", // energy
  "XLF", // financials
  "XLK", // technology (as a same-sector control — usually strongly positive)
  "VIXY", // volatility
  "USO", // oil
  "UUP", // US dollar index
];

export async function findCorrelations(baseSymbol: string, candidateSymbols: string[]): Promise<CorrelationFinderResult> {
  const base = baseSymbol.trim().toUpperCase();
  if (!base) throw new Error("A base ticker is required.");

  const uniqueCandidates = [...new Set(candidateSymbols.map((c) => c.trim().toUpperCase()).filter(Boolean))].filter(
    (c) => c !== base
  );
  if (uniqueCandidates.length === 0) {
    throw new Error("No candidate symbols to compare against (they can't just be the base ticker itself).");
  }

  const dataLimitations: string[] = [
    `Correlation uses ~1 year of daily returns (n<${MIN_OVERLAPPING_DAYS} treated as unreliable) — same short-history caveat as the Modern Portfolio Theory tab.`,
    "A negative correlation here is an observed statistical relationship over this specific lookback window, not a structural or causal one — single-name correlations especially can and do shift across periods, since company-specific events at the candidate have nothing to do with the base ticker.",
  ];

  const [baseReturns, ...candidateReturns] = await Promise.all([
    fetchReturnsFor(base),
    ...uniqueCandidates.map(fetchReturnsFor),
  ]);

  if (baseReturns.error) {
    throw new Error(`Could not fetch data for ${base}: ${baseReturns.error}`);
  }

  const results = candidateReturns.map((c) => {
    if (c.error) {
      return { symbol: c.symbol, correlation: null, sampleSize: 0, error: c.error };
    }
    const commonDates = [...c.returnsByDate.keys()].filter((d) => baseReturns.returnsByDate.has(d));
    if (commonDates.length < MIN_OVERLAPPING_DAYS) {
      return {
        symbol: c.symbol,
        correlation: null,
        sampleSize: commonDates.length,
        error: `Only ${commonDates.length} overlapping trading day(s) with ${base} — insufficient for a reliable correlation.`,
      };
    }
    const baseSeries = commonDates.map((d) => baseReturns.returnsByDate.get(d) as number);
    const candSeries = commonDates.map((d) => c.returnsByDate.get(d) as number);
    return {
      symbol: c.symbol,
      correlation: correlation(baseSeries, candSeries),
      sampleSize: commonDates.length,
      error: null,
    };
  });

  results.sort((a, b) => {
    if (a.correlation === null && b.correlation === null) return 0;
    if (a.correlation === null) return 1;
    if (b.correlation === null) return -1;
    return a.correlation - b.correlation; // most negative first
  });

  return { baseSymbol: base, lookbackDays: LOOKBACK_DAYS, results, dataLimitations };
}
