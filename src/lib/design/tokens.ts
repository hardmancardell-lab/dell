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

/**
 * CHARACTER palette: skin, hair and clothing colours for the full-body characters (the advisor, src/components/faye/).
 * Added 2026-10-21 at the owner's request ("skin tone brown with an afro for hair and a cute pants suit on with
 * glasses"). The Jarvis set has no human skin tones, so these live in their own clearly named group instead of
 * pretending to be semantic colours. They are NOT for text, charts or UI chrome. globals.css mirrors them under
 * .jarvis (as --skin-*, --hair-*, --suit-*, --blouse-*, --shoe-*, --lip-*, --frame-*) and
 * scripts/quality/check-design-tokens.cjs fails on drift, the same as for JARVIS.
 * Skin runs light to deep, each with a shade for the second gradient stop; "skinMediumDeep" is the owner's choice and
 * the default. Suits come in three options (plum, teal, amber), each as base, shade and light (piping, highlights).
 */
export const CHARACTER = {
  skinFair: "#f1cfb3",
  skinFairShade: "#d9ab8c",
  skinTan: "#d3a07a",
  skinTanShade: "#b57f5c",
  skinMedium: "#b07a56",
  skinMediumShade: "#8f5e40",
  skinMediumDeep: "#9a6542",
  skinMediumDeepShade: "#774b30",
  skinDeep: "#6e4430",
  skinDeepShade: "#52311f",
  hairBlack: "#1b1412",
  hairEspresso: "#2e1d16",
  hairChestnut: "#5b3a28",
  hairSheen: "#8a6552",
  suitPlum: "#8c4c7d",
  suitPlumShade: "#6a3860",
  suitPlumLight: "#c28db4",
  suitTeal: "#1f7a7d",
  suitTealShade: "#13575b",
  suitTealLight: "#5fc4c0",
  suitAmber: "#c98a4b",
  suitAmberShade: "#9a6532",
  suitAmberLight: "#f0c28a",
  blouseIvory: "#f4ece1",
  shoeBlush: "#dcc4b0",
  lipBerry: "#a8475c",
  frameRose: "#e3ab93",
  frameGold: "#d9b05f",
  frameIvory: "#efe6d8",
} as const;

/** CSS custom property for each CHARACTER token (camelCase to kebab, the same rule as the rig's tokenVarName). */
export const CHARACTER_CSS_NAMES: Record<keyof typeof CHARACTER, string> = {
  skinFair: "skin-fair",
  skinFairShade: "skin-fair-shade",
  skinTan: "skin-tan",
  skinTanShade: "skin-tan-shade",
  skinMedium: "skin-medium",
  skinMediumShade: "skin-medium-shade",
  skinMediumDeep: "skin-medium-deep",
  skinMediumDeepShade: "skin-medium-deep-shade",
  skinDeep: "skin-deep",
  skinDeepShade: "skin-deep-shade",
  hairBlack: "hair-black",
  hairEspresso: "hair-espresso",
  hairChestnut: "hair-chestnut",
  hairSheen: "hair-sheen",
  suitPlum: "suit-plum",
  suitPlumShade: "suit-plum-shade",
  suitPlumLight: "suit-plum-light",
  suitTeal: "suit-teal",
  suitTealShade: "suit-teal-shade",
  suitTealLight: "suit-teal-light",
  suitAmber: "suit-amber",
  suitAmberShade: "suit-amber-shade",
  suitAmberLight: "suit-amber-light",
  blouseIvory: "blouse-ivory",
  shoeBlush: "shoe-blush",
  lipBerry: "lip-berry",
  frameRose: "frame-rose",
  frameGold: "frame-gold",
  frameIvory: "frame-ivory",
};

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
