import { providerFetch, providerJson } from "@/lib/data/provider-http";
import { resolveCik } from "@/lib/data/sec-edgar";
import { getDailyBars } from "@/lib/agents/trading-agent/skills/daily-bars";
import { FOMC_DECISION_DATES_EXTENDED } from "@/lib/agents/trading-agent/skills/fomc-week-variance-study";
import { TtlCache } from "@/lib/news/news-core";
import { analyzeNewsImpact, type MacroDates, type NewsImpactResult } from "./analyze";
import { factorPlanFor, normalizeSymbol } from "./factors";
import type { RawFiling } from "./filing-events";
import type { ImpactAssetClass, PriceBar } from "./types";

/**
 * Server side of the News Impact study: loads prices, SEC filings and macro release dates through the app's existing
 * clients, then hands everything to the pure analysis. Read only. Nothing is stored. Errors name the provider, never a
 * key or a URL.
 */

export const LOOKBACK_DAYS = 1850; // about five years
const RESULT_TTL_MS = 6 * 60 * 60_000;
const cache = new TtlCache<NewsImpactResult>(RESULT_TTL_MS, 60);

export function clearNewsImpactCache(): void {
  cache.clear();
}

const SEC_BASE = "https://data.sec.gov";
const FRED_BASE = "https://api.stlouisfed.org/fred";
/** FRED release numbers: 10 = Consumer Price Index, 50 = Employment Situation (the jobs report). */
export const FRED_RELEASE_CPI = 10;
export const FRED_RELEASE_JOBS = 50;

async function loadBars(symbol: string, days: number): Promise<PriceBar[]> {
  const bars = await getDailyBars(symbol, days);
  return bars.map((b) => ({ date: b.dateKey, close: b.close, volume: b.volume }));
}

// -------------------------------------------------------------------------------------------- SEC filing history

interface SubmissionColumns {
  form?: string[];
  filingDate?: string[];
  acceptanceDateTime?: string[];
  items?: string[];
}
interface SubmissionsDoc {
  filings?: { recent?: SubmissionColumns; files?: { name: string; filingFrom?: string; filingTo?: string }[] };
}

function secHeaders(): HeadersInit {
  const ua = process.env.SEC_EDGAR_USER_AGENT;
  if (!ua) throw new Error("SEC EDGAR is not set up (no contact string), so company filings are off.");
  return { "User-Agent": ua };
}

const STUDIED_FORMS = new Set(["8-K", "10-K", "10-Q"]);

export function rowsFromColumns(c: SubmissionColumns | undefined, since: string): RawFiling[] {
  if (!c?.form || !c.filingDate) return [];
  const out: RawFiling[] = [];
  for (let i = 0; i < c.form.length; i++) {
    const form = c.form[i];
    const filingDate = c.filingDate[i];
    if (!STUDIED_FORMS.has(form) || !filingDate || filingDate < since) continue;
    out.push({ form, filingDate, acceptanceDateTime: c.acceptanceDateTime?.[i] || null, items: c.items?.[i] || null });
  }
  return out;
}

/** 8-K, 10-K and 10-Q filings since a date: the recent block plus the older history pages EDGAR lists, up to six pages. */
export async function fetchFilingHistory(ticker: string, since: string): Promise<RawFiling[]> {
  const cik = await resolveCik(ticker);
  if (!cik) throw new Error("No SEC record was found for this ticker (it may not be a US-listed company).");
  const headers = secHeaders();
  const main = await providerJson<SubmissionsDoc>(`${SEC_BASE}/submissions/CIK${cik}.json`, { headers }, { provider: "SEC EDGAR", path: "submissions", revalidateSeconds: 60 * 60 * 6 });
  const out = rowsFromColumns(main.filings?.recent, since);
  const pages = (main.filings?.files ?? []).filter((f) => f.name && (!f.filingTo || f.filingTo >= since)).slice(0, 6);
  for (const page of pages) {
    if (!/^[A-Za-z0-9._-]+\.json$/.test(page.name)) continue;
    const doc = await providerJson<SubmissionColumns>(`${SEC_BASE}/submissions/${page.name}`, { headers }, { provider: "SEC EDGAR", path: "submissions page", revalidateSeconds: 60 * 60 * 6 });
    out.push(...rowsFromColumns(doc, since));
  }
  return out;
}

// -------------------------------------------------------------------------------------------- macro release dates

function fredKey(): string {
  const key = process.env.FRED_API_KEY;
  if (!key || key === "paste_your_fred_key_here") throw new Error("FRED is not set up (no key), so CPI and jobs report dates are off.");
  return key;
}

