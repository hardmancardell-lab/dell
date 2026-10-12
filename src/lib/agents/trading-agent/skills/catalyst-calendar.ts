/**
 * Catalyst calendar: dated events that can move markets (central banks, US inflation and jobs data, option
 * expirations, elections, market closures), each with an impact tag, who it affects and where the date came from.
 *
 * Pure and client-safe (no network, no server imports). Dates are plain "YYYY-MM-DD" strings in the event's own
 * market calendar; nothing here converts time zones.
 *
 * Two kinds of date, kept apart by `basis`:
 *   - "official-schedule": copied from the publisher's own schedule page on CALENDAR_VERIFIED_ON (the URL is on each
 *     event). Past events are kept so event studies can look back.
 *   - "rule": worked out from a stated rule (third Friday of the month shifted for NYSE holidays; the first Tuesday
 *     after the first Monday of November; the last weekday of the month).
 * Regulatory deadlines are deliberately NOT in here yet: none has been checked against a primary source.
 *
 * This is a calendar, not a seasonality model, and an impact tag is a judgement about how much attention an event
 * usually gets, not a forecast of direction.
 */

export type CatalystCategory = "central-bank" | "inflation" | "jobs" | "options-expiry" | "election" | "calendar-flow" | "market-hours";
export type CatalystImpact = "low" | "medium" | "high";
export type CatalystRegion = "US" | "UK" | "EU" | "JP";
export type CatalystBasis = "official-schedule" | "rule";

export interface CatalystEvent {
  id: string;
  /** YYYY-MM-DD in the event's own calendar (the decision day for a multi-day meeting). */
  date: string;
  /** Local release time when the publisher states one, for example "08:30 ET". */
  time?: string;
  name: string;
  category: CatalystCategory;
  impact: CatalystImpact;
  region: CatalystRegion;
  /** Currency tag for central-bank and data events: the currency the event is mainly about. */
  currency?: "USD" | "GBP" | "JPY" | "EUR";
  note?: string;
  basis: CatalystBasis;
  sourceUrl?: string;
}

/** The day the official dates in this file were read from the publishers. Bump it, and the lists, together. */
export const CALENDAR_VERIFIED_ON = "2026-10-12";

/** First and last date each category is complete for. Outside this range, absence of an event proves nothing. */
export const CATEGORY_COVERAGE: Record<CatalystCategory, { from: string; through: string; note?: string }> = {
  "central-bank": { from: "2026-01-01", through: "2027-12-31", note: "ECB 2026 list starts at the 28-29 Oct meeting; earlier 2026 ECB meetings are not included." },
  inflation: { from: "2026-10-14", through: "2027-12-10", note: "US CPI and PPI releases from the 14 Oct 2026 release onward." },
  jobs: { from: "2026-11-06", through: "2027-12-03", note: "US Employment Situation releases from the 6 Nov 2026 release onward." },
  "options-expiry": { from: "2026-01-01", through: "2027-12-31" },
  election: { from: "2026-01-01", through: "2027-12-31" },
  "calendar-flow": { from: "2026-01-01", through: "2027-12-31" },
  "market-hours": { from: "2026-01-01", through: "2027-12-31", note: "NYSE closures and early closes; no early closes are listed for 2027." },
};

/** Lists that start partway through the calendar: a window that begins before `startsOn` may be missing events. */
const PARTIAL_COVERAGE: { category: CatalystCategory; startsOn: string; text: string }[] = [
  { category: "central-bank", startsOn: "2026-10-28", text: "ECB meetings before 28 Oct 2026 are not listed." },
  { category: "inflation", startsOn: "2026-10-14", text: "US CPI and PPI releases are listed from 14 Oct 2026 onward." },
  { category: "jobs", startsOn: "2026-11-06", text: "US jobs reports are listed from 6 Nov 2026 onward." },
];

const FED_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const BLS_CPI_URL = "https://www.bls.gov/schedule/news_release/cpi.htm";
const BLS_JOBS_URL = "https://www.bls.gov/schedule/news_release/empsit.htm";
const BLS_YEAR_URL = "https://www.bls.gov/schedule/2026/home.htm";
const BOE_URL = "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates";
const BOJ_URL = "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm";
const ECB_URL = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html";
const NYSE_URL = "https://www.nyse.com/trade/hours-calendars";

