import type {
  GuidedTradeSignal,
  PaperOrderAttribution,
  PaperOrderOrigin,
  PaperOrderSource,
  PaperSignalKpis,
} from "@/lib/agents/trading-agent/types";

/**
 * Attribution arrives from a public, anonymous-session route (and from Faye's
 * widget), so it is untrusted input. Only whitelisted fields survive, numbers
 * must be finite and in a plausible range, strings are length-capped, and
 * anything unrecognised is dropped. The result is stored as jsonb and copied
 * to the trade log, so it must never carry free-form content.
 */

const ORIGINS: PaperOrderOrigin[] = ["ui", "faye", "api"];
const SOURCES: PaperOrderSource[] = ["guided_signal", "backtest", "manual"];

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
}

function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v >= min && v <= max ? v : null;
}

function sanitizeKpis(raw: unknown): PaperSignalKpis | null {
  if (!raw || typeof raw !== "object") return null;
  const k = raw as Record<string, unknown>;
  const out: PaperSignalKpis = {
    historicalWinRatePct: num(k.historicalWinRatePct, 0, 100),
    sampleSize: num(k.sampleSize, 0, 1_000_000),
    bootstrapCiLower: num(k.bootstrapCiLower, -100, 100),
    bootstrapCiUpper: num(k.bootstrapCiUpper, -100, 100),
    profitFactor: num(k.profitFactor, 0, 1000),
    largestLossPct: num(k.largestLossPct, -1000, 1000),
    maxDrawdownPct: num(k.maxDrawdownPct, -1000, 1000),
    horizonLabel: str(k.horizonLabel, 40),
    entryRule: str(k.entryRule, 300),
    exitRule: str(k.exitRule, 300),
    signalPrice: num(k.signalPrice, 0, 10_000_000),
  };
  const any = Object.values(out).some((v) => v !== null);
  return any ? out : null;
}

/**
 * Returns a clean attribution, or null when the caller sent nothing usable.
 * `defaultOrigin` is what to record when the caller did not say; an order with
 * no strategy at all is still worth logging as a manual trade, so a non-null
 * result is returned whenever `alwaysLog` is set.
 */
export function sanitizeAttribution(
  raw: unknown,
  defaultOrigin: PaperOrderOrigin = "api",
  alwaysLog = true
): PaperOrderAttribution | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const origin = ORIGINS.includes(r.origin as PaperOrderOrigin) ? (r.origin as PaperOrderOrigin) : defaultOrigin;
  const strategyType = str(r.strategyType, 80);
  const kpis = sanitizeKpis(r.kpis);
  // A source other than "manual" is only believed when it names a strategy;
  // otherwise "guided_signal" would be an unverifiable label on a plain order.
  let source: PaperOrderSource = SOURCES.includes(r.source as PaperOrderSource) ? (r.source as PaperOrderSource) : "manual";
  if (source !== "manual" && !strategyType) source = "manual";
  const attribution: PaperOrderAttribution = {
    origin,
    source,
    strategyType,
    strategyLabel: str(r.strategyLabel, 120),
    hypothesisId: str(r.hypothesisId, 64),
    kpis,
  };
  if (!alwaysLog && source === "manual" && !strategyType && !kpis) return null;
  return attribution;
}

/** The attribution for a trade taken from a Guided Trade Signal card. */
export function attributionFromSignal(signal: GuidedTradeSignal, origin: PaperOrderOrigin): PaperOrderAttribution {
  return {
    origin,
    source: "guided_signal",
    strategyType: signal.strategyType,
    strategyLabel: signal.headline,
    hypothesisId: null,
    kpis: {
      historicalWinRatePct: signal.historicalWinRatePct,
      sampleSize: signal.sampleSize,
      bootstrapCiLower: signal.bootstrapCiLower,
      bootstrapCiUpper: signal.bootstrapCiUpper,
      profitFactor: null,
      largestLossPct: signal.largestLossPct,
      maxDrawdownPct: signal.maxDrawdownPct,
      horizonLabel: signal.horizonLabel,
      entryRule: signal.entryRule,
      exitRule: signal.exitRule,
      signalPrice: signal.currentPrice,
    },
  };
}
