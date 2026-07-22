import {
  fetchBalanceSheet,
  fetchCashFlowStatement,
  fetchDividendHistory,
  fetchIncomeStatement,
  fetchProfile,
} from "@/lib/data/fmp";
import type {
  DividendGrowthTrend,
  DividendSection,
  EarningPowerSection,
  FinancialStatementYear,
  GrahamChecklistItem,
  LiquiditySection,
  NcavSection,
  SecurityAnalysis,
  SolvencySection,
  ValuationSection2,
} from "../types";
import { getSectorSpecificPanel } from "./sector-specific-ratios";
import { getValuationMethods } from "./valuation-methods";

const EARNINGS_YEARS_REQUESTED = 10;
const DIVIDEND_YEARS_REQUESTED = 20;

export async function getSecurityAnalysis(ticker: string): Promise<SecurityAnalysis> {
  const symbol = ticker.trim().toUpperCase();
  const dataLimitations: string[] = [];

  const [profiles, incomeStatements, balanceSheets, cashFlowStatements, dividendHistory] = await Promise.all([
    fetchProfile(symbol),
    fetchIncomeStatement(symbol, EARNINGS_YEARS_REQUESTED),
    fetchBalanceSheet(symbol, EARNINGS_YEARS_REQUESTED),
    fetchCashFlowStatement(symbol, EARNINGS_YEARS_REQUESTED),
    fetchDividendHistory(symbol).catch(() => ({ symbol, historical: [] })),
  ]);

  const profile = profiles[0];
  if (!profile) {
    throw new Error(`No profile data found for ticker "${symbol}".`);
  }
  if (incomeStatements.length === 0 || balanceSheets.length === 0) {
    throw new Error(`No financial statement data found for ticker "${symbol}".`);
  }

  // --- Earning Power (income statement, multi-year average) ---
  if (incomeStatements.length < EARNINGS_YEARS_REQUESTED) {
    dataLimitations.push(
      `Only ${incomeStatements.length} of ${EARNINGS_YEARS_REQUESTED} requested years of income statement history available (FMP free tier caps annual statements around 5 years). Earnings average and stability check are based on fewer years than Graham specified.`
    );
  }
  const deficitYears = incomeStatements.filter((s) => s.netIncome <= 0).length;
  const averageNetIncome =
    incomeStatements.reduce((sum, s) => sum + s.netIncome, 0) / incomeStatements.length;
  const earningPower: EarningPowerSection = {
    yearsAvailable: incomeStatements.length,
    yearsRequested: EARNINGS_YEARS_REQUESTED,
    averageNetIncome,
    deficitYears,
    meetsStabilityThreshold: deficitYears === 0,
    warning:
      incomeStatements.length < EARNINGS_YEARS_REQUESTED
        ? `Based on ${incomeStatements.length}yr history, not Graham's requested ${EARNINGS_YEARS_REQUESTED}yr.`
        : null,
  };

  // --- NCAV (most recent balance sheet) ---
  const latestBalanceSheet = balanceSheets[0];
  const sharesOutstanding =
    incomeStatements[0].weightedAverageShsOut || profile.mktCap / profile.price;
  const ncavValue =
    latestBalanceSheet.totalCurrentAssets -
    latestBalanceSheet.totalLiabilities -
    (latestBalanceSheet.preferredStock || 0);
  const ncavPerShare = sharesOutstanding > 0 ? ncavValue / sharesOutstanding : 0;
  const ncav: NcavSection = {
    currentAssets: latestBalanceSheet.totalCurrentAssets,
    totalLiabilities: latestBalanceSheet.totalLiabilities,
    preferredStock: latestBalanceSheet.preferredStock || 0,
    ncav: ncavValue,
    sharesOutstanding,
    ncavPerShare,
    price: profile.price,
    priceToNcav: ncavPerShare > 0 ? profile.price / ncavPerShare : null,
    isBargain: ncavPerShare > 0 && profile.price <= (2 / 3) * ncavPerShare,
  };

  // --- Liquidity ---
  const currentRatio =
    latestBalanceSheet.totalCurrentLiabilities > 0
      ? latestBalanceSheet.totalCurrentAssets / latestBalanceSheet.totalCurrentLiabilities
      : 0;
  const liquidity: LiquiditySection = {
    currentAssets: latestBalanceSheet.totalCurrentAssets,
    currentLiabilities: latestBalanceSheet.totalCurrentLiabilities,
    currentRatio,
    meetsGrahamThreshold: currentRatio >= 2.0,
    cashAndEquivalents: latestBalanceSheet.cashAndCashEquivalents,
  };

  // --- Solvency (fixed-charge coverage, leverage) ---
  const latestIncome = incomeStatements[0];
  const ebit = latestIncome.operatingIncome;
  const interestExpense = latestIncome.interestExpense;
  const fixedChargeCoverage =
    interestExpense > 0 ? ebit / interestExpense : null;
  const debtToEquity =
    latestBalanceSheet.totalStockholdersEquity !== 0
      ? latestBalanceSheet.totalDebt / latestBalanceSheet.totalStockholdersEquity
      : null;
  const solvency: SolvencySection = {
    ebit,
    interestExpense,
    fixedChargeCoverage,
    meetsGrahamThreshold: fixedChargeCoverage === null || fixedChargeCoverage >= 4,
    totalDebt: latestBalanceSheet.totalDebt,
    totalEquity: latestBalanceSheet.totalStockholdersEquity,
    debtToEquity,
    topHeavy: debtToEquity !== null && debtToEquity > 1,
  };
  if (interestExpense <= 0) {
    dataLimitations.push(
      "Reported interest expense is zero or unavailable — fixed-charge coverage could not be calculated (treated as passing by default since there's no fixed charge to cover)."
    );
  }

  // --- Dividends ---
  const dividendYears = new Set(
    dividendHistory.historical.map((d) => new Date(d.date).getFullYear())
  );
  const currentYear = new Date().getFullYear();
  let consecutiveYearsPaid = 0;
  for (let y = currentYear; y >= currentYear - 40; y -= 1) {
    if (dividendYears.has(y) || dividendYears.has(y - 1)) {
      consecutiveYearsPaid += 1;
    } else if (y < currentYear) {
      break;
    }
  }
  // Growth-trend read — derived from the same dividendHistory.historical
  // already fetched above for the streak calculation, no new data source.
  // Supplements the Graham pass/fail criterion; doesn't affect it.
  const dividendsByYear = new Map<number, number>();
  for (const d of dividendHistory.historical) {
    const year = new Date(d.date).getFullYear();
    dividendsByYear.set(year, (dividendsByYear.get(year) ?? 0) + d.adjDividend);
  }
  const fullYearsPaid = [...dividendsByYear.keys()].filter((y) => y < currentYear).sort((a, b) => b - a);
  let growthTrend: DividendGrowthTrend | null = null;
  if (fullYearsPaid.length >= 2) {
    const recentYear = fullYearsPaid[0];
    const priorYear = fullYearsPaid[Math.min(4, fullYearsPaid.length - 1)]; // ~5yr back, or as far as available
    const recentTotal = dividendsByYear.get(recentYear) ?? 0;
    const priorTotal = dividendsByYear.get(priorYear) ?? 0;
    if (priorTotal > 0) {
      const changePct = (recentTotal - priorTotal) / priorTotal;
      growthTrend = changePct > 0.05 ? "growing" : changePct < -0.05 ? "declining" : "stable";
    }
  }

  const dividends: DividendSection = {
    consecutiveYearsPaid,
    yearsRequested: DIVIDEND_YEARS_REQUESTED,
    meetsGrahamThreshold: consecutiveYearsPaid >= DIVIDEND_YEARS_REQUESTED,
    mostRecentPaymentDate: dividendHistory.historical[0]?.date ?? null,
    growthTrend,
  };
  if (dividendHistory.historical.length === 0) {
    dataLimitations.push(
      "No dividend history returned — company may pay no dividend, or FMP free tier didn't return records for this ticker."
    );
  }

  // --- Valuation (PE x PB, using 3yr EPS average) ---
  const epsYears = incomeStatements.slice(0, 3);
  const averageEpsRecentYears =
    epsYears.reduce((sum, s) => sum + s.eps, 0) / epsYears.length;
  const bookValuePerShare =
    sharesOutstanding > 0
      ? (latestBalanceSheet.totalStockholdersEquity - (latestBalanceSheet.preferredStock || 0)) /
        sharesOutstanding
      : 0;
  const peRatio = averageEpsRecentYears > 0 ? profile.price / averageEpsRecentYears : null;
  const pbRatio = bookValuePerShare > 0 ? profile.price / bookValuePerShare : null;
  const grahamMultiplier = peRatio !== null && pbRatio !== null ? peRatio * pbRatio : null;
  const valuation: ValuationSection2 = {
    price: profile.price,
    averageEpsRecentYears,
    yearsUsedForEps: epsYears.length,
    peRatio,
    bookValuePerShare,
    pbRatio,
    grahamMultiplier,
    passesGrahamMultiplier: grahamMultiplier !== null && grahamMultiplier <= 22.5,
  };
  if (peRatio === null || pbRatio === null) {
    dataLimitations.push(
      "PE or PB ratio could not be calculated (negative/zero earnings or book value) — Graham multiplier check skipped."
    );
  }

  const checklist: GrahamChecklistItem[] = [
    {
      criterion: "Earnings stability: no deficit years in available history",
      passed: earningPower.meetsStabilityThreshold,
      detail: `${earningPower.deficitYears} deficit year(s) across ${earningPower.yearsAvailable} years available.`,
    },
    {
      criterion: "Current ratio >= 2.0",
      passed: liquidity.meetsGrahamThreshold,
      detail: `Current ratio: ${currentRatio.toFixed(2)}`,
    },
    {
      criterion: "Fixed-charge coverage >= 4x",
      passed: solvency.meetsGrahamThreshold,
      detail:
        fixedChargeCoverage !== null
          ? `EBIT covers interest ${fixedChargeCoverage.toFixed(1)}x`
          : "No interest expense reported",
    },
    {
      criterion: "Not a top-heavy capital structure (debt/equity <= 1)",
      passed: !solvency.topHeavy,
      detail: debtToEquity !== null ? `Debt/Equity: ${debtToEquity.toFixed(2)}` : "N/A",
    },
    {
      criterion: `Dividend record >= ${DIVIDEND_YEARS_REQUESTED} consecutive years`,
      passed: dividends.meetsGrahamThreshold,
      detail: `${consecutiveYearsPaid} consecutive year(s) detected in available history.`,
    },
    {
      criterion: "PE x PB <= 22.5 (Graham multiplier)",
      passed: valuation.passesGrahamMultiplier,
      detail:
        grahamMultiplier !== null
          ? `PE ${peRatio?.toFixed(1)} x PB ${pbRatio?.toFixed(1)} = ${grahamMultiplier.toFixed(1)}`
          : "Could not be calculated",
    },
    {
      criterion: "Trading below 2/3 of NCAV (deep bargain test)",
      passed: ncav.isBargain,
      detail:
        ncav.priceToNcav !== null
          ? `Price is ${(ncav.priceToNcav * 100).toFixed(0)}% of NCAV/share`
          : "NCAV per share is zero or negative",
    },
  ];

  const sectorPanel = getSectorSpecificPanel({
    profile,
    income: incomeStatements,
    balance: balanceSheets,
    cashFlow: cashFlowStatements,
  });
  if (cashFlowStatements.length === 0 && sectorPanel) {
    dataLimitations.push(
      "No cash flow statement data returned — sector-specific ratios that depend on FCF, CapEx, or SBC could not be calculated."
    );
  }

  // --- Raw financial statements, merged by year index (all three arrays
  // are fetched with the same limit and come back most-recent-first from
  // FMP, so index alignment holds as long as none of the three requests
  // silently returned a different number of years than the others). ---
  const financialStatements: FinancialStatementYear[] = incomeStatements.map((income, i) => {
    const balance = balanceSheets[i];
    const cashFlow = cashFlowStatements[i];
    return {
      // FMP's stable income-statement response doesn't actually include a
      // calendarYear field (confirmed empty via live testing) — derive the
      // fiscal year from the statement date instead.
      fiscalYear: income.date ? income.date.slice(0, 4) : `Year ${i + 1}`,
      date: income.date,
      revenue: income.revenue,
      costOfRevenue: income.costOfRevenue,
      grossProfit: income.grossProfit,
      operatingIncome: income.operatingIncome,
      netIncome: income.netIncome,
      eps: income.eps,
      totalCurrentAssets: balance?.totalCurrentAssets ?? 0,
      totalCurrentLiabilities: balance?.totalCurrentLiabilities ?? 0,
      totalLiabilities: balance?.totalLiabilities ?? 0,
      totalStockholdersEquity: balance?.totalStockholdersEquity ?? 0,
      totalDebt: balance?.totalDebt ?? 0,
      cashAndCashEquivalents: balance?.cashAndCashEquivalents ?? 0,
      operatingCashFlow: cashFlow?.operatingCashFlow ?? 0,
      capitalExpenditure: cashFlow?.capitalExpenditure ?? 0,
      freeCashFlow: cashFlow?.freeCashFlow ?? 0,
    };
  });
  if (balanceSheets.length !== incomeStatements.length || cashFlowStatements.length !== incomeStatements.length) {
    dataLimitations.push(
      `Statement years didn't align across the three filings (${incomeStatements.length} income, ${balanceSheets.length} balance sheet, ${cashFlowStatements.length} cash flow) — merged by array position, which may misalign a year if one filing type returned fewer records than the others.`
    );
  }

  const valuationMethods = await getValuationMethods({
    price: profile.price,
    sharesOutstanding,
    incomeStatements,
    cashFlowStatements,
    bookValuePerShare,
    averageNetIncome,
    dividendHistory: dividendHistory.historical,
  });

  return {
    ticker: symbol,
    companyName: profile.companyName,
    sector: profile.sector,
    industry: profile.industry,
    earningPower,
    ncav,
    liquidity,
    solvency,
    dividends,
    valuation,
    checklist,
    sectorPanel,
    financialStatements,
    valuationMethods,
    dataLimitations,
  };
}
