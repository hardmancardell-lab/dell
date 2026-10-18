import type { DatedEvent, EventTypeDef } from "./types";

/**
 * SEC filings turned into dated events. Pure.
 *
 * A filing is a dated, company-confirmed event. It is a proxy for company news, not a count of headlines: many
 * headlines have no filing and many filings have no headline.
 */

export interface RawFiling {
  form: string;
  /** EDGAR filing date, YYYY-MM-DD. */
  filingDate: string;
  /** Exact acceptance time (ISO, UTC) when EDGAR gave it. */
  acceptanceDateTime?: string | null;
  /** 8-K item numbers as EDGAR lists them, for example "2.02,9.01". */
  items?: string | null;
}

/** Highest priority first: when two filings share a reaction day the first type listed wins. */
export const FILING_TYPES: EventTypeDef[] = [
  { id: "earnings", label: "Earnings releases (8-K item 2.02)" },
  { id: "leadership", label: "Leadership or board changes (8-K item 5.02)" },
  { id: "deals", label: "Deals, agreements and financing (8-K items 1.x, 2.x, 3.02)" },
  { id: "other", label: "Other 8-K announcements" },
  { id: "periodic", label: "Annual and quarterly reports (10-K, 10-Q)" },
];

const DEAL_ITEMS = new Set(["1.01", "1.02", "1.03", "2.01", "2.03", "2.05", "2.06", "3.02"]);

function itemList(items: string | null | undefined): string[] {
  return String(items ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The event type of a filing, or null for forms this study ignores (amendments, insider forms, registrations and so on). */
export function classifyFiling(f: Pick<RawFiling, "form" | "items">): string | null {
  const form = String(f.form ?? "").trim().toUpperCase();
  if (form === "10-K" || form === "10-Q") return "periodic";
  if (form !== "8-K") return null;
  const items = itemList(f.items);
  if (items.includes("2.02")) return "earnings";
  if (items.includes("5.02")) return "leadership";
  if (items.some((i) => DEAL_ITEMS.has(i))) return "deals";
  return "other";
}

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function easternParts(ms: number): { date: string; minutes: number } {
  const parts = Object.fromEntries(ET.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The first calendar day the market could react: the filing's Eastern date, or the next day when it was accepted at or
 * after the 4:00 pm close. Without an acceptance time the EDGAR filing date is used (and that is stated by the caller).
 * Weekends and holidays are handled later by mapping to the next trading day.
 */
export function reactionDate(f: Pick<RawFiling, "filingDate" | "acceptanceDateTime">): string | null {
  const ms = f.acceptanceDateTime ? Date.parse(f.acceptanceDateTime) : NaN;
  if (Number.isFinite(ms)) {
    const { date, minutes } = easternParts(ms);
    return minutes >= 16 * 60 ? addDays(date, 1) : date;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(String(f.filingDate ?? "")) ? f.filingDate : null;
}

export function filingsToEvents(filings: RawFiling[]): DatedEvent[] {
  const out: DatedEvent[] = [];
  for (const f of filings) {
    const type = classifyFiling(f);
    const date = reactionDate(f);
    if (!type || !date) continue;
    const def = FILING_TYPES.find((t) => t.id === type);
    out.push({ date, type, label: def ? def.label : type });
  }
  return out;
}

/** Share of filings that came with an exact acceptance time (a data-quality number for the notes). */
export function shareWithAcceptanceTime(filings: RawFiling[]): number | null {
  const considered = filings.filter((f) => classifyFiling(f) !== null);
  if (considered.length === 0) return null;
  return considered.filter((f) => Number.isFinite(Date.parse(String(f.acceptanceDateTime ?? "")))).length / considered.length;
}
