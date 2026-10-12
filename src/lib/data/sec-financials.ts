/**
 * Company financials from SEC EDGAR's XBRL "company facts" (data.sec.gov): the
 * numbers companies file themselves in their 10-K and 10-Q, free and keyless.
 * This is the primary source for the business-phase classifier, so every figure
 * traces to a filing rather than to a data vendor's feed.
 *
 * normalizeCompanyFacts() is a pure function over the raw JSON so it can be
 * checked against a recorded real filing without any network.
 */

import { resolveCik } from "./sec-edgar";

// --------------------------------------------------------------- raw SEC shape

interface FactRow {
  start?: string;
  end: string;
  val: number;
  form: string;
  filed: string;
}
interface Concept {
  units: Record<string, FactRow[]>;
}
export interface RawCompanyFacts {
  entityName?: string;
  cik?: number;
  facts: Record<string, Record<string, Concept>>;
}

// ------------------------------------------------------------ normalized shape

export interface PeriodFinancials {
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  /** Spending on property, equipment and other productive assets (a positive number). */
  capex: number | null;
  /** Cash spent buying back the company's own shares (a positive number). */
  buybacks: number | null;
  /** Cash dividends paid (a positive number). */
  dividends: number | null;
  stockBasedComp: number | null;
  researchAndDevelopment: number | null;
}

export interface AnnualFinancials extends PeriodFinancials {
  fiscalYearEnd: string;
  /** Weighted-average diluted shares, adjusted for stock splits so years are comparable. */
  dilutedShares: number | null;
}

export interface TtmFinancials extends PeriodFinancials {
  /** End date of the latest reported quarter the figures run to. */
  periodEnd: string;
}

export interface BalanceSnapshot {
  asOf: string;
  cash: number | null;
  /** Marketable debt securities held as investments. */
  securities: number | null;
  debt: number | null;
  /** Cash plus securities minus debt. Securities count as zero if the filing's tag was not found. */
  netCash: number | null;
}

export interface FinancialHistory {
  entityName: string;
  /** Fiscal years, oldest first. */
  annual: AnnualFinancials[];
  ttm: TtmFinancials | null;
  /** The same trailing twelve months one year earlier, for a like-for-like growth rate. */
  ttmYearAgo: TtmFinancials | null;
  balance: BalanceSnapshot | null;
  /** Shares outstanding from the filing's cover page (reported rounded, often to 0.1 billion). */
  sharesOutstanding: { value: number; asOf: string } | null;
  latestFilingForm: string | null;
  warnings: string[];
}

// -------------------------------------------------------------------- tag maps

const FLOW_TAGS: Record<keyof PeriodFinancials, string[]> = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  dividends: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  stockBasedComp: ["ShareBasedCompensation"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense"],
};
const METRICS = Object.keys(FLOW_TAGS) as (keyof PeriodFinancials)[];

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

interface Period {
  start: string;
  end: string;
  days: number;
  val: number;
  form: string;
  filed: string;
}

/** All reported periods for a metric, merging tag variants (earlier tags in the list win) and keeping the latest-filed value per period. */
function periodsFor(facts: RawCompanyFacts, tags: string[]): Period[] {
  const gaap = facts.facts["us-gaap"] ?? {};
  const byKey = new Map<string, Period & { rank: number }>();
  tags.forEach((tag, rank) => {
    const c = gaap[tag];
    if (!c) return;
    const unit = c.units["USD"] ? "USD" : Object.keys(c.units)[0];
    for (const r of c.units[unit] ?? []) {
      if (!r.start || !Number.isFinite(r.val)) continue;
      const key = `${r.start}|${r.end}`;
      const days = daysBetween(r.start, r.end);
      const cand = { start: r.start, end: r.end, days, val: r.val, form: r.form, filed: r.filed, rank };
      const cur = byKey.get(key);
      if (!cur || rank < cur.rank || (rank === cur.rank && r.filed > cur.filed)) byKey.set(key, cand);
    }
  });
  return [...byKey.values()];
}

const isAnnual = (p: Period) => p.days >= 350 && p.days <= 380;

