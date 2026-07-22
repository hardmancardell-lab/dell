import { fetchBarsForTimeframe } from "@/lib/data/market-data";
import { TIMEFRAME_PRESETS } from "./timeframe-presets";
import type { MarketCandle } from "@/lib/data/market-data-types";

export interface ChartBarsResult {
  symbol: string;
  timeframe: string;
  candles: MarketCandle[];
  dataLimitations: string[];
}

/**
 * centerDateKey (YYYY-MM-DD), when given, centers the preset's lookback
 * window on that date instead of ending at "now" — used to jump a chart
 * straight to a specific historical occurrence (e.g. a backtest trade-log
 * row) rather than always showing the most recent window.
 */
export async function getChartBars(
  symbol: string,
  timeframeId: string,
  centerDateKey?: string
): Promise<ChartBarsResult> {
  const preset = TIMEFRAME_PRESETS.find((p) => p.id === timeframeId);
  if (!preset) {
    throw new Error(`Unknown timeframe "${timeframeId}".`);
  }
  if (!preset.alpacaTimeframe) {
    throw new Error(preset.unavailableReason ?? `Timeframe "${timeframeId}" is not available.`);
  }

  const dataLimitations: string[] = [];
  const isMockMode =
    process.env.MARKET_DATA_MOCK_MODE === "true" || process.env.SCHWAB_MOCK_MODE === "true";
  if (isMockMode) {
    dataLimitations.push("Synthetic data (MARKET_DATA_MOCK_MODE is set) — not real market history.");
  }

  const now = Date.now();
  let startMs: number;
  let endMs: number;
  if (centerDateKey) {
    // Midday UTC anchor avoids a date rolling to the prior/next calendar day
    // depending on server timezone when Date.parse()'d at midnight.
    const centerMs = Date.parse(`${centerDateKey}T12:00:00Z`);
    startMs = centerMs - preset.lookbackMs / 2;
    endMs = Math.min(now, centerMs + preset.lookbackMs / 2);
  } else {
    startMs = now - preset.lookbackMs;
    endMs = now;
  }
  const candles = await fetchBarsForTimeframe(symbol, preset.alpacaTimeframe, startMs, endMs, 60);

  return {
    symbol: symbol.trim().toUpperCase(),
    timeframe: timeframeId,
    candles,
    dataLimitations,
  };
}
