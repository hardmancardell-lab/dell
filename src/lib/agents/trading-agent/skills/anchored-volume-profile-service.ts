import { fetchBarsForTimeframe } from "@/lib/data/market-data";
import type { MarketCandle } from "@/lib/data/market-data-types";
import {
  buildAnchoredProfile,
  calendarForSymbol,
  fetchStartMs,
  listLevels,
  type AnchorSpec,
  type AnchoredProfileResult,
  type ProfileLevel,
  type SessionCalendar,
} from "./anchored-volume-profile";

export interface AnchoredVolumeProfileResponse {
  ticker: string;
  calendar: SessionCalendar;
  anchor: AnchoredProfileResult["anchor"];
  profile: Omit<AnchoredProfileResult, "anchor" | "candles">;
  levels: ProfileLevel[];
  /** The bars the profile was built from, 5-minute, oldest first. */
  candles: MarketCandle[];
  /** Latest bar close in the fetched data (may be after the anchored bars, e.g. when the anchor is a past session). */
  lastPrice: number | null;
  lastBarMs: number | null;
  asOf: string;
  dataLimitations: string[];
}

/** Fetches 5-minute bars through the app's provider routing and builds the anchored profile. */
export async function getAnchoredVolumeProfile(ticker: string, anchor: AnchorSpec, binCount: number): Promise<AnchoredVolumeProfileResponse> {
  const symbol = ticker.trim().toUpperCase();
  const calendar = calendarForSymbol(symbol);
  const now = Date.now();
  const bars = await fetchBarsForTimeframe(symbol, "5Min", fetchStartMs(anchor, now), now, 60);
  const sorted = [...bars].sort((a, b) => a.datetime - b.datetime);
  const { candles, anchor: info, ...profile } = buildAnchoredProfile(sorted, anchor, { calendar, binCount });
  const last = sorted.length ? sorted[sorted.length - 1] : null;

  const limits: string[] = [
    "Built from 5-minute bars, not ticks. Each bar's volume is spread evenly across its low-to-high range, so the profile is a smoothed estimate of where volume traded, not the true tick distribution.",
    "Nodes (HVN/LVN) are peaks and troughs of the profile after a light Gaussian smoothing; the POC is the centre of the busiest price bin. Bin width follows the price range, so levels are accurate to about one bin.",
    "A node is where volume traded earlier. Nothing here has been shown to make price react there: see VOLUME_NODE_STUDY_NOTES.md for the test of that.",
  ];
  if (calendar === "et") {
    limits.push("Regular session only (9:30 to 16:00 Eastern); premarket and after-hours bars are left out.");
    limits.push("Volume depends on the provider: on the Alpaca free tier it is IEX-only (a single exchange, a small share of consolidated volume), so absolute volumes are understated and the shape may differ from consolidated volume.");
  } else {
    limits.push("Crypto uses UTC calendar days as the session. Volume is Coinbase's own, one venue of many, and is counted in coins.");
  }
  if (process.env.MARKET_DATA_MOCK_MODE === "true" || process.env.SCHWAB_MOCK_MODE === "true") limits.push("Synthetic data (mock mode is set): not real market history.");
  if (candles.length === 0) limits.push("No bars were returned for that anchor, so there is no profile.");
  else if (candles.length < 30) limits.push(`Only ${candles.length} bars: a thin profile (a session is normally 78 five-minute bars).`);

  return {
    ticker: symbol,
    calendar,
    anchor: info,
    profile,
    levels: listLevels({ ...profile }),
    candles,
    lastPrice: last ? last.close : null,
    lastBarMs: last ? last.datetime : null,
    asOf: new Date(now).toISOString(),
    dataLimitations: limits,
  };
}