function annualValue(periods: Period[], fyEnd: string): number | null {
  const hit = periods.filter((p) => isAnnual(p) && p.end === fyEnd).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
  return hit ? hit.val : null;
}

/**
 * Trailing twelve months ending at `asOfEnd`: last full fiscal year plus this
 * year's cumulative figure minus the same cumulative figure a year earlier.
 * Returns null when any of the three pieces is missing, never a partial sum.
 */
function ttmAt(periods: Period[], asOfEnd: string): number | null {
  const fy = periods.find((p) => isAnnual(p) && p.end === asOfEnd);
  if (fy) return fy.val;
  const ytdCandidates = periods.filter((p) => p.end === asOfEnd && p.days >= 80 && p.days <= 285).sort((a, b) => b.days - a.days);
  const ytd = ytdCandidates[0];
  if (!ytd) return null;
  const lastFy = periods
    .filter((p) => isAnnual(p) && Math.abs(daysBetween(p.end, ytd.start)) <= 4)
    .sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
  if (!lastFy) return null;
  const prior = periods
    .filter((p) => Math.abs(p.days - ytd.days) <= 8 && Math.abs(daysBetween(p.end, asOfEnd) - 365) <= 10)
    .sort((a, b) => Math.abs(daysBetween(a.end, asOfEnd) - 365) - Math.abs(daysBetween(b.end, asOfEnd) - 365))[0];
  if (!prior) return null;
  return lastFy.val + ytd.val - prior.val;
}

function instantValue(facts: RawCompanyFacts, tags: string[], asOf: string): number | null {
  const gaap = facts.facts["us-gaap"] ?? {};
  for (const tag of tags) {
    const c = gaap[tag];
    if (!c) continue;
    const unit = c.units["USD"] ? "USD" : Object.keys(c.units)[0];
    const rows = (c.units[unit] ?? []).filter((r) => r.end === asOf).sort((a, b) => (a.filed < b.filed ? 1 : -1));
    if (rows.length) return rows[0].val;
  }
  return null;
}

/** Walks oldest to newest; a jump of 5x or more between neighbouring years is read as a split and earlier years are scaled to match. */
function splitAdjust(series: (number | null)[]): (number | null)[] {
  const out = [...series];
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev === null || cur === null || prev <= 0) continue;
    const ratio = cur / prev;
    if (ratio >= 5 || ratio <= 0.2) {
      const factor = ratio >= 5 ? Math.round(ratio) : 1 / Math.round(1 / ratio);
      for (let j = 0; j < i; j++) if (out[j] !== null) out[j] = (out[j] as number) * factor;
    }
  }
  return out;
}

const emptyPeriod = (): PeriodFinancials => ({
  revenue: null, grossProfit: null, operatingIncome: null, netIncome: null, operatingCashFlow: null,
  capex: null, buybacks: null, dividends: null, stockBasedComp: null, researchAndDevelopment: null,
});

// ---------------------------------------------------------------------- main