/** Past release dates of one FRED release, ascending, no earlier than `since`. */
export async function fetchFredReleaseDates(releaseId: number, since: string): Promise<string[]> {
  const url = new URL(`${FRED_BASE}/release/dates`);
  url.searchParams.set("release_id", String(releaseId));
  url.searchParams.set("api_key", fredKey());
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "400");
  let doc: { release_dates?: { date: string }[] };
  try {
    doc = await providerJson<{ release_dates?: { date: string }[] }>(url.toString(), {}, { provider: "FRED", path: `release ${releaseId} dates`, revalidateSeconds: 60 * 60 * 12 });
  } catch {
    // The provider's own message can echo the request, which carries the key. Say only what failed.
    throw new Error("FRED did not return release dates.");
  }
  const today = new Date().toISOString().slice(0, 10);
  return (doc.release_dates ?? [])
    .map((d) => d.date)
    .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= since && d <= today)
    .sort();
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Release dates from the BLS's own archive page for a release ("empsit" = Employment Situation, "cpi"). The page links
 * every past release as .../archives/<slug>_MMDDYYYY.htm, so the actual release date (including delays such as the 2025
 * shutdown) is in the link. Pure parser, exported for the test.
 */
export function parseBlsArchiveDates(html: string, slug: string, since: string, today: string): string[] {
  const out = new Set<string>();
  const re = new RegExp("archives/" + slug.replace(/[^a-z]/g, "") + "_(\\d{2})(\\d{2})(\\d{4})\\.htm", "g");
  for (const m of html.matchAll(re)) {
    const date = `${m[3]}-${m[1]}-${m[2]}`;
    if (date >= since && date <= today) out.add(date);
  }
  return [...out].sort();
}

export async function fetchBlsReleaseDates(slug: "empsit" | "cpi", since: string): Promise<string[]> {
  const res = await providerFetch(`https://www.bls.gov/bls/news-release/${slug}.htm`, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } }, { provider: "BLS", path: `news-release ${slug}`, timeoutMs: 12_000, maxRetries: 1, revalidateSeconds: 60 * 60 * 12 });
  if (!res.ok) throw new Error(`BLS answered ${res.status}`);
  return parseBlsArchiveDates(await res.text(), slug, since, new Date().toISOString().slice(0, 10));
}

/** FRED first (the app's own key), then the BLS archive page. Null when neither answers. */
export async function releaseDates(kind: "cpi" | "jobs", since: string): Promise<string[] | null> {
  const viaFred = await settle(fetchFredReleaseDates(kind === "cpi" ? FRED_RELEASE_CPI : FRED_RELEASE_JOBS, since));
  if (viaFred.ok && viaFred.value.length >= 12) return viaFred.value;
  const viaBls = await settle(fetchBlsReleaseDates(kind === "cpi" ? "cpi" : "empsit", since));
  return viaBls.ok && viaBls.value.length >= 12 ? viaBls.value : null;
}

// -------------------------------------------------------------------------------------------- the whole study

function sinceDate(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await p };
  } catch {
    return { ok: false };
  }
}

async function compute(symbol: string, assetClass: ImpactAssetClass): Promise<NewsImpactResult> {
  const plan = factorPlanFor(symbol, assetClass);
  const since = sinceDate(LOOKBACK_DAYS);
  const notes: string[] = [];

  const assetP = settle(loadBars(symbol, LOOKBACK_DAYS));
  const factorPs = plan.factors.map((f) => settle(loadBars(f.symbol, LOOKBACK_DAYS)));
  const filingsP = plan.hasOwnEvents ? settle(fetchFilingHistory(symbol, since)) : Promise.resolve({ ok: true as const, value: [] as RawFiling[] });
  const cpiP = releaseDates("cpi", since);
  const jobsP = releaseDates("jobs", since);

  const [asset, filings, cpi, jobs, ...factorRes] = await Promise.all([assetP, filingsP, cpiP, jobsP, ...factorPs]);
  if (!asset.ok) throw new Error(`Prices for ${symbol} could not be loaded.`);

  const factorBars: Record<string, PriceBar[]> = {};
  plan.factors.forEach((f, i) => {
    const r = factorRes[i];
    if (r.ok) factorBars[f.symbol] = r.value;
  });
  const macroDates: MacroDates = {
    fomc: FOMC_DECISION_DATES_EXTENDED.filter((d) => d >= since),
    cpi,
    jobs,
  };
  if (!cpi || !jobs) notes.push("Release dates for inflation or jobs reports were not available from FRED or the BLS, so those days are missing from the macro result.");
  notes.push("Fed decision days come from the app's list of past FOMC meetings, which stops at the last meeting it has verified.");
  return analyzeNewsImpact({
    symbol,
    assetClass,
    asOf: new Date().toISOString(),
    assetBars: asset.value,
    factorBars,
    filings: plan.hasOwnEvents ? (filings.ok ? filings.value : null) : [],
    macroDates,
    loadNotes: notes,
  });
}

/** Cached for six hours: the inputs are daily bars and dated filings, so nothing changes faster than that. */
export async function getNewsImpact(ticker: string, assetClass: ImpactAssetClass): Promise<NewsImpactResult> {
  const symbol = normalizeSymbol(ticker);
  return cache.get(`${symbol}|${assetClass}`, () => compute(symbol, assetClass));
}
