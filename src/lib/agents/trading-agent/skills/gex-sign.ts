import type { FlowAtWalls, GexRegime, GexSignalResult, QuadrantLabel, TermStructureSignal } from "../types";

/**
 * Pure and client-safe (type-only imports), so the dashboard can re-read a computed GEX signal under the other dealer
 * assumption without another request.
 *
 * The signal is computed with "app": dealers short the calls and long the puts customers trade, so put gamma counts
 * positive. "standard" is the reverse (the usual reading when customers buy puts to hedge and sell calls to earn income):
 * dealers long the calls and short the puts, so call gamma counts positive. Neither can be confirmed from public data.
 * The walls, the zero-gamma level and the balance of the two sides do not depend on the choice; the regime label, the
 * sign of net gamma and the volatility half of the quadrant do.
 */
export type DealerSignMode = "app" | "standard";

/** The one default for every dealer-positioning toggle (Options dashboard and Gamma Heat Map share a single setting). */
export const DEFAULT_DEALER_SIGN: DealerSignMode = "standard";

/** Toggle wording and order, shared by every control: "standard" first. "(as logged)" marks the convention the forward paper-backtest log records. */
export const DEALER_SIGN_LABELS: Record<DealerSignMode, string> = {
  standard: "Dealers long calls, short puts",
  app: "Dealers short calls, long puts (as logged)",
};

/** Validates a stored value. Anything that is not exactly "app" or "standard" (missing, corrupt, from an older build) falls back to the default. */
export function parseDealerSign(raw: unknown): DealerSignMode {
  return raw === "app" || raw === "standard" ? raw : DEFAULT_DEALER_SIGN;
}

/** Direction comes from which wall has seen more of today's flow; the volatility half follows the regime (and backwardation). */
export function classifyQuadrant(regime: GexRegime, term: TermStructureSignal | null, flow: FlowAtWalls): QuadrantLabel {
  const callScore = flow.callWallFlowRatio ?? 0;
  const putScore = flow.putWallFlowRatio ?? 0;
  const direction = callScore >= putScore ? "bullish" : "bearish";

  let volRegime: "stable" | "volatile" = regime.regime === "positive" ? "stable" : "volatile";
  // Backwardation nudges toward "volatile" even in positive GEX, since it
  // signals the market is pricing a near-term catalyst.
  if (term?.shape === "backwardation" && volRegime === "stable") volRegime = "volatile";

  return `${direction}-${volRegime}` as QuadrantLabel;
}

/**
 * The signal as it reads under `mode`. "app" returns the signal untouched. "standard" flips the regime label, the sign of
 * total net gamma and of net-to-gross, swaps the opposite-convention label, and recomputes the quadrant (and so the strategy
 * ideas that follow from it). The input is never modified.
 */
export function applyDealerSign(signal: GexSignalResult, mode: DealerSignMode): GexSignalResult {
  if (mode === "app") return signal;
  const g = signal.gexRegime;
  const regime = g.regime === "positive" ? "negative" : "positive";
  const gexRegime: GexRegime = {
    ...g,
    regime,
    totalNetGex: -g.totalNetGex,
    netToGrossPct: g.netToGrossPct == null ? g.netToGrossPct : -g.netToGrossPct,
    regimeOppositeConvention: g.regime,
  };
  const quadrant = signal.quadrant === null ? null : classifyQuadrant(gexRegime, signal.termStructure, signal.flowAtWalls);
  return {
    ...signal,
    gexRegime,
    quadrant,
    dataLimitations: [
      ...signal.dataLimitations,
      "Shown with dealers long the calls and short the puts (the dealer-positioning setting). The strategy ideas below follow this setting. The forward paper-backtest log records the other convention (dealers short calls, long puts).",
    ],
  };
}
