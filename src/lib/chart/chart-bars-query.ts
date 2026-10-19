import { BAR_ADJUSTMENTS, DEFAULT_BAR_ADJUSTMENT, type BarAdjustment } from "@/lib/data/market-data-types";
import { TIMEFRAME_PRESETS } from "@/lib/agents/trading-agent/skills/timeframe-presets";

/**
 * Strict checks for the public GET /api/chart-bars query (kept out of route.ts because a Next route file may only export
 * route handlers and config). Pure: no network, no clock unless one is passed in.
 *
 * What it guarantees: the work one request can ask for is bounded. One symbol of a safe shape, a timeframe that is one of
 * the fixed presets (each preset fixes the bar size and the length of history), an optional centre date inside a sane
 * range, one of the known price adjustments, and a short total query string.
 */

/** Same shape the news routes use: starts with a letter, digit or ^, then letters, digits and . = / _ ^ -, 20 characters at most. */
export const CHART_SYMBOL_RE = /^[A-Za-z0-9^][A-Za-z0-9.=/_^-]{0,19}$/;
export const MAX_QUERY_LENGTH = 300;
/** Earliest centre date accepted. Older dates only ever return empty charts from the providers. */
export const EARLIEST_CENTER_DATE = "2000-01-01";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ChartBarsQuery {
  ticker: string;
  timeframe: string;
  centerDate: string | undefined;
  adjustment: BarAdjustment;
  events: boolean;
}

export type ChartBarsQueryResult = { ok: true; query: ChartBarsQuery } | { ok: false; error: string };

/** True for a real calendar date written YYYY-MM-DD ("2026-02-31" is not one). */
export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function parseChartBarsQuery(searchParams: URLSearchParams, nowMs: number = Date.now()): ChartBarsQueryResult {
  if (searchParams.toString().length > MAX_QUERY_LENGTH) return { ok: false, error: "That request is too long." };

  const ticker = searchParams.get("ticker");
  const timeframe = searchParams.get("timeframe");
  if (!ticker || !timeframe) return { ok: false, error: "Missing required 'ticker' and 'timeframe' query params." };
  if (!CHART_SYMBOL_RE.test(ticker)) return { ok: false, error: "Enter a ticker with letters and numbers only (up to 20 characters)." };
  if (!TIMEFRAME_PRESETS.some((p) => p.id === timeframe)) return { ok: false, error: `Unknown timeframe "${timeframe.slice(0, 20).replace(/[^A-Za-z0-9._-]/g, "")}".` };

  const centerRaw = searchParams.get("centerDate");
  let centerDate: string | undefined;
  if (centerRaw !== null && centerRaw !== "") {
    if (!isRealDate(centerRaw)) return { ok: false, error: "centerDate must be a real date written YYYY-MM-DD." };
    const latest = new Date(nowMs + 24 * 3600_000).toISOString().slice(0, 10); // one day of slack for time zones
    if (centerRaw < EARLIEST_CENTER_DATE || centerRaw > latest) return { ok: false, error: `centerDate must be between ${EARLIEST_CENTER_DATE} and today.` };
    centerDate = centerRaw;
  }

  const adjRaw = searchParams.get("adjustment");
  let adjustment: BarAdjustment = DEFAULT_BAR_ADJUSTMENT;
  if (adjRaw !== null && adjRaw !== "") {
    if (!(BAR_ADJUSTMENTS as readonly string[]).includes(adjRaw)) return { ok: false, error: `adjustment must be one of: ${BAR_ADJUSTMENTS.join(", ")}.` };
    adjustment = adjRaw as BarAdjustment;
  }

  const eventsRaw = searchParams.get("events");
  if (eventsRaw !== null && eventsRaw !== "" && eventsRaw !== "0" && eventsRaw !== "1") return { ok: false, error: "events must be 1 (or left out)." };

  return { ok: true, query: { ticker: ticker.trim(), timeframe, centerDate, adjustment, events: eventsRaw === "1" } };
}

/**
 * How long a browser may reuse an answer. Intraday bars change every minute so they get a very short time; daily and weekly
 * bars change once a day; a window centred on a past date does not change at all. Errors are never cached (route sets no-store).
 */
export function chartCacheSeconds(q: Pick<ChartBarsQuery, "timeframe" | "centerDate" | "events">): number {
  if (q.events) return 300;
  if (q.centerDate) return 300;
  const preset = TIMEFRAME_PRESETS.find((p) => p.id === q.timeframe);
  const daily = preset?.alpacaTimeframe === "1Day" || preset?.alpacaTimeframe === "1Week";
  return daily ? 60 : 15;
}

/** Removes links and cuts the length of an error message before it is sent to a visitor. */
export function safeChartError(message: string): string {
  const stripped = message.replace(/https?:\/\/\S+/gi, "[link]").replace(/\s+/g, " ").trim();
  return stripped.slice(0, 300) || "The chart data could not be loaded.";
}
