// Pure and client-safe (no server imports): describes where a chart's bars came from, so the chart header can say it
// instead of leaving the reader to assume. Nothing here invents a fact: when a provider did not say something, the field
// is null and the label says "not stated".
import { DELAYED_AFTER_MS } from "../data/market-data-types";
import type { BarAdjustment, MarketCandle } from "../data/market-data-types";

export interface ChartBarsMeta {
  /** Provider that answered ("Alpaca", "OANDA", "Coinbase", "Schwab"), null when unknown. */
  provider: string | null;
  /** Feed of the newest bar ("iex", "oanda-mid", "coinbase", "mock"), null when the bars carry none. */
  feed: string | null;
  /** Adjustment the provider applied; null when the provider has no such concept (forex, crypto). */
  adjustment: BarAdjustment | null;
  /** Epoch ms the newest bar's values are valid as of: the bar's own `asOf` when given, else the bar's end (open time + bar length). Null with no bars. */
  asOf: number | null;
  /** Bar length in ms (for example 300000 for 5Min). */
  barMs: number;
  /** True when the provider flagged the newest bar as delayed, or (derived) it is older than expected for a live market. Null when unknown. */
  delayed: boolean | null;
  /** Where `delayed` came from: the provider's own flag, or a rule applied to the bar age (can be wrong on a holiday). */
  delayedSource: "provider" | "derived" | null;
  /** True for generated (mock-mode) data. */
  synthetic: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Bar length in ms from an Alpaca-style timeframe string ("5Min", "1Hour", "1Day", "1Week"). */
export function barMsFromTimeframe(timeframe: string | null | undefined): number {
  const m = /^(\d+)(Min|Hour|Day|Week|Month)$/.exec(timeframe ?? "");
  if (!m) return DAY_MS;
  const n = Number(m[1]);
  switch (m[2]) {
    case "Min":
      return n * MINUTE_MS;
    case "Hour":
      return n * HOUR_MS;
    case "Week":
      return n * 7 * DAY_MS;
    case "Month":
      return n * 30 * DAY_MS;
    default:
      return n * DAY_MS;
  }
}

/** Minutes since midnight and weekday (0 = Sunday) in America/New_York for an instant. */
export function easternClock(ms: number): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** True during US regular hours on a weekday (09:45 to 15:45 ET, trimmed so open and close jitter is not flagged). Holidays are not known. */
export function isLikelyLiveEquitySession(ms: number): boolean {
  const { weekday, minutes } = easternClock(ms);
  return weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 + 45 && minutes <= 15 * 60 + 45;
}

/**
 * Builds the chart header facts from the bars. `delayed` is the provider's flag when the bar has one. Otherwise, for
 * intraday bars only, it is derived: a 24/7 market (crypto) or a US equity during regular hours whose newest bar ended
 * more than max(3 bars, DELAYED_AFTER_MS) ago is flagged delayed (source "derived"). Daily and longer bars, closed
 * markets and forex stay null (unknown) rather than guessed.
 */
export function deriveChartMeta(
  candles: readonly MarketCandle[],
  opts: { provider?: string | null; adjustment?: BarAdjustment | null; timeframe?: string | null; assetKind?: "equity" | "crypto" | "forex" | "other"; nowMs?: number }
): ChartBarsMeta {
  const nowMs = opts.nowMs ?? Date.now();
  const barMs = barMsFromTimeframe(opts.timeframe);
  const last = candles.length ? candles[candles.length - 1] : null;
  const synthetic = Boolean(last?.synthetic);
  const asOf = last ? (Number.isFinite(last.asOf) ? (last.asOf as number) : last.datetime + barMs) : null;

  let delayed: boolean | null = null;
  let delayedSource: ChartBarsMeta["delayedSource"] = null;
  if (last && typeof last.delayed === "boolean") {
    // Only a flag that says "delayed" is trusted as such; `false` from a provider is also the provider's statement.
    delayed = last.delayed;
    delayedSource = "provider";
  } else if (last && !synthetic && barMs < DAY_MS && asOf !== null) {
    const age = nowMs - asOf;
    const threshold = Math.max(3 * barMs, DELAYED_AFTER_MS);
    const kind = opts.assetKind ?? "other";
    if (kind === "crypto" || (kind === "equity" && isLikelyLiveEquitySession(nowMs))) {
      delayed = age > threshold;
      delayedSource = "derived";
    }
  }
  return {
    provider: opts.provider ?? null,
    feed: last?.feed ?? null,
    adjustment: opts.adjustment ?? null,
    asOf,
    barMs,
    delayed,
    delayedSource,
    synthetic,
  };
}

/** One plain sentence about what a feed's prices and volume are. Unknown feeds are said to be unknown. */
export function describeFeed(feed: string | null | undefined): { short: string; volumeNote: string } {
  switch (feed) {
    case "iex":
      return { short: "IEX feed", volumeNote: "IEX: one exchange, volume is a fraction of the consolidated tape" };
    case "coinbase":
      return { short: "Coinbase", volumeNote: "Coinbase only: one venue's volume, in coins" };
    case "oanda-mid":
      return { short: "OANDA mid prices", volumeNote: "OANDA tick count, not traded volume (forex has no consolidated tape)" };
    case "mock":
      return { short: "Synthetic (mock) data", volumeNote: "Synthetic volume: not market data" };
    default:
      return { short: feed ? `Feed: ${feed}` : "Feed not stated", volumeNote: "Volume source not stated by the provider" };
  }
}

export function describeAdjustment(adj: BarAdjustment | null | undefined): string {
  switch (adj) {
    case "split":
      return "Split-adjusted";
    case "all":
      return "Split and dividend adjusted";
    case "raw":
      return "Unadjusted";
    default:
      return "Adjustment not applicable";
  }
}

/** "5 min ago", "2 h ago", "3 d ago" for an age in ms; "just now" under 45 s. */
export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "just now";
  if (ageMs < 45_000) return "just now";
  if (ageMs < HOUR_MS) return `${Math.round(ageMs / MINUTE_MS)} min ago`;
  if (ageMs < DAY_MS) return `${Math.round(ageMs / HOUR_MS)} h ago`;
  return `${Math.round(ageMs / DAY_MS)} d ago`;
}

/** The legend text for the volume histogram: names the unit and the source. */
export function volumeLegendLabel(feed: string | null | undefined, adjustment: BarAdjustment | null | undefined): string {
  const note = describeFeed(feed).volumeNote;
  const adj = adjustment === "split" || adjustment === "all" ? "; split-adjusted shares" : "";
  return `Volume (bars below the price): ${note}${adj}`;
}