export function normalizeCompanyFacts(raw: RawCompanyFacts, maxYears = 6): FinancialHistory {
  const warnings: string[] = [];
  const periods = {} as Record<keyof PeriodFinancials, Period[]>;
  for (const m of METRICS) periods[m] = periodsFor(raw, FLOW_TAGS[m]);

  const revenueFy = periods.revenue.filter((p) => p.form === "10-K" && isAnnual(p));
  const fyEnds = [...new Set(revenueFy.map((p) => p.end))].sort().slice(-maxYears);
  if (fyEnds.length === 0) warnings.push("No annual revenue found in the filings.");

  const annualRaw = fyEnds.map((fyEnd) => {
    const row: AnnualFinancials = { fiscalYearEnd: fyEnd, dilutedShares: null, ...emptyPeriod() };
    for (const m of METRICS) row[m] = annualValue(periods[m], fyEnd);
    return row;
  });

  // Diluted share counts, split-adjusted so a 10-for-1 split does not read as a 900% jump.
  // Shares are reported in the "shares" unit, not USD, so they are read directly.
  const dilFacts = raw.facts["us-gaap"]?.["WeightedAverageNumberOfDilutedSharesOutstanding"];
  const dilRows = dilFacts ? dilFacts.units["shares"] ?? [] : [];
  const sharesByEnd = fyEnds.map((fyEnd) => {
    const hit = dilRows
      .filter((r) => r.start && r.end === fyEnd && r.form === "10-K" && daysBetween(r.start, r.end) >= 350 && daysBetween(r.start, r.end) <= 380)
      .sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    return hit ? hit.val : null;
  });
  const adjusted = splitAdjust(sharesByEnd);
  annualRaw.forEach((a, i) => (a.dilutedShares = adjusted[i]));

  // Latest reported period end across all forms.
  const allEnds = periods.revenue.map((p) => p.end).sort();
  const latestEnd = allEnds.length ? allEnds[allEnds.length - 1] : null;

  const buildTtm = (asOf: string): TtmFinancials | null => {
    const t: TtmFinancials = { periodEnd: asOf, ...emptyPeriod() };
    for (const m of METRICS) t[m] = ttmAt(periods[m], asOf);
    return t.revenue === null ? null : t;
  };

  const ttm = latestEnd ? buildTtm(latestEnd) : null;
  if (latestEnd && !ttm) warnings.push("Could not build trailing-twelve-month figures for the latest quarter.");

  // One year earlier: the filing's own prior-year comparison period nearest a year back.
  let ttmYearAgo: TtmFinancials | null = null;
  if (latestEnd) {
    const priorEnd = periods.revenue
      .map((p) => p.end)
      .filter((e) => Math.abs(daysBetween(e, latestEnd) - 365) <= 10)
      .sort((a, b) => Math.abs(daysBetween(a, latestEnd) - 365) - Math.abs(daysBetween(b, latestEnd) - 365))[0];
    if (priorEnd) ttmYearAgo = buildTtm(priorEnd);
  }

  // Balance sheet at the latest quarter end.
  let balance: BalanceSnapshot | null = null;
  if (latestEnd) {
    const cash = instantValue(raw, ["CashAndCashEquivalentsAtCarryingValue"], latestEnd);
    const securities = instantValue(raw, ["MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecurities", "ShortTermInvestments"], latestEnd);
    const ltDebt = instantValue(raw, ["LongTermDebtNoncurrent", "LongTermDebt"], latestEnd);
    const curDebt = instantValue(raw, ["DebtCurrent", "LongTermDebtCurrent"], latestEnd);
    const debt = ltDebt === null && curDebt === null ? null : (ltDebt ?? 0) + (curDebt ?? 0);
    if (cash === null) warnings.push("Cash balance not found for the latest quarter.");
    if (securities === null) warnings.push("Marketable securities not found; net cash counts them as zero.");
    if (debt === null) warnings.push("Debt not found for the latest quarter; net cash ignores it.");
    balance = {
      asOf: latestEnd,
      cash,
      securities,
      debt,
      netCash: cash === null ? null : cash + (securities ?? 0) - (debt ?? 0),
    };
  }

  // Cover-page share count (dei namespace), the newest filing's value.
  let sharesOutstanding: FinancialHistory["sharesOutstanding"] = null;
  const cover = raw.facts["dei"]?.["EntityCommonStockSharesOutstanding"];
  if (cover) {
    const rows = (cover.units["shares"] ?? []).slice().sort((a, b) => (a.end < b.end ? 1 : -1));
    if (rows[0]) sharesOutstanding = { value: rows[0].val, asOf: rows[0].end };
  }
  if (!sharesOutstanding) warnings.push("Cover-page share count not found.");

  const formRows = periods.revenue.slice().sort((a, b) => (a.filed < b.filed ? 1 : -1));
  return {
    entityName: raw.entityName ?? "",
    annual: annualRaw,
    ttm,
    ttmYearAgo,
    balance,
    sharesOutstanding,
    latestFilingForm: formRows[0]?.form ?? null,
    warnings,
  };
}

// ------------------------------------------------- point-in-time history

export interface TtmSnapshot {
  periodEnd: string;
  /** The first date this period's figures were publicly filed, so a past date only uses what was known then. */
  firstFiled: string;
  ttm: TtmFinancials;
}

