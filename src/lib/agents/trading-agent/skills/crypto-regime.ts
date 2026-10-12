/**
 * Crypto regime read: the six-condition breakout checklist from the Crypto Research Desk dashboard, scored 0 to 6.
 * Pure and client-safe (no network). The data adapters live in src/lib/data/crypto-public.ts and the orchestrator in
 * crypto-regime-service.ts.
 *
 * The six conditions and thresholds are the dashboard's own, so the two can be compared on the same day's data:
 *   1. Stablecoin supply 30-day change above +2%        (DefiLlama)
 *   2. US spot BTC ETF net flows month-to-date above 0  (Farside)
 *   3. BTC dominance below 55%                          (CoinGecko)
 *   4. BTC close above its 200-day simple average       (CoinGecko daily closes)
 *   5. US 10-year yield below 5.0%                      (Yahoo ^TNX)
 *   6. Fear & Greed index below 80                      (alternative.me)
 * Each threshold is strict: a reading exactly on the line is "not met".
 *
 * Reading the score: 4 or more met = breakout regime, 3 = mixed, 2 or fewer = range-bound. A condition whose data
 * could not be read is "unavailable" and never counts as met, and the label is only given when it holds whichever
 * way the missing inputs would have come out; otherwise it is "undetermined".
 *
 * This is a market-level research read. It is not investment advice, and the app has no crypto trading signals for
 * it to gate yet.
 */

export const CRYPTO_REGIME_METHOD = "crypto-regime-v1";

export const REGIME_THRESHOLDS = {
  stablecoinChange30d: 0.02,
  btcDominance: 0.55,
  us10yPct: 5.0,
  fearGreed: 80,
  breakoutMin: 4,
  mixedMin: 3,
} as const;

export type CheckStatus = "met" | "not-met" | "unavailable";
export type RegimeLabel = "breakout" | "mixed" | "range-bound" | "undetermined";
export type CheckKey = "stablecoin-supply" | "etf-flows" | "btc-dominance" | "btc-200d" | "us10y" | "fear-greed";

export interface RegimeInputs {
  /** Fractional change in total stablecoin supply over 30 days (0.02 = +2%). */
  stablecoinChange30d: number | null;
  /** Net US spot BTC ETF flows so far this month, in millions of dollars. */
  etfFlowsMtdMusd: number | null;
  /** BTC share of total crypto market cap as a fraction (0.55 = 55%). */
  btcDominance: number | null;
  btcClose: number | null;
  btcSma200: number | null;
  /** Yield in percent (5.24 = 5.24%). */
  us10yPct: number | null;
  fearGreed: number | null;
}

export interface RegimeCheck {
  key: CheckKey;
  label: string;
  reading: number | null;
  /** How to print the reading. */
  unit: "pct" | "musd" | "share" | "yield" | "index" | "ratio-to-average";
  threshold: string;
  status: CheckStatus;
}

export interface CryptoRegime {
  checks: RegimeCheck[];
  met: number;
  notMet: number;
  unavailable: number;
  total: number;
  label: RegimeLabel;
  /** The lowest and highest label the score could end at if the unavailable inputs came out against or for the thresholds. */
  labelRange: { lowest: Exclude<RegimeLabel, "undetermined">; highest: Exclude<RegimeLabel, "undetermined"> };
  verdict: string;
}

// ---------------------------------------------------------------------------------------------------
// Input helpers