// ---------------------------------------------------------------------------------------------------
// Official schedules. Each row is the DECISION day (the last day of a multi-day meeting).

/** FOMC decision days. `sep` marks meetings with a Summary of Economic Projections. */
const FOMC: { date: string; sep: boolean }[] = [
  { date: "2026-01-28", sep: false }, { date: "2026-03-18", sep: true }, { date: "2026-04-29", sep: false }, { date: "2026-06-17", sep: true },
  { date: "2026-07-29", sep: false }, { date: "2026-09-16", sep: true }, { date: "2026-10-28", sep: false }, { date: "2026-12-09", sep: true },
  { date: "2027-01-27", sep: false }, { date: "2027-03-17", sep: true }, { date: "2027-04-28", sep: false }, { date: "2027-06-09", sep: true },
  { date: "2027-07-28", sep: false }, { date: "2027-09-15", sep: true }, { date: "2027-10-27", sep: false }, { date: "2027-12-08", sep: true },
];

const BOE_MPC = [
  "2026-02-05", "2026-03-19", "2026-04-30", "2026-06-18", "2026-07-30", "2026-09-17", "2026-11-05", "2026-12-17",
  "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17", "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16",
];

/** BoJ policy-meeting decision days. `outlook` marks meetings that come with the Outlook Report. */
const BOJ: { date: string; outlook: boolean }[] = [
  { date: "2026-01-23", outlook: true }, { date: "2026-03-19", outlook: false }, { date: "2026-04-28", outlook: true }, { date: "2026-06-16", outlook: false },
  { date: "2026-07-31", outlook: true }, { date: "2026-09-18", outlook: false }, { date: "2026-10-30", outlook: true }, { date: "2026-12-18", outlook: false },
  { date: "2027-01-22", outlook: true }, { date: "2027-03-18", outlook: false }, { date: "2027-04-28", outlook: true }, { date: "2027-06-11", outlook: false },
  { date: "2027-07-22", outlook: true }, { date: "2027-09-22", outlook: false }, { date: "2027-10-29", outlook: true }, { date: "2027-12-17", outlook: false },
];

/** ECB monetary-policy decision days (day 2 of the Governing Council meeting, with the press conference). */
const ECB = [
  "2026-10-29", "2026-12-17",
  "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16",
];

/** US CPI releases (08:30 ET); the reference month is in the name. */
const CPI: { date: string; month: string }[] = [
  { date: "2026-10-14", month: "September 2026" }, { date: "2026-11-10", month: "October 2026" }, { date: "2026-12-10", month: "November 2026" },
  { date: "2027-01-13", month: "December 2026" }, { date: "2027-02-11", month: "January 2027" }, { date: "2027-03-10", month: "February 2027" },
  { date: "2027-04-13", month: "March 2027" }, { date: "2027-05-12", month: "April 2027" }, { date: "2027-06-10", month: "May 2027" },
  { date: "2027-07-14", month: "June 2027" }, { date: "2027-08-11", month: "July 2027" }, { date: "2027-09-14", month: "August 2027" },
  { date: "2027-10-14", month: "September 2027" }, { date: "2027-11-10", month: "October 2027" }, { date: "2027-12-10", month: "November 2027" },
];

/** US PPI releases the BLS 2026 page lists (08:30 ET). */
const PPI: { date: string; month: string }[] = [
  { date: "2026-10-15", month: "September 2026" }, { date: "2026-11-13", month: "October 2026" }, { date: "2026-12-15", month: "November 2026" },
];

/** US Employment Situation releases (08:30 ET). */
const JOBS: { date: string; month: string }[] = [
  { date: "2026-11-06", month: "October 2026" }, { date: "2026-12-04", month: "November 2026" }, { date: "2027-01-08", month: "December 2026" },
  { date: "2027-02-05", month: "January 2027" }, { date: "2027-03-05", month: "February 2027" }, { date: "2027-04-02", month: "March 2027" },
  { date: "2027-05-07", month: "April 2027" }, { date: "2027-06-04", month: "May 2027" }, { date: "2027-07-02", month: "June 2027" },
  { date: "2027-08-06", month: "July 2027" }, { date: "2027-09-03", month: "August 2027" }, { date: "2027-10-08", month: "September 2027" },
  { date: "2027-11-05", month: "October 2027" }, { date: "2027-12-03", month: "November 2027" },
];

