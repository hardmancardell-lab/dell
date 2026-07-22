const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

function getApiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    throw new Error(
      "FMP_API_KEY is not set. Add your key to .env.local (see site.financialmodelingprep.com/pricing-plans)."
    );
  }
  return key;
}

async function fetchFmp<T>(
  path: string,
  params: Record<string, string> = {},
  revalidateSeconds = 60 * 60 * 12 // preserves existing behavior for every caller that doesn't pass this
): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(`${FMP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString(), {
    next: { revalidate: revalidateSeconds },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FMP request failed for ${path}: ${res.status} ${body}`);
  }

  const data = (await res.json()) as T | { "Error Message": string };
  if (data && typeof data === "object" && "Error Message" in data) {
    throw new Error(`FMP error for ${path}: ${(data as { "Error Message": string })["Error Message"]}`);
  }
  return data as T;
}

export interface FmpProfile {
  symbol: string;
  companyName: string;
  price: number;
  mktCap: number;
  sector: string;
  industry: string;
  beta: number;
}

export interface FmpIncomeStatement {
  date: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  netIncome: number;
  operatingIncome: number;
  interestExpense: number;
  ebitda: number;
  researchAndDevelopmentExpenses: number;
  eps: number;
  weightedAverageShsOut: number;
}

export interface FmpBalanceSheet {
  date: string;
  totalCurrentAssets: number;
  totalCurrentLiabilities: number;
  totalLiabilities: number;
  totalStockholdersEquity: number;
  cashAndCashEquivalents: number;
  shortTermInvestments: number;
  inventory: number;
  totalDebt: number;
  netDebt: number;
  preferredStock: number;
  commonStock: number;
}

export interface FmpCashFlowStatement {
  date: string;
  capitalExpenditure: number;
  depreciationAndAmortization: number;
  stockBasedCompensation: number;
  operatingCashFlow: number;
  freeCashFlow: number;
}

export interface FmpDividendRecord {
  date: string;
  adjDividend: number;
}

export interface FmpDividendHistory {
  symbol: string;
  historical: FmpDividendRecord[];
}

export function fetchProfile(ticker: string) {
  return fetchFmp<FmpProfile[]>("/profile", { symbol: ticker });
}

// Free-tier FMP plans cap the `limit` query param at 5 regardless of what's
// requested; the caller (security-analysis skill) compares what it wanted
// against what actually came back and flags the shortfall.
const FREE_TIER_STATEMENT_LIMIT = 5;

export function fetchIncomeStatement(ticker: string, limit = 10) {
  return fetchFmp<FmpIncomeStatement[]>("/income-statement", {
    symbol: ticker,
    period: "annual",
    limit: String(Math.min(limit, FREE_TIER_STATEMENT_LIMIT)),
  });
}

export function fetchBalanceSheet(ticker: string, limit = 10) {
  return fetchFmp<FmpBalanceSheet[]>("/balance-sheet-statement", {
    symbol: ticker,
    period: "annual",
    limit: String(Math.min(limit, FREE_TIER_STATEMENT_LIMIT)),
  });
}

export function fetchCashFlowStatement(ticker: string, limit = 10) {
  return fetchFmp<FmpCashFlowStatement[]>("/cash-flow-statement", {
    symbol: ticker,
    period: "annual",
    limit: String(Math.min(limit, FREE_TIER_STATEMENT_LIMIT)),
  });
}

export function fetchDividendHistory(ticker: string) {
  return fetchFmp<FmpDividendRecord[]>("/dividends", { symbol: ticker }).then((historical) => ({
    symbol: ticker,
    historical,
  }));
}

// Note: FMP's /company-screener endpoint requires a paid plan (402 on free
// tier) — not usable here. Sector constituents come from a curated static
// list instead (see sector-fundamentals.ts).

const NEWS_REVALIDATE_SECONDS = 60 * 15; // news goes stale fast — 15min, matching geopolitical-news.ts's GDELT cache window, not the 12h default

export interface FmpStockNewsArticle {
  symbol: string;
  publishedDate: string;
  title: string;
  site: string;
  url: string;
}

// Unverified against a real FMP response — param name (symbol vs symbols)
// and exact field set are a best guess from FMP's public docs, following
// this file's existing `symbol` convention (see fetchProfile above). Flag
// and fix once exercised against a real key, same bar every other provider
// integration in this app is held to.
export function fetchStockNews(ticker: string, limit = 10) {
  return fetchFmp<FmpStockNewsArticle[]>("/news/stock", { symbol: ticker, limit: String(limit) }, NEWS_REVALIDATE_SECONDS);
}

export interface FmpPressRelease {
  symbol: string;
  date: string;
  title: string;
  url: string;
}

export function fetchPressReleases(ticker: string, limit = 10) {
  return fetchFmp<FmpPressRelease[]>("/news/press-releases", { symbol: ticker, limit: String(limit) }, NEWS_REVALIDATE_SECONDS);
}
