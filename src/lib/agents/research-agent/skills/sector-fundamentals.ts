import {
  fetchBalanceSheet,
  fetchCashFlowStatement,
  fetchIncomeStatement,
  fetchProfile,
} from "@/lib/data/fmp";
import type { SectorFundamentals, SectorFundamentalsCompany, SectorProfileOnlyCompany } from "../types";
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

// FMP's lighter-weight /profile endpoint (real company name + real
// sub-industry classification) is NOT gated by the same allowlist as the
// financial-statement endpoints above — confirmed by live probing across all
// 11 sectors, including the 3 fully statement-blocked ones. This list exists
// purely to surface real sub-industry breadth per sector (e.g. Energy's
// Oil & Gas Midstream/E&P/Equipment split, not just "Energy"), even where no
// full-ratio data is available. Deliberately broader and more sub-industry-
// diverse than SECTOR_CONSTITUENTS; overlap with it is fine (deduped at
// runtime) since a company can appear in both the ratio table and the
// broader-coverage grid.
export const SECTOR_PROFILE_CANDIDATES: Record<string, string[]> = {
  "Basic Materials": ["LIN", "SHW", "ECL", "APD", "FCX", "NEM", "NUE", "STLD", "DOW", "DD", "PKG", "IP", "MOS", "CF"],
  "Communication Services": ["CMCSA", "TMUS", "CHTR", "EA", "TTWO", "WBD", "PARA", "LYV"],
  "Consumer Cyclical": ["HD", "LOW", "MCD", "CMG", "BKNG", "MAR", "TJX", "ROST", "YUM"],
  "Consumer Defensive": ["PM", "MO", "CL", "KMB", "GIS", "KHC", "TGT", "KR", "MDLZ"],
  Energy: ["COP", "EOG", "SLB", "HAL", "WMB", "KMI", "OKE", "VLO", "MPC", "PSX", "DVN"],
  "Financial Services": ["MA", "SCHW", "USB", "PNC", "SPGI", "ICE", "AIG", "MET", "TRV", "COF"],
  Healthcare: ["LLY", "MRK", "ABT", "MDT", "ISRG", "GILD", "AMGN", "VRTX", "CVS", "CI"],
  Industrials: ["CAT", "DE", "HON", "MMM", "UPS", "UNP", "RTX", "NOC", "GD", "CSX"],
  "Real Estate": ["PLD", "AMT", "CCI", "O", "SPG", "PSA", "EXR", "AVB", "EQR", "WELL", "VTR"],
  Technology: ["ORCL", "CRM", "INTC", "AMD", "QCOM", "IBM", "ACN", "NOW", "INTU", "TXN"],
  Utilities: ["NEE", "DUK", "SO", "D", "AEP", "EXC", "SRE", "XEL", "AWK", "ED"],
};

async function fetchBroaderCoverage(
  sector: string,
  excludeTickers: Set<string>
): Promise<{ companies: SectorProfileOnlyCompany[]; failedCount: number }> {
  const candidates = (SECTOR_PROFILE_CANDIDATES[sector] ?? []).filter((t) => !excludeTickers.has(t));
  if (candidates.length === 0) {
    return { companies: [], failedCount: 0 };
  }

  const settled = await Promise.allSettled(
    candidates.map(async (ticker) => {
      const profiles = await fetchProfile(ticker);
      const profile = profiles[0];
      const company: SectorProfileOnlyCompany = {
        ticker,
        companyName: profile?.companyName ?? ticker,
        industry: profile?.industry ?? null,
        marketCap: profile?.mktCap ?? 0,
      };
      return company;
    })
  );

  const companies = settled
    .filter((r): r is PromiseFulfilledResult<SectorProfileOnlyCompany> => r.status === "fulfilled")
    .map((r) => r.value);
  const failedCount = settled.filter((r) => r.status === "rejected").length;

  return { companies, failedCount };
}

export async function getSectorFundamentals(sector: string): Promise<SectorFundamentals> {
  const dataLimitations: string[] = [];

  const tickers = SECTOR_CONSTITUENTS[sector];
  if (tickers === undefined) {
    throw new Error(`No curated ticker list defined for sector "${sector}".`);
  }

  const [ratioSettled, broader] = await Promise.all([
    Promise.allSettled(
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
          industry: profile?.industry ?? null,
          marketCap: profile?.mktCap ?? 0,
          debtToEquity,
          interestCoverage,
          capexToDepreciation,
          operatingMarginByYear,
        };
        return company;
      })
    ),
    fetchBroaderCoverage(sector, new Set(tickers)),
  ]);

  const companies = ratioSettled
    .filter((r): r is PromiseFulfilledResult<SectorFundamentalsCompany> => r.status === "fulfilled")
    .map((r) => r.value);
  const failedTickers = tickers.filter((_, i) => ratioSettled[i].status === "rejected");
  if (failedTickers.length > 0) {
    dataLimitations.push(
      `Could not fetch full financial statements for: ${failedTickers.join(", ")} — likely restricted on the free FMP tier. Medians are based on the remaining ${companies.length} companies.`
    );
  }
  if (tickers.length === 0) {
    const detail = UNAVAILABLE_SECTOR_NOTE[sector] ?? "No accessible tickers found for this sector.";
    dataLimitations.push(
      `No companies in "${sector}" have accessible full financial statements on the free FMP plan. ${detail} Fix: upgrade to a paid FMP plan, which removes the per-ticker allowlist entirely. Real company names and sub-industries for this sector are shown below in "Also Tracked in This Sector" instead.`
    );
  } else if (companies.length === 0) {
    dataLimitations.push(
      `All ${tickers.length} tickers with normally-accessible statements failed to fetch this time (likely a transient rate limit) — see "Also Tracked in This Sector" below for real company/sub-industry coverage in the meantime.`
    );
  }

  if (broader.failedCount > 0) {
    dataLimitations.push(
      `${broader.failedCount} additional candidate ticker(s) could not be profiled for the broader sub-industry coverage grid (transient error or rate limit).`
    );
  }

  const operatingMarginStdDevs = companies
    .map((c) => stdDev(c.operatingMarginByYear))
    .filter((v): v is number => v !== null);

  dataLimitations.push(
    "Company list is a curated set of large-cap bellwethers for this sector, not a live market-cap screen — FMP's screener endpoint requires a paid plan.",
    "Margin variance and earnings history are based on up to 5 years (FMP free tier cap), not Graham's requested 7-10 year window.",
    "\"Also Tracked in This Sector\" companies have real names and real sub-industry classifications (FMP /profile), but no financial ratios — full statements are gated by the same free-tier allowlist noted above."
  );

  return {
    sector,
    companiesAnalyzed: companies,
    broaderCoverage: broader.companies,
    sampleNote:
      companies.length > 0
        ? `${companies.length} curated large-cap companies with full ratios, ${broader.companies.length} more tracked by name/sub-industry`
        : `0 companies with full ratios available, ${broader.companies.length} tracked by name/sub-industry`,
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
