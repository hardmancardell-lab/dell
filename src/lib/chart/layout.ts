// Pure: indicator presets, the saved chart layout (overlays, oscillators, scale mode, timeframe, SMAs, adjustment), and its
// localStorage persistence. Everything read back is validated: a layout from an older version, another browser or a
// tampered value can only ever select indicators, timeframes and modes that exist.
import { INDICATORS, OSCILLATOR_IDS, OVERLAY_IDS } from "./indicators";
import { parseScaleMode, type ScaleMode } from "./scale";
import { parseBarAdjustment, type BarAdjustment } from "../data/market-data-types";
import { TIMEFRAME_PRESETS } from "../agents/trading-agent/skills/timeframe-presets";

export interface IndicatorPreset {
  id: string;
  label: string;
  description: string;
  overlays: string[];
  oscillators: string[];
}

/** Built-in indicator sets. Nothing here is a recommendation: each is a common grouping of what the lines measure. */
export const INDICATOR_PRESETS: readonly IndicatorPreset[] = [
  { id: "clean", label: "Clean", description: "Price only, no indicators", overlays: [], oscillators: [] },
  { id: "trend", label: "Trend", description: "Moving averages and Ichimoku: direction and smoothing", overlays: ["ema20", "ema50", "ichimoku"], oscillators: [] },
  { id: "momentum", label: "Momentum", description: "RSI and MACD: speed of recent moves", overlays: [], oscillators: ["rsi", "macd"] },
  { id: "volatility", label: "Volatility", description: "Bollinger Bands and ATR: how far price is moving", overlays: ["bollinger"], oscillators: ["atr"] },
  { id: "volume", label: "Volume", description: "VWAP, OBV and CMF: volume-based lines (IEX volume is one exchange)", overlays: ["vwap"], oscillators: ["obv", "cmf"] },
];

export function presetById(id: string): IndicatorPreset | undefined {
  return INDICATOR_PRESETS.find((p) => p.id === id);
}

export interface ChartLayout {
  version: 1;
  overlays: string[];
  oscillators: string[];
  /** The user's explicit scale choice, or null for "default for the range". */
  scale: ScaleMode | null;
  timeframe: string;
  showSma20: boolean;
  showSma50: boolean;
  adjustment: BarAdjustment;
  includeExtended: boolean;
  savedAt: string;
}

const KEY = "dellegate.chart.layout.v1";
const idsIn = (x: unknown, allowed: readonly string[]): string[] => {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const v of x) if (typeof v === "string" && allowed.includes(v) && !out.includes(v)) out.push(v);
  return out;
};

/** A clean layout from anything, or null when it is not an object. Unknown fields are dropped, unknown ids and timeframes ignored. */
export function validateLayout(x: unknown): ChartLayout | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const timeframe = typeof o.timeframe === "string" && TIMEFRAME_PRESETS.some((p) => p.id === o.timeframe && p.alpacaTimeframe) ? o.timeframe : "1yr";
  return {
    version: 1,
    overlays: idsIn(o.overlays, OVERLAY_IDS),
    oscillators: idsIn(o.oscillators, OSCILLATOR_IDS),
    scale: parseScaleMode(o.scale),
    timeframe,
    showSma20: typeof o.showSma20 === "boolean" ? o.showSma20 : true,
    showSma50: typeof o.showSma50 === "boolean" ? o.showSma50 : true,
    adjustment: parseBarAdjustment(o.adjustment),
    includeExtended: typeof o.includeExtended === "boolean" ? o.includeExtended : true,
    savedAt: typeof o.savedAt === "string" ? o.savedAt.slice(0, 40) : "",
  };
}

export function loadLayout(store: Pick<Storage, "getItem"> | null = safeLocal()): ChartLayout | null {
  try {
    const raw = store?.getItem(KEY);
    return raw ? validateLayout(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLayout(layout: ChartLayout, store: Pick<Storage, "setItem"> | null = safeLocal()): boolean {
  try {
    if (!store) return false;
    store.setItem(KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function clearLayout(store: Pick<Storage, "removeItem"> | null = safeLocal()): boolean {
  try {
    if (!store) return false;
    store.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

function safeLocal(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The preset whose indicator set equals the given one exactly, if any (to show it as selected). */
export function matchingPreset(overlays: ReadonlySet<string>, oscillators: ReadonlySet<string>): IndicatorPreset | undefined {
  return INDICATOR_PRESETS.find(
    (p) => p.overlays.length === overlays.size && p.oscillators.length === oscillators.size && p.overlays.every((i) => overlays.has(i)) && p.oscillators.every((i) => oscillators.has(i))
  );
}

/** Sanity check used by the test: every preset id exists in the indicator catalogue and sits in the right group. */
export function presetsAreConsistent(): boolean {
  return INDICATOR_PRESETS.every(
    (p) => p.overlays.every((i) => INDICATORS.some((d) => d.id === i && d.group === "overlay")) && p.oscillators.every((i) => INDICATORS.some((d) => d.id === i && d.group === "oscillator"))
  );
}
