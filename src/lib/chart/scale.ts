// Pure: price-scale mode choice for the chart. Linear scales exaggerate old moves on multi-year charts, so long ranges
// default to log; the user's explicit choice is remembered for the browser session.

export type ScaleMode = "linear" | "log" | "percent";
export const SCALE_MODES: readonly ScaleMode[] = ["linear", "log", "percent"];

export const SCALE_LABELS: Record<ScaleMode, string> = { linear: "Linear", log: "Log", percent: "Percent" };

/** One line saying what the axis means, shown on the chart so a log or percent axis is never mistaken for a price axis. */
export const SCALE_DESCRIPTIONS: Record<ScaleMode, string> = {
  linear: "Price axis, equal dollar steps",
  log: "Log price axis: equal steps are equal percent moves",
  percent: "Percent axis: change from the first visible bar (0%)",
};

/** Ranges of this many days or more default to the log scale (2 years). */
export const LOG_DEFAULT_MIN_RANGE_DAYS = 2 * 365;

/** Default scale for a lookback window. Log needs positive prices; callers that have non-positive data must use linear. */
export function defaultScaleMode(lookbackMs: number): ScaleMode {
  return lookbackMs >= LOG_DEFAULT_MIN_RANGE_DAYS * 86_400_000 ? "log" : "linear";
}

export function parseScaleMode(value: unknown): ScaleMode | null {
  return typeof value === "string" && (SCALE_MODES as readonly string[]).includes(value) ? (value as ScaleMode) : null;
}

/** The scale in force: the user's choice if any, else the default for the range. A log choice falls back to linear when any price is not above zero. */
export function effectiveScaleMode(userChoice: ScaleMode | null, lookbackMs: number, minPrice: number | null): ScaleMode {
  const mode = userChoice ?? defaultScaleMode(lookbackMs);
  if (mode === "log" && !(minPrice !== null && minPrice > 0)) return "linear";
  return mode;
}

const KEY = "dellegate.chart.scaleMode";

/** Reads the session's remembered scale choice. Never throws (private windows and blocked storage return null). */
export function loadScaleChoice(store: Pick<Storage, "getItem"> | null = safeSession()): ScaleMode | null {
  try {
    return parseScaleMode(store?.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveScaleChoice(mode: ScaleMode, store: Pick<Storage, "setItem"> | null = safeSession()): void {
  try {
    store?.setItem(KEY, mode);
  } catch {
    /* storage unavailable: the choice just lasts until reload */
  }
}

function safeSession(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
