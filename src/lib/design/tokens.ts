/**
 * The .jarvis design tokens as plain values, for places that cannot read CSS custom properties
 * (canvas charts, Phaser games, SVG attributes). globals.css stays the source of truth:
 * scripts/quality/check-design-tokens.cjs fails if any value here drifts from it, and counts hex
 * literals everywhere else so components import from here instead of copying colours.
 */
export const JARVIS = {
  ink950: "#080b10",
  ink900: "#0e131b",
  ink800: "#131a24",
  ink700: "#1a2330",
  line: "#223040",
  lineBright: "#35495e",
  lineControl: "#4a6683",
  signal: "#4fe8d0",
  signalDim: "#2a6e63",
  verdict: "#f0a868",
  verdictDim: "#7a5636",
  danger: "#e8637a",
  text0: "#edf2f7",
  text1: "#9fb0c4",
  text2: "#7b8ca2",
} as const;

/** Hex string to the 0xRRGGBB number Phaser expects for fills and strokes. */
export const toPhaserColor = (hex: string): number => parseInt(hex.slice(1), 16);

/** Categorical series colours for chart indicators (canvas cannot read CSS variables). Not part of the jarvis semantic palette. */
export const INDICATOR_COLORS = {
  ema20: "#8b5cf6",
  ema50: "#ec4899",
  bollinger: "#06b6d4",
  keltner: "#f97316",
  psar: "#eab308",
  hma: "#14b8a6",
  ichimokuTenkan: "#3b82f6",
  ichimokuKijun: "#ef4444",
  ichimokuSpanA: "#22c55e",
  ichimokuSpanB: "#f43f5e",
  ichimokuChikou: "#a855f7",
  vwap: "#0ea5e9",
  volumeProfile: "#84cc16",
  rsi: "#3b82f6",
  stochK: "#3b82f6",
  stochD: "#f59e0b",
  cci: "#8b5cf6",
  roc: "#14b8a6",
  williamsR: "#ec4899",
  macdLine: "#3b82f6",
  macdSignal: "#f59e0b",
  atr: "#f97316",
  obv: "#06b6d4",
  cmf: "#84cc16",
} as const;

/** Moving-average lines drawn under every price chart. */
export const SMA_COLORS = { sma20: "#3b82f6", sma50: "#f59e0b" } as const;

/** Volume histogram bars: signal / danger at partial opacity. */
export const VOLUME_BAR: { up: string; down: string } = { up: "rgba(79,232,208,0.5)", down: "rgba(232,99,122,0.5)" };
export const OSC_HIST: { up: string; down: string } = { up: "rgba(79,232,208,0.6)", down: "rgba(232,99,122,0.6)" };
