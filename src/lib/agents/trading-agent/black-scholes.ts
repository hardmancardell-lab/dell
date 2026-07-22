export type OptionType = "call" | "put";

export interface Greeks {
  /** Change in option price per $1 move in the underlying. */
  delta: number;
  /** Change in delta per $1 move in the underlying (same for calls and puts). */
  gamma: number;
  /** Change in option price per calendar day of time decay (already divided by 365). */
  theta: number;
  /** Change in option price per 1 percentage-point move in implied volatility (already divided by 100). */
  vega: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normPdf(x: number): number {
  return Math.exp((-x * x) / 2) / SQRT_2PI;
}

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 rational
 * approximation of erf. Max absolute error ~1.5e-7 — a deliberate, documented
 * approximation, not a placeholder shortcut (no stats library is installed
 * in this repo).
 */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1 + sign * y);
}

function d1d2(S: number, K: number, T: number, sigma: number, r: number): { d1: number; d2: number } {
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

function intrinsicValue(type: OptionType, S: number, K: number): number {
  return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
}

/**
 * Theoretical Black-Scholes price. At T <= 0 (0 DTE / expired), standard BS
 * divides by sqrt(T) = 0, so this short-circuits to intrinsic value instead
 * of letting NaN/Infinity propagate into the UI.
 */
export function blackScholesPrice(
  type: OptionType,
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number
): number {
  if (T <= 0) return intrinsicValue(type, S, K);

  const { d1, d2 } = d1d2(S, K, T, sigma, r);

  if (type === "call") {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Same 0-DTE guard as blackScholesPrice: returns zeroed greeks rather than
 * NaN/Infinity when there's no time value left.
 */
export function blackScholesGreeks(
  type: OptionType,
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number
): Greeks {
  if (T <= 0) {
    return { delta: type === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0, gamma: 0, theta: 0, vega: 0 };
  }

  const { d1, d2 } = d1d2(S, K, T, sigma, r);
  const pdfD1 = normPdf(d1);

  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdfD1 / (S * sigma * Math.sqrt(T));

  const rawVega = S * pdfD1 * Math.sqrt(T);
  const vega = rawVega / 100; // per 1 percentage-point IV move

  const term1 = -(S * pdfD1 * sigma) / (2 * Math.sqrt(T));
  const rawTheta =
    type === "call"
      ? term1 - r * K * Math.exp(-r * T) * normCdf(d2)
      : term1 + r * K * Math.exp(-r * T) * normCdf(-d2);
  const theta = rawTheta / 365; // per calendar day

  return { delta, gamma, theta, vega };
}
