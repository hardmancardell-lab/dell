import type { FactorPlan, FactorSpec, ImpactAssetClass } from "./types";

/**
 * Which benchmark(s) each asset class is compared with, and why. Pure.
 *
 * Order matters: the first factor is the market-model benchmark for the event study and the first slice in the variance
 * split. Later factors are "beyond the earlier ones" (incremental R-squared).
 */

const SPY: FactorSpec = { symbol: "SPY", label: "the US stock market", short: "Stock market" };
const BTC: FactorSpec = { symbol: "BTC-USD", label: "the crypto market (Bitcoin)", short: "Crypto market" };
const DBC: FactorSpec = { symbol: "DBC", label: "broad commodities", short: "Commodities" };
const UUP: FactorSpec = { symbol: "UUP", label: "the US dollar", short: "US dollar" };

/**
 * Curated sector ETF for well-known stocks (SPDR sector funds, GICS sector of the company). A short list on purpose: the
 * app has no working company-profile source right now, so a ticker not listed is compared with the market only.
 * Sector labels can change; recheck this list now and then.
 */
const SECTORS: { etf: string; label: string; tickers: string[] }[] = [
  { etf: "XLK", label: "technology stocks", tickers: ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "QCOM", "TXN", "IBM", "MU", "DELL", "HPQ", "NOW", "AMAT", "LRCX", "PLTR", "ANET"] },
  { etf: "XLC", label: "communication stocks", tickers: ["GOOGL", "GOOG", "META", "NFLX", "DIS", "T", "VZ", "CMCSA", "TMUS"] },
  { etf: "XLY", label: "consumer discretionary stocks", tickers: ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TJX", "GM", "F"] },
  { etf: "XLP", label: "consumer staples stocks", tickers: ["WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "CL", "MDLZ"] },
  { etf: "XLF", label: "financial stocks", tickers: ["JPM", "BAC", "WFC", "GS", "MS", "C", "BRK.B", "BRK-B", "V", "MA", "AXP", "BLK", "SCHW"] },
  { etf: "XLV", label: "health care stocks", tickers: ["UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "TMO", "ABT", "AMGN", "ISRG"] },
  { etf: "XLE", label: "energy stocks", tickers: ["XOM", "CVX", "COP", "SLB", "EOG", "OXY"] },
  { etf: "XLI", label: "industrial stocks", tickers: ["CAT", "GE", "BA", "HON", "UPS", "RTX", "LMT", "DE"] },
  { etf: "XLU", label: "utility stocks", tickers: ["NEE", "DUK", "SO", "CEG", "D", "AEP"] },
  { etf: "XLB", label: "materials stocks", tickers: ["LIN", "SHW", "FCX", "NEM"] },
  { etf: "XLRE", label: "real estate stocks", tickers: ["PLD", "AMT", "EQIX"] },
];
const SECTOR_OF: Record<string, string> = {};
for (const s of SECTORS) for (const t of s.tickers) SECTOR_OF[t] = s.etf;
const SECTOR_LABEL: Record<string, string> = Object.fromEntries(SECTORS.map((s) => [s.etf, s.label]));

/** Funds that are themselves a benchmark or a sector fund: they get the market only, and company filings do not apply. */
const FUND_SYMBOLS = new Set(["SPY", "VOO", "IVV", "QQQ", "IWM", "DIA", "GLD", "SLV", "USO", "UNG", "TLT", "DBC", "UUP", "XLK", "XLC", "XLY", "XLP", "XLF", "XLV", "XLE", "XLI", "XLU", "XLB", "XLRE"]);

export function normalizeSymbol(symbol: string): string {
  return String(symbol ?? "").trim().toUpperCase();
}

/** The sector ETF for a ticker on the curated list, or null. */
export function sectorEtfFor(symbol: string): FactorSpec | null {
  const etf = SECTOR_OF[normalizeSymbol(symbol)];
  return etf ? { symbol: etf, label: SECTOR_LABEL[etf], short: "Sector" } : null;
}

/** True for a fund (not a single company), so SEC company filings are not the right event source. */
export function isFundSymbol(symbol: string): boolean {
  return FUND_SYMBOLS.has(normalizeSymbol(symbol));
}

export function factorPlanFor(symbol: string, assetClass: ImpactAssetClass): FactorPlan {
  const s = normalizeSymbol(symbol);
  const notes: string[] = [];
  const dropSelf = (list: FactorSpec[]) => {
    const kept = list.filter((f) => f.symbol !== s && f.symbol !== s.replace("/", "-"));
    if (kept.length < list.length) notes.push(`${s} is itself one of the benchmarks, so that one is left out.`);
    return kept;
  };

  if (assetClass === "crypto") {
    const alt = s !== "BTC-USD" && s !== "BTC/USD";
    const factors = alt ? dropSelf([BTC, SPY]) : dropSelf([SPY]);
    notes.push(
      alt
        ? "A coin is compared with the crypto market first (Bitcoin), then with the US stock market as the outside-world link."
        : "Bitcoin is the crypto market, so it is compared with the US stock market as the outside-world link. The leftover is crypto-specific."
    );
    notes.push("There is no source of dated crypto events in this app yet, so the event test does not run for crypto.");
    return { assetClass, factors, ownLabel: "crypto-specific", hasOwnEvents: false, notes };
  }
  if (assetClass === "commodity" || assetClass === "future") {
    const factors = dropSelf([DBC, SPY]);
    notes.push("Commodities and futures are compared with a broad commodity fund first, then with the US stock market. The leftover is the asset's own supply and demand.");
    notes.push("Futures symbols themselves are not served by this app's data providers; use the matching fund or ETF.");
    notes.push("There is no source of dated commodity events in this app yet, so the event test does not run.");
    return { assetClass, factors, ownLabel: "own supply and demand", hasOwnEvents: false, notes };
  }
  if (assetClass === "forex") {
    const factors = dropSelf([UUP, SPY]);
    notes.push("A currency pair is compared with the US dollar first (a fund that tracks it), then with the stock market as a risk-mood measure. The leftover is the two currencies' own news.");
    notes.push("Limit: the dollar fund holds the euro, so EUR/USD overlaps it, and a pair without the dollar has no clean fund for its two currencies.");
    notes.push("There is no source of dated currency events in this app yet, so the event test does not run.");
    return { assetClass, factors, ownLabel: "the two currencies' own news", hasOwnEvents: false, notes };
  }
  if (assetClass === "equity") {
    const fund = isFundSymbol(s);
    const sector = fund ? null : sectorEtfFor(s);
    const factors = dropSelf([SPY, ...(sector ? [sector] : [])]);
    if (fund) notes.push("This is a fund, not one company, so company filings do not apply. It is compared with the stock market only.");
    else if (sector) notes.push(`Compared with ${SPY.label} first, then with ${sector.label} (${sector.symbol}) beyond the market. The leftover is company-specific.`);
    else notes.push("No sector fund is on the app's short list for this ticker, so it is compared with the US stock market only. The leftover is company and sector news together.");
    return { assetClass, factors, ownLabel: fund ? "fund-specific" : "company-specific", hasOwnEvents: !fund, notes };
  }
  notes.push(`There is no benchmark set up for ${assetClass} symbols, so the stock market is used and the result is weak evidence.`);
  return { assetClass, factors: dropSelf([SPY]), ownLabel: "own", hasOwnEvents: false, notes };
}