/**
 * Trailing-twelve-month figures at every reported quarter end, each stamped
 * with the date it first became public. Lets a past price be paired with the
 * earnings the market actually had at the time, not later restatements.
 */
export function ttmHistory(raw: RawCompanyFacts, sinceEnd = "2000-01-01"): TtmSnapshot[] {
  const periods = {} as Record<keyof PeriodFinancials, Period[]>;
  for (const m of METRICS) periods[m] = periodsFor(raw, FLOW_TAGS[m]);
  // The first-filing date must come from the RAW rows. periodsFor() keeps only the latest-filed value per
  // period (right for "the best current figure"), but a later filing repeats an old quarter as a comparison
  // and would make that quarter look like it was first reported a year late.
  const firstFiled = new Map<string, string>();
  const gaap = raw.facts["us-gaap"] ?? {};
  for (const tag of FLOW_TAGS.revenue) {
    const c = gaap[tag];
    if (!c) continue;
    for (const rows of Object.values(c.units)) {
      for (const r of rows) {
        if (!r.start || (r.form !== "10-K" && r.form !== "10-Q")) continue;
        const cur = firstFiled.get(r.end);
        if (!cur || r.filed < cur) firstFiled.set(r.end, r.filed);
      }
    }
  }
  const out: TtmSnapshot[] = [];
  for (const [end, filed] of [...firstFiled.entries()].sort()) {
    if (end < sinceEnd) continue;
    const ttm: TtmFinancials = { periodEnd: end, ...emptyPeriod() };
    for (const m of METRICS) ttm[m] = ttmAt(periods[m], end);
    if (ttm.revenue !== null) out.push({ periodEnd: end, firstFiled: filed, ttm });
  }
  return out;
}

export interface ShareCountPoint {
  asOf: string;
  filed: string;
  value: number;
}

/** Cover-page share counts over time (rounded as filed), oldest first. */
export function coverShareHistory(raw: RawCompanyFacts): ShareCountPoint[] {
  const cover = raw.facts["dei"]?.["EntityCommonStockSharesOutstanding"];
  if (!cover) return [];
  return (cover.units["shares"] ?? [])
    .map((r) => ({ asOf: r.end, filed: r.filed, value: r.val }))
    .sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
}

// ------------------------------------------------------------------- network

export interface FinancialBundle {
  history: FinancialHistory;
  /** Trailing figures at each past quarter end, for pairing with past prices. */
  snapshots: TtmSnapshot[];
  shares: ShareCountPoint[];
}

/** One SEC request, three views: the current picture, point-in-time quarters, and share counts. */
export async function fetchFinancialBundle(ticker: string): Promise<FinancialBundle> {
  const raw = await fetchRawCompanyFacts(ticker);
  const since = new Date(Date.now() - 3 * 365 * DAY).toISOString().slice(0, 10);
  return { history: normalizeCompanyFacts(raw), snapshots: ttmHistory(raw, since), shares: coverShareHistory(raw) };
}

/** Fetches and normalizes a company's SEC financials. Throws if the ticker has no SEC listing or the request fails. */
export async function fetchFinancialHistory(ticker: string): Promise<FinancialHistory> {
  return normalizeCompanyFacts(await fetchRawCompanyFacts(ticker));
}

async function fetchRawCompanyFacts(ticker: string): Promise<RawCompanyFacts> {
  const userAgent = process.env.SEC_EDGAR_USER_AGENT;
  if (!userAgent) throw new Error('SEC_EDGAR_USER_AGENT is not set. Add a contact string such as "Dellegate you@example.com" to .env.local.');
  const cik = await resolveCik(ticker);
  if (!cik) throw new Error(`No SEC listing found for ${ticker.toUpperCase()}. Foreign or very new tickers may not have XBRL filings.`);
  // companyfacts is several MB (over Next's 2MB fetch-cache limit), so it is read fresh and the normalized result is what callers keep.
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SEC company facts request failed for ${ticker.toUpperCase()}: ${res.status}`);
  return (await res.json()) as RawCompanyFacts;
}
