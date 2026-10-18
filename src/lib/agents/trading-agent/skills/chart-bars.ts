import { classifySymbol, fetchBarsForTimeframeDetailed, fetchCorporateEvents } from "@/lib/data/market-data";
import { TIMEFRAME_PRESETS } from "./timeframe-presets";
import { deriveChartMeta, type ChartBarsMeta } from "@/lib/chart/meta";
import { DEFAULT_BAR_ADJUSTMENT, type BarAdjustment, type CorporateEventsResult, type MarketCandle } from "@/lib/data/market-data-types";

export interface ChartBarsResult {
  symbol: string;
  timeframe: string;
  candles: MarketCandle[];
  dataLimitations: string[];
  /** Where the bars came from: provider, feed, adjustment, as-of time and delay flag (see src/lib/chart/meta.ts). */
  meta: ChartBarsMeta;
}

/**
 * centerDateKey (YYYY-MM-DD), when given, centers the preset's lookback
 * window on that date instead of ending at "now" — used to jump a chart
 * straight to a specific historical occurrence (e.g. a backtest trade-log
 * row) rather than always showing the most recent window.
 *
 * adjustment: "split" by default so a split is not drawn as a crash. Only equities and ETFs honour it; the result's
 * meta.adjustment says what was actually applied (null for forex and crypto).
 */
export async function getChartBars(
  symbol: string,
  timeframeId: string,
  centerDateKey?: string,
  adjustment: BarAdjustment = DEFAULT_BAR_ADJUSTMENT
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
  const result = await fetchBarsForTimeframeDetailed(symbol, preset.alpacaTimeframe, startMs, endMs, 60, { adjustment });
  for (const w of result.report.warnings) if (!dataLimitations.includes(w)) dataLimitations.push(w);
  const kind = classifySymbol(symbol).kind;
  const meta = deriveChartMeta(result.candles, {
    provider: result.provider ?? null,
    adjustment: result.adjustment ?? null,
    timeframe: preset.alpacaTimeframe,
    assetKind: kind === "equity" || kind === "crypto" || kind === "forex" ? kind : "other",
  });

  return {
    symbol: symbol.trim().toUpperCase(),
    timeframe: timeframeId,
    candles: result.candles,
    dataLimitations,
    meta,
  };
}

/** Splits and dividends inside the same window a chart preset shows. Never throws (see fetchCorporateEvents). */
export async function getChartEvents(symbol: string, timeframeId: string, centerDateKey?: string): Promise<CorporateEventsResult> {
  const preset = TIMEFRAME_PRESETS.find((p) => p.id === timeframeId);
  if (!preset || !preset.alpacaTimeframe) return { events: [], available: false, reason: "Unknown timeframe." };
  const now = Date.now();
  const centerMs = centerDateKey ? Date.parse(`${centerDateKey}T12:00:00Z`) : NaN;
  const startMs = Number.isFinite(centerMs) ? centerMs - preset.lookbackMs / 2 : now - preset.lookbackMs;
  const endMs = Number.isFinite(centerMs) ? Math.min(now, centerMs + preset.lookbackMs / 2) : now;
  return fetchCorporateEvents(symbol, startMs, endMs);
}
