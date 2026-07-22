// Pure, zero-dependency — deliberately kept out of chart-bars.ts (which
// transitively imports market-data.ts -> schwab.ts -> schwab-auth.ts's
// node:fs/promises) so client components can import TIMEFRAME_PRESETS
// without pulling server-only code into the browser bundle. Same pattern as
// asset-class-label.ts / options-flow-skew.ts.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TimeframePreset {
  id: string;
  label: string;
  alpacaTimeframe: string | null; // null = not available
  lookbackMs: number;
  unavailableReason: string | null;
}

/**
 * Each preset bundles a candle interval + a sensible lookback window, same
 * shape as retail chart widgets (Yahoo Finance's 1D/5D/1M/6M/1Y/5Y buttons) —
 * the user's requested timeframe list mixes range-like and interval-like
 * labels, so this is the natural reading. Alpaca's timeframe param accepts
 * these {N}Min/{N}Hour/1Day/1Week strings directly and aggregates
 * server-side (see alpaca.ts).
 */
export const TIMEFRAME_PRESETS: TimeframePreset[] = [
  { id: "5yr", label: "5yr", alpacaTimeframe: "1Week", lookbackMs: 5 * 365 * DAY_MS, unavailableReason: null },
  { id: "1yr", label: "1yr", alpacaTimeframe: "1Day", lookbackMs: 365 * DAY_MS, unavailableReason: null },
  { id: "6mo", label: "6mo", alpacaTimeframe: "1Day", lookbackMs: 182 * DAY_MS, unavailableReason: null },
  { id: "1mo", label: "1mo", alpacaTimeframe: "1Day", lookbackMs: 30 * DAY_MS, unavailableReason: null },
  { id: "1wk", label: "1wk", alpacaTimeframe: "1Hour", lookbackMs: 7 * DAY_MS, unavailableReason: null },
  { id: "4hr", label: "4hr", alpacaTimeframe: "4Hour", lookbackMs: 60 * DAY_MS, unavailableReason: null },
  { id: "1hr", label: "1hr", alpacaTimeframe: "1Hour", lookbackMs: 20 * DAY_MS, unavailableReason: null },
  { id: "30min", label: "30min", alpacaTimeframe: "30Min", lookbackMs: 10 * DAY_MS, unavailableReason: null },
  { id: "15min", label: "15min", alpacaTimeframe: "15Min", lookbackMs: 5 * DAY_MS, unavailableReason: null },
  { id: "10min", label: "10min", alpacaTimeframe: "10Min", lookbackMs: 5 * DAY_MS, unavailableReason: null },
  { id: "5min", label: "5min", alpacaTimeframe: "5Min", lookbackMs: 3 * DAY_MS, unavailableReason: null },
  { id: "1min", label: "1min", alpacaTimeframe: "1Min", lookbackMs: 2 * DAY_MS, unavailableReason: null },
  {
    id: "1sec",
    label: "1sec",
    alpacaTimeframe: null,
    lookbackMs: 0,
    unavailableReason: "No free tick-data source available — Alpaca's finest granularity is 1 minute.",
  },
];
