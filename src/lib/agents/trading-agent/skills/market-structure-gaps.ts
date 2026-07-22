import type { UnavailableGap } from "../types";

export const MARKET_STRUCTURE_GAPS: UnavailableGap[] = [
  {
    label: "Sweep / Unusual Options Flow Detection",
    note: "Distinguishing an aggressive multi-exchange sweep from a resting limit order requires tick-by-tick, order-level options data. Schwab's REST chain/quote endpoints return snapshot OI/volume/Greeks, not individual order/trade-level flow — not available from this data source.",
  },
  {
    label: "Level 2 / Depth-of-Book Order Flow",
    note: "Schwab's market-data REST API provides top-of-book quotes, not full consolidated depth-of-book. A dedicated Level 2 data subscription would be needed for true order-flow depth.",
  },
  {
    label: "Multi-Day Open Interest Trend (the 1-2 week build-up view)",
    note: "The current options chain skill is a single-snapshot view. Tracking OI changes day-over-day at specific strikes requires storing daily chain snapshots over time — not built yet, a reasonable fast-follow once the snapshot view is verified working.",
  },
];
