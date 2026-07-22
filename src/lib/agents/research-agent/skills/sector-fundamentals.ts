import {
  fetchBalanceSheet,
  fetchCashFlowStatement,
  fetchIncomeStatement,
  fetchProfile,
} from "@/lib/data/fmp";
import type { SectorFundamentals, SectorFundamentalsCompany } from "../types";
import { median, stdDev } from "../stats";

// FMP's /company-screener endpoint requires a paid plan, so sector
// constituents are a curated list of large-cap bellwethers rather than a
// live market-cap screen. Flagged explicitly in dataLimitations below.
//
// This list is not a guess — it's the result of probing ~110 candidate
// tickers against the free-tier income-statement endpoint (see
// scripts/probe-tickers.mjs and scripts/probe-results.json). Findings:
//   - Full statement access on the free plan is gated by an undocumented
//     per-ticker allowlist, not by market cap: MO, PG, CL, MRK, TMO, CAT,
//     HON, MS, AXP, BLK all failed despite being mega-caps.
//   - Three sectors came back with ZERO working tickers out of everything
//     tried (15, 12, and 12 candidates respectively): Basic Materials,
//     Real Estate, Utilities. These are listed as empty arrays below —
//     getSectorFundamentals fails fast for them instead of burning API
//     calls on tickers already confirmed blocked.
//   - Fix: a paid FMP plan removes this allowlist entirely (and also lifts
//     the 5yr statement-history cap, and unlocks the real screener
//     endpoint, making this whole curated-list workaround unnecessary).
export const SECTOR_CONSTITUENTS: Record<string, string[]> = {
  "Basic Materials": [],
  "Communication Services": ["GOOGL", "META", "DIS", "VZ", "T", "NFLX"],
  "Consumer Cyclical": ["AMZN", "TSLA", "NKE", "SBUX", "GM", "F"],
  "Consumer Defensive": ["KO", "PEP", "WMT", "COST"],
  Energy: ["XOM", "CVX"],
  "Financial Services": ["JPM", "V", "BAC", "WFC", "GS", "C"],
  Healthcare: ["UNH", "JNJ", "ABBV", "PFE"],
  Industrials: ["BA", "GE", "LMT"],
  "Real Estate": [],
  Technology: ["AAPL", "MSFT", "NVDA", "ADBE", "CSCO"],
  Utilities: [],
};

export const UNAVAILABLE_SECTOR_NOTE: Record<string, string> = {
  "Basic Materials":
    "0 of 15 candidate large-cap tickers (LIN, SHW, ECL, APD, NEM, FCX, DOW, NUE, DD, PPG, VMC, MLM, ALB, CE, FMC) had accessible financial statements on the free FMP plan.",
  "Real Estate":
    "0 of 12 candidate REITs (PLD, AMT, EQIX, PSA, O, SPG, WELL, DLR, CCI, AVB, EQR, VTR) had accessible financial statements on the free FMP plan.",
  Utilities:
    "0 of 12 candidate utilities (NEE, DUK, SO, D, AEP, EXC, SRE, XEL, ED, PEG, WEC, ES) had accessible financial statements on the free FMP plan.",
};

export async function getSectorFundamentals(sector: string): Promise<SectorFundamentals> {
  const dataLimitations: string[] = [];

  const tickers = SECTOR_CONSTITUENTS[sector];
  if (!tickers) {
    throw new Error(`No curated ticker list defined for sector "${sector}".`);
  }
  if (tickers.length === 0) {
    const detail = UNAVAILABLE_SECTOR_NOTE[sector] ?? "No accessible tickers found for this sector.";
    throw new Error(
      `"${sector}" is not available on the free FMP plan. ${detail} Fix: upgrade to a paid FMP plan, which removes the per-ticker allowlist entirely.`
    );
  }

  const settled = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const [profiles, income, balance, cashFlow] = await Promise.all([
        fetchProfile(ticker),
        fetchIncomeStatement(ticker, 5),
        fetchBalanceSheet(ticker, 5),
        fetchCashFlowStatement(ticker, 5),
      ]);

      const profile = profiles[0];
      const latestIncome = income[0];
      const latestBalance = balance[0];
      const latestCashFlow = cashFlow[0];

      const debtToEquity =
        latestBalance && latestBalance.totalStockholdersEquity !== 0
          ? latestBalance.totalDebt / latestBalance.totalStockholdersEquity
          : null;

      const interestCoverage =
        latestIncome && latestIncome.interestExpense > 0
          ? latestIncome.operatingIncome / latestIncome.interestExpense
          : null;

      const capexToDepreciation =
        latestCashFlow && latestCashFlow.depreciationAndAmortization > 0
          ? Math.abs(latestCashFlow.capitalExpenditure) / latestCashFlow.depreciationAndAmortization
          : null;

      const operatingMarginByYear = income
        .filter((s) => s.revenue > 0)
        .map((s) => (s.operatingIncome / s.revenue) * 100);

      const company: SectorFundamentalsCompany = {
        ticker,
        companyName: profile?.companyName ?? ticker,
        marketCap: profile?.mktCap ?? 0,
        debtToEquity,
        interestCoverage,
        capexToDepreciation,
        operatingMarginByYear,
      };
      return company;
    })
  );

  const companies = settled
    .filter((r): r is PromiseFulfilledResult<SectorFundamentalsCompany> => r.status === "fulfilled")
    .map((r) => r.value);
  const failedTickers = tickers.filter((_, i) => settled[i].status === "rejected");
  if (failedTickers.length > 0) {
    dataLimitations.push(
      `Could not fetch data for: ${failedTickers.join(", ")} — likely restricted on the free FMP tier. Medians are based on the remaining ${companies.length} companies.`
    );
  }
  if (companies.length === 0) {
    throw new Error(`No data could be fetched for any company in "${sector}" (all ${tickers.length} tickers failed).`);
  }

  const operatingMarginStdDevs = companies
    .map((c) => stdDev(c.operatingMarginByYear))
    .filter((v): v is number => v !== null);

  dataLimitations.push(
    "Company list is a curated set of large-cap bellwethers for this sector, not a live market-cap screen — FMP's screener endpoint requires a paid plan.",
    "Margin variance and earnings history are based on up to 5 years (FMP free tier cap), not Graham's requested 7-10 year window."
  );

  return {
    sector,
    companiesAnalyzed: companies,
    sampleNote: `${companies.length} curated large-cap companies`,
    medians: {
      debtToEquity: median(companies.map((c) => c.debtToEquity).filter((v): v is number => v !== null)),
      interestCoverage: median(
        companies.map((c) => c.interestCoverage).filter((v): v is number => v !== null)
      ),
      capexToDepreciation: median(
        companies.map((c) => c.capexToDepreciation).filter((v): v is number => v !== null)
      ),
      operatingMarginStdDev: median(operatingMarginStdDevs),
    },
    dataLimitations,
  };
}
