/**
 * SEC EDGAR's public JSON API (data.sec.gov) — free, keyless, no signup, same
 * "plain fetch, no SDK" convention as every other data client in this app.
 * Unlike an API key, SEC's fair-access policy requires a descriptive
 * User-Agent (app name + contact email) on every request — a request without
 * one gets a hard 403. SEC_EDGAR_USER_AGENT is a contact string, not a secret.
 */

const SEC_BASE_URL = "https://data.sec.gov";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

function secHeaders(): HeadersInit {
  const userAgent = process.env.SEC_EDGAR_USER_AGENT;
  if (!userAgent) {
    throw new Error(
      "SEC_EDGAR_USER_AGENT is not set. SEC requires a descriptive User-Agent (app name + contact email) on every request — add one to .env.local, e.g. \"Graham Research Agent you@example.com\"."
    );
  }
  return { "User-Agent": userAgent };
}

interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}
type SecTickerMap = Record<string, SecTickerEntry>;

// ~1MB and effectively static day-to-day — cached far longer than any market
// data in this app (24h), consistent with how rarely ticker<->CIK mappings change.
async function fetchTickerMap(): Promise<SecTickerMap> {
  const res = await fetch(TICKERS_URL, { headers: secHeaders(), next: { revalidate: 60 * 60 * 24 } });
  if (!res.ok) {
    throw new Error(`SEC company_tickers.json request failed: ${res.status}`);
  }
  return res.json();
}

export async function resolveCik(ticker: string): Promise<string | null> {
  const map = await fetchTickerMap();
  const symbol = ticker.trim().toUpperCase();
  const entry = Object.values(map).find((e) => e.ticker === symbol);
  if (!entry) return null;
  return String(entry.cik_str).padStart(10, "0");
}

export interface SecFiling {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  url: string;
}

interface SecSubmissionsResponse {
  filings?: {
    recent?: {
      form: string[];
      filingDate: string[];
      accessionNumber: string[];
      primaryDocument: string[];
    };
  };
}

const DEFAULT_FORMS = ["10-K", "10-Q", "8-K"];
const MAX_FILINGS = 10;

export async function fetchRecentFilings(ticker: string, forms: string[] = DEFAULT_FORMS): Promise<SecFiling[]> {
  const cik = await resolveCik(ticker);
  if (!cik) {
    throw new Error(`No SEC CIK found for ticker "${ticker.trim().toUpperCase()}" — may not be a US-listed filer.`);
  }

  const res = await fetch(`${SEC_BASE_URL}/submissions/CIK${cik}.json`, {
    headers: secHeaders(),
    next: { revalidate: 60 * 15 },
  });
  if (!res.ok) {
    throw new Error(`SEC submissions request failed for CIK${cik}: ${res.status}`);
  }
  const data = (await res.json()) as SecSubmissionsResponse;
  const recent = data.filings?.recent;
  if (!recent) return [];

  const filings: SecFiling[] = [];
  for (let i = 0; i < recent.form.length && filings.length < MAX_FILINGS; i++) {
    if (!forms.includes(recent.form[i])) continue;
    const accessionNoDashes = recent.accessionNumber[i].replace(/-/g, "");
    filings.push({
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      // Archives are served from www.sec.gov, not data.sec.gov.
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${recent.primaryDocument[i]}`,
    });
  }
  return filings;
}