/** NYSE full-day closures and early closes, from the NYSE hours and calendars page. */
export const NYSE_HOLIDAYS: { date: string; name: string }[] = [
  { date: "2026-01-01", name: "New Year's Day" }, { date: "2026-01-19", name: "Martin Luther King Jr. Day" }, { date: "2026-02-16", name: "Washington's Birthday" },
  { date: "2026-04-03", name: "Good Friday" }, { date: "2026-05-25", name: "Memorial Day" }, { date: "2026-06-19", name: "Juneteenth" },
  { date: "2026-07-03", name: "Independence Day (observed)" }, { date: "2026-09-07", name: "Labor Day" }, { date: "2026-11-26", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2027-01-01", name: "New Year's Day" }, { date: "2027-01-18", name: "Martin Luther King Jr. Day" }, { date: "2027-02-15", name: "Washington's Birthday" },
  { date: "2027-03-26", name: "Good Friday" }, { date: "2027-05-31", name: "Memorial Day" }, { date: "2027-06-18", name: "Juneteenth (observed)" },
  { date: "2027-07-05", name: "Independence Day (observed)" }, { date: "2027-09-06", name: "Labor Day" }, { date: "2027-11-25", name: "Thanksgiving Day" },
  { date: "2027-12-24", name: "Christmas Day (observed)" },
];
const NYSE_EARLY_CLOSES = [{ date: "2026-11-27", name: "Day after Thanksgiving" }, { date: "2026-12-24", name: "Christmas Eve" }];
const NYSE_HOLIDAY_SET = new Set(NYSE_HOLIDAYS.map((h) => h.date));

// ---------------------------------------------------------------------------------------------------
// Date helpers (UTC arithmetic on calendar dates, no time zones)

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isWeekday(date: string): boolean {
  const dow = new Date(toMs(date)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

function addDays(date: string, n: number): string {
  return toKey(toMs(date) + n * DAY_MS);
}

/** Third Friday of a month, moved back to the previous trading day when NYSE is closed that Friday. */
export function monthlyExpiration(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstFriday = 1 + ((5 - first.getUTCDay() + 7) % 7);
  let d = toKey(Date.UTC(year, month - 1, firstFriday + 14));
  while (NYSE_HOLIDAY_SET.has(d) || !isWeekday(d)) d = addDays(d, -1);
  return d;
}

/** Last weekday of a month (the date used for the month-end London fix test). */
export function lastWeekdayOfMonth(year: number, month: number): string {
  let d = toKey(Date.UTC(year, month, 0));
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

/** US general election day: the first Tuesday after the first Monday in November. */
export function electionDay(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1));
  const firstMonday = 1 + ((1 - first.getUTCDay() + 7) % 7);
  return toKey(Date.UTC(year, 10, firstMonday + 1));
}

// ---------------------------------------------------------------------------------------------------
// Event list

function buildEvents(): CatalystEvent[] {
  const out: CatalystEvent[] = [];
  const add = (e: CatalystEvent) => out.push(e);

  for (const m of FOMC) {
    add({
      id: `fomc-${m.date}`, date: m.date, name: m.sep ? "FOMC decision (with projections)" : "FOMC decision", category: "central-bank", impact: "high", region: "US", currency: "USD",
      note: m.sep ? "Meeting with a Summary of Economic Projections (dot plot)." : undefined, basis: "official-schedule", sourceUrl: FED_URL,
    });
  }
  for (const d of BOE_MPC) {
    add({ id: `boe-${d}`, date: d, name: "Bank of England rate decision", category: "central-bank", impact: "medium", region: "UK", currency: "GBP", basis: "official-schedule", sourceUrl: BOE_URL });
  }
  for (const m of BOJ) {
    add({
      id: `boj-${m.date}`, date: m.date, name: m.outlook ? "Bank of Japan decision (with Outlook Report)" : "Bank of Japan decision", category: "central-bank", impact: "medium", region: "JP", currency: "JPY",
      note: m.outlook ? "Quarterly Outlook Report is released with the decision." : undefined, basis: "official-schedule", sourceUrl: BOJ_URL,
    });
  }
  for (const d of ECB) {
    add({ id: `ecb-${d}`, date: d, name: "ECB rate decision", category: "central-bank", impact: "medium", region: "EU", currency: "EUR", note: "Day 2 of the Governing Council meeting, with the press conference.", basis: "official-schedule", sourceUrl: ECB_URL });
  }
  for (const c of CPI) {
    add({ id: `cpi-${c.date}`, date: c.date, time: "08:30 ET", name: `US CPI (${c.month})`, category: "inflation", impact: "high", region: "US", currency: "USD", basis: "official-schedule", sourceUrl: c.date.startsWith("2026") ? BLS_YEAR_URL : BLS_CPI_URL });
  }
  for (const c of PPI) {
    add({ id: `ppi-${c.date}`, date: c.date, time: "08:30 ET", name: `US PPI (${c.month})`, category: "inflation", impact: "medium", region: "US", currency: "USD", basis: "official-schedule", sourceUrl: BLS_YEAR_URL });
  }
  for (const j of JOBS) {
    add({ id: `jobs-${j.date}`, date: j.date, time: "08:30 ET", name: `US jobs report (${j.month})`, category: "jobs", impact: "high", region: "US", currency: "USD", basis: "official-schedule", sourceUrl: BLS_JOBS_URL });
  }
  for (const h of NYSE_HOLIDAYS) {
    add({ id: `nyse-closed-${h.date}`, date: h.date, name: `US markets closed: ${h.name}`, category: "market-hours", impact: "medium", region: "US", basis: "official-schedule", sourceUrl: NYSE_URL });
  }
  for (const h of NYSE_EARLY_CLOSES) {
    add({ id: `nyse-early-${h.date}`, date: h.date, name: `US markets close early (1:00 pm ET): ${h.name}`, category: "market-hours", impact: "low", region: "US", basis: "official-schedule", sourceUrl: NYSE_URL });
  }

  // Rule-based dates.
  for (const year of [2026, 2027]) {
    for (let month = 1; month <= 12; month++) {
      const quarterly = month % 3 === 0;
      const d = monthlyExpiration(year, month);
      add({
        id: `opex-${d}`, date: d, name: quarterly ? "Quarterly options and futures expiration (quad witching)" : "Monthly options expiration", category: "options-expiry", impact: quarterly ? "medium" : "low", region: "US",
        note: "Third Friday of the month, moved to the previous trading day when NYSE is closed.", basis: "rule",
      });
      const me = lastWeekdayOfMonth(year, month);
      add({
        id: `month-end-${me}`, date: me, name: "Month-end (London 4pm fix)", category: "calendar-flow", impact: "low", region: "UK", currency: "GBP",
        note: "Tested Dec 2023 to Oct 2026 on hourly bars: GBP/JPY moved about 20.5 bps over 3pm to 5pm London on month-end days versus 13.3 bps otherwise (34 month-ends). A range effect only: no reliable direction, and not significant for USD/JPY.",
        basis: "rule",
      });
    }
  }
  add({
    id: "us-midterm-2026-11-03", date: electionDay(2026), name: "US midterm elections", category: "election", impact: "high", region: "US", currency: "USD",
    note: "First Tuesday after the first Monday in November.", basis: "rule",
  });

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

let cached: CatalystEvent[] | null = null;
export function catalystEvents(): CatalystEvent[] {
  if (!cached) cached = buildEvents();
  return cached;
}

// ---------------------------------------------------------------------------------------------------
// Relevance to a symbol

export type CatalystAssetKind = "us-equity" | "fx" | "crypto";
export interface CatalystExposure {
  kind: CatalystAssetKind;
  /** Currency codes for a forex pair, for example ["GBP", "JPY"]. */
  currencies: string[];
}

const CRYPTO = new Set(["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "BCH", "AVAX", "LINK", "DOT", "MATIC"]);

export function classifySymbol(symbol: string | undefined | null): CatalystExposure | null {
  const s = (symbol ?? "").trim().toUpperCase();
  if (!s) return null;
  const base = s.split(/[-/]/)[0];
  if (CRYPTO.has(base)) return { kind: "crypto", currencies: [] };
  const m = s.match(/^([A-Z]{3})[/-]?([A-Z]{3})$/);
  if (m && m[1] !== m[2] && /^(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|CNH|CNY|MXN|SEK|NOK|ZAR)$/.test(m[1]) && /^(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|CNH|CNY|MXN|SEK|NOK|ZAR)$/.test(m[2])) {
    return { kind: "fx", currencies: [m[1], m[2]] };
  }
  return { kind: "us-equity", currencies: [] };
}

/** Whether an event is worth showing for a symbol, and the impact it should carry for that symbol. */
export function relevanceFor(e: CatalystEvent, x: CatalystExposure): { relevant: boolean; impact: CatalystImpact } {
  const us = e.region === "US";
  switch (x.kind) {
    case "us-equity":
      return { relevant: us && e.category !== "calendar-flow", impact: e.impact };
    case "crypto":
      return { relevant: us && ["central-bank", "inflation", "jobs", "election"].includes(e.category), impact: e.impact };
    case "fx": {
      const own = e.currency !== undefined && x.currencies.includes(e.currency);
      if (e.category === "central-bank" || e.category === "inflation" || e.category === "jobs") {
        // A central bank or data release for one of the pair's currencies is high impact; US events still matter as a global driver.
        if (own) return { relevant: true, impact: "high" };
        return { relevant: us, impact: us ? e.impact : "low" };
      }
      if (e.category === "calendar-flow") return { relevant: own, impact: e.impact };
      if (e.category === "election") return { relevant: us, impact: e.impact };
      return { relevant: false, impact: e.impact };
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Queries

const IMPACT_RANK: Record<CatalystImpact, number> = { low: 0, medium: 1, high: 2 };

export interface CatalystQuery {
  /** First day, YYYY-MM-DD. Defaults to today (UTC). */
  from?: string;
  /** Days ahead, including the first day. Defaults to 30. */
  days?: number;
  categories?: CatalystCategory[];
  /** Lowest impact to include. */
  minImpact?: CatalystImpact;
  /** A ticker, a forex pair ("GBP/JPY") or a crypto symbol. Filters to what matters for it and re-tags impact. */
  symbol?: string;
}

export interface UpcomingCatalyst extends CatalystEvent {
  daysAway: number;
  /** Impact for the symbol asked about; equals `impact` when no symbol was given. */
  impactForSymbol: CatalystImpact;
}

export interface CatalystResult {
  from: string;
  to: string;
  symbol: string | null;
  verifiedOn: string;
  events: UpcomingCatalyst[];
  /** Plain-language cautions: data coverage, categories with no events in the window, nearing the end of the list. */
  notes: string[];
}

export function upcomingCatalysts(q: CatalystQuery = {}, today: string = toKey(Date.now())): CatalystResult {
  const from = q.from ?? today;
  const days = Math.max(1, Math.min(Math.round(q.days ?? 30), 366));
  const to = addDays(from, days - 1);
  const minRank = IMPACT_RANK[q.minImpact ?? "low"];
  const exposure = classifySymbol(q.symbol);
  const events: UpcomingCatalyst[] = [];
  for (const e of catalystEvents()) {
    if (e.date < from || e.date > to) continue;
    if (q.categories && q.categories.length > 0 && !q.categories.includes(e.category)) continue;
    let impact = e.impact;
    if (exposure) {
      const r = relevanceFor(e, exposure);
      if (!r.relevant) continue;
      impact = r.impact;
    }
    if (IMPACT_RANK[impact] < minRank) continue;
    events.push({ ...e, daysAway: daysBetween(from, e.date), impactForSymbol: impact });
  }

  const notes: string[] = [];
  const lastDate = catalystEvents()[catalystEvents().length - 1]?.date ?? from;
  if (to > lastDate) notes.push(`The calendar ends on ${lastDate}; nothing after that date is listed, which does not mean nothing happens.`);
  for (const p of PARTIAL_COVERAGE) {
    if (q.categories && q.categories.length > 0 && !q.categories.includes(p.category)) continue;
    if (from < p.startsOn) notes.push(p.text);
  }
  if (daysBetween(from, "2027-12-31") < 60) notes.push("The official schedules end in Dec 2027; add the 2028 releases when they are published.");
  notes.push(`Official dates were read from the publishers on ${CALENDAR_VERIFIED_ON}; schedules can change, so check the source link for anything you will act on.`);
  return { from, to, symbol: exposure ? (q.symbol ?? "").trim().toUpperCase() : null, verifiedOn: CALENDAR_VERIFIED_ON, events, notes };
}

/** The next event in a category on or after `from`, or null. */
export function nextCatalyst(category: CatalystCategory, from: string = toKey(Date.now())): UpcomingCatalyst | null {
  const e = catalystEvents().find((x) => x.category === category && x.date >= from);
  return e ? { ...e, daysAway: daysBetween(from, e.date), impactForSymbol: e.impact } : null;
}
