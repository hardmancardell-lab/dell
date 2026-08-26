import { getDailyBars } from "./daily-bars";
import { correlation } from "../stats";
import { benjaminiHochberg } from "./stats-tests";
import { normCdf } from "../black-scholes";

const MIN_OVERLAPPING_DAYS = 30;
const FDR_ALPHA = 0.05;

// A deliberately cross-asset default universe — same rationale as
// correlation-finder.ts's DEFAULT_CORRELATION_CANDIDATES (spans commodities,
// rates, sectors, volatility, USD) — plus SPY as the market benchmark and
// the 3 individual names discussed earlier this session (INTC/XOM/CRM), so
// "out of all pairs" has real breadth across asset classes, not just
// same-sector names that would trivially correlate.
export const DEFAULT_MATRIX_UNIVERSE = [
  "SPY", "GLD", "TLT", "XLU", "XLP", "XLE", "XLF", "XLK", "VIXY", "USO", "UUP", "INTC", "XOM", "CRM",
];

export interface SymbolHistoryDepth {
  symbol: string;
  firstDateKey: string | null;
  lastDateKey: string | null;
  barCount: number;
  error: string | null;
}

export interface PairCorrelationEntry {
  symbolA: string;
  symbolB: string;
  correlation: number | null;
  sampleSize: number;
  pValue: number | null;
  pValueFdrAdjusted: number | null;
  significantAfterFdr: boolean;
  error: string | null;
}

export interface CorrelationMatrixResult {
  symbols: string[];
  requestedLookbackYears: number;
  actualHistoryBySymbol: SymbolHistoryDepth[];
  pairsByCorrelation: PairCorrelationEntry[]; // most negative first
  mostSignificantPairs: PairCorrelationEntry[]; // lowest FDR-adjusted p first, ties by |r|
  dataLimitations: string[];
}

/** Fisher z-transform two-tailed p-value for a sample correlation against H0: rho=0 — reuses black-scholes.ts's already-validated normCdf, same "documented approximation" convention as stats-tests.ts's zTestPValue. */
function fisherCorrelationPValue(r: number, n: number): number | null {
  if (n < 4 || r <= -1 || r >= 1) return null;
  const z = Math.atanh(r);
  const se = 1 / Math.sqrt(n - 3);
  const stat = z / se;
  return 2 * (1 - normCdf(Math.abs(stat)));
}

export async function getCorrelationMatrix(symbols: string[], lookbackYears: number): Promise<CorrelationMatrixResult> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (unique.length < 2) throw new Error("At least 2 symbols are required.");
  const lookbackDays = Math.round(lookbackYears * 365.25);

  const dataLimitations: string[] = [
    `Requested ${lookbackYears} years of lookback. Actual usable history depends on both the data provider's real depth and each instrument's inception date (several of these ETFs are younger than 30 years) — see actualHistoryBySymbol for what was really available per symbol, not assumed.`,
    "Pairwise correlation significance uses a Fisher z-transform p-value, corrected for multiple comparisons via Benjamini-Hochberg FDR across every pair tested in this run (same discipline used throughout this app's backtest engines) — a pair can look extreme by raw p-value alone and still fail once corrected for testing this many pairs at once.",
  ];

  const seriesResults = await Promise.all(
    unique.map(async (symbol) => {
      try {
        const bars = await getDailyBars(symbol, lookbackDays);
        const returnsByDate = new Map<string, number>();
        for (let i = 1; i < bars.length; i++) {
          const prevClose = bars[i - 1].close;
          if (prevClose === 0) continue;
          returnsByDate.set(bars[i].dateKey, (bars[i].close - prevClose) / prevClose);
        }
        const dateKeys = [...returnsByDate.keys()].sort();
        return {
          symbol,
          returnsByDate,
          firstDateKey: dateKeys[0] ?? null,
          lastDateKey: dateKeys[dateKeys.length - 1] ?? null,
          barCount: bars.length,
          error: null as string | null,
        };
      } catch (error) {
        return {
          symbol,
          returnsByDate: new Map<string, number>(),
          firstDateKey: null,
          lastDateKey: null,
          barCount: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    })
  );

  const bySymbol = new Map(seriesResults.map((s) => [s.symbol, s]));

  const rawPairs: {
    symbolA: string;
    symbolB: string;
    correlation: number | null;
    sampleSize: number;
    pValue: number | null;
    error: string | null;
  }[] = [];

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = bySymbol.get(unique[i])!;
      const b = bySymbol.get(unique[j])!;
      if (a.error || b.error) {
        rawPairs.push({ symbolA: a.symbol, symbolB: b.symbol, correlation: null, sampleSize: 0, pValue: null, error: a.error ?? b.error });
        continue;
      }
      const commonDates = [...a.returnsByDate.keys()].filter((d) => b.returnsByDate.has(d));
      if (commonDates.length < MIN_OVERLAPPING_DAYS) {
        rawPairs.push({
          symbolA: a.symbol,
          symbolB: b.symbol,
          correlation: null,
          sampleSize: commonDates.length,
          pValue: null,
          error: `Only ${commonDates.length} overlapping trading day(s) — below the ${MIN_OVERLAPPING_DAYS}-day reliability floor.`,
        });
        continue;
      }
      const aSeries = commonDates.map((d) => a.returnsByDate.get(d) as number);
      const bSeries = commonDates.map((d) => b.returnsByDate.get(d) as number);
      const r = correlation(aSeries, bSeries);
      const p = r !== null ? fisherCorrelationPValue(r, commonDates.length) : null;
      rawPairs.push({ symbolA: a.symbol, symbolB: b.symbol, correlation: r, sampleSize: commonDates.length, pValue: p, error: null });
    }
  }

  const validForFdr = rawPairs.filter((p) => p.pValue !== null);
  const fdrAdjusted = benjaminiHochberg(validForFdr.map((p) => p.pValue as number));
  const fdrMap = new Map<string, number>();
  validForFdr.forEach((p, idx) => fdrMap.set(`${p.symbolA}|${p.symbolB}`, fdrAdjusted[idx]));

  const pairs: PairCorrelationEntry[] = rawPairs.map((p) => {
    const fdrP = fdrMap.get(`${p.symbolA}|${p.symbolB}`) ?? null;
    return {
      ...p,
      pValueFdrAdjusted: fdrP,
      significantAfterFdr: fdrP !== null && fdrP < FDR_ALPHA,
    };
  });

  const pairsByCorrelation = [...pairs].sort((x, y) => {
    if (x.correlation === null && y.correlation === null) return 0;
    if (x.correlation === null) return 1;
    if (y.correlation === null) return -1;
    return x.correlation - y.correlation; // most negative first
  });

  const mostSignificantPairs = [...pairs]
    .filter((p) => p.pValueFdrAdjusted !== null)
    .sort((x, y) => (x.pValueFdrAdjusted as number) - (y.pValueFdrAdjusted as number) || Math.abs(y.correlation ?? 0) - Math.abs(x.correlation ?? 0));

  if (unique.length < DEFAULT_MATRIX_UNIVERSE.length + 1) {
    dataLimitations.push(`${unique.length} symbols scanned (${pairs.length} pairs) — a chosen cross-asset sample, not literally "all" tradable instruments.`);
  }

  return {
    symbols: unique,
    requestedLookbackYears: lookbackYears,
    actualHistoryBySymbol: seriesResults.map((s) => ({
      symbol: s.symbol,
      firstDateKey: s.firstDateKey,
      lastDateKey: s.lastDateKey,
      barCount: s.barCount,
      error: s.error,
    })),
    pairsByCorrelation,
    mostSignificantPairs,
    dataLimitations,
  };
}