/** Simple average of the last `n` values, or null when there are fewer than `n`. */
export function sma(values: number[], n: number): number | null {
  if (n <= 0 || values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

/**
 * Change in a daily series over `lookbackDays`: last value over the value `lookbackDays` entries earlier, minus 1.
 * Same indexing as the dashboard (the entry 31 from the end for a 30-day change). Null when the series is too short or
 * the earlier value is not positive.
 */
export function seriesChange(series: number[], lookbackDays = 30): number | null {
  if (series.length < lookbackDays + 1) return null;
  const last = series[series.length - 1];
  const earlier = series[series.length - 1 - lookbackDays];
  return earlier > 0 ? last / earlier - 1 : null;
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

function parseFlowNumber(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!t) return null;
  const m = t.match(/^\(?(-?\d+(?:\.\d+)?)\)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  return t.startsWith("(") ? -Math.abs(v) : v;
}

function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

/**
 * Daily net flow totals ($M) from the HTML of Farside Investors' US spot BTC ETF table. Rows are the ones whose first cell is a
 * date such as "09 Oct 2026"; the last cell is the all-fund total, with negatives in brackets. Summary rows (Total, Average,
 * Maximum, Minimum) are ignored. Returns an empty list when the layout is not recognised, so the caller can say so.
 */
export function parseFarsideTotals(html: string): { day: string; flowMusd: number }[] {
  const out: { day: string; flowMusd: number }[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => decodeEntities(c.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
    if (cells.length < 3) continue;
    const m = cells[0].match(/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
    if (!m || !MONTHS[m[2]]) continue;
    const total = parseFlowNumber(cells[cells.length - 1]);
    if (total === null) continue;
    out.push({ day: `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`, flowMusd: total });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Sum of the daily flows in one calendar month (YYYY-MM). Null when no trading day of that month is posted yet. */
export function monthToDateFlows(rows: { day: string; flowMusd: number }[], month: string): { totalMusd: number; days: number; lastDay: string } | null {
  const inMonth = rows.filter((r) => r.day.startsWith(month));
  if (inMonth.length === 0) return null;
  return { totalMusd: inMonth.reduce((s, r) => s + r.flowMusd, 0), days: inMonth.length, lastDay: inMonth[inMonth.length - 1].day };
}

// ---------------------------------------------------------------------------------------------------
// Scoring

function status(reading: number | null, test: (v: number) => boolean): CheckStatus {
  if (reading === null || !Number.isFinite(reading)) return "unavailable";
  return test(reading) ? "met" : "not-met";
}

export function labelForCount(met: number): Exclude<RegimeLabel, "undetermined"> {
  if (met >= REGIME_THRESHOLDS.breakoutMin) return "breakout";
  if (met >= REGIME_THRESHOLDS.mixedMin) return "mixed";
  return "range-bound";
}

const VERDICT: Record<RegimeLabel, string> = {
  breakout: "Conditions favor a breakout",
  mixed: "Mixed: the range is under pressure",
  "range-bound": "Range-bound regime holds",
  undetermined: "Undetermined",
};

export function scoreCryptoRegime(x: RegimeInputs): CryptoRegime {
  const t = REGIME_THRESHOLDS;
  const btcVsAverage = x.btcClose !== null && x.btcSma200 !== null && x.btcSma200 > 0 ? x.btcClose / x.btcSma200 - 1 : null;
  const checks: RegimeCheck[] = [
    { key: "stablecoin-supply", label: "Stablecoin supply growing", reading: x.stablecoinChange30d, unit: "pct", threshold: "Above +2% over 30 days", status: status(x.stablecoinChange30d, (v) => v > t.stablecoinChange30d) },
    { key: "etf-flows", label: "Spot BTC ETF inflows this month", reading: x.etfFlowsMtdMusd, unit: "musd", threshold: "Net positive month to date", status: status(x.etfFlowsMtdMusd, (v) => v > 0) },
    { key: "btc-dominance", label: "Money rotating out of BTC", reading: x.btcDominance, unit: "share", threshold: "BTC dominance below 55%", status: status(x.btcDominance, (v) => v < t.btcDominance) },
    { key: "btc-200d", label: "BTC above 200-day average", reading: btcVsAverage, unit: "ratio-to-average", threshold: "Price above the average", status: status(btcVsAverage, (v) => v > 0) },
    { key: "us10y", label: "10-yr yield easing", reading: x.us10yPct, unit: "yield", threshold: "Below 5.0%", status: status(x.us10yPct, (v) => v < t.us10yPct) },
    { key: "fear-greed", label: "Sentiment not euphoric", reading: x.fearGreed, unit: "index", threshold: "Fear & Greed below 80", status: status(x.fearGreed, (v) => v < t.fearGreed) },
  ];
  const met = checks.filter((c) => c.status === "met").length;
  const unavailable = checks.filter((c) => c.status === "unavailable").length;
  const lowest = labelForCount(met);
  const highest = labelForCount(met + unavailable);
  const label: RegimeLabel = lowest === highest ? lowest : "undetermined";
  const verdict =
    label === "undetermined"
      ? `${VERDICT.undetermined}: ${met} met and ${unavailable} unavailable, so the regime could be anywhere from ${lowest} to ${highest} once the missing input is known.`
      : `${VERDICT[label]}: ${met} of ${checks.length} breakout conditions are met${unavailable ? `, ${unavailable} unavailable` : ""}.`;
  return { checks, met, notMet: checks.length - met - unavailable, unavailable, total: checks.length, label, labelRange: { lowest, highest }, verdict };
}
