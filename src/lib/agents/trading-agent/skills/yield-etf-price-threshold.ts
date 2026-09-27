import { fetchFredSeries } from "@/lib/data/fred";
import { getDailyBars } from "./daily-bars";
import { linearRegression } from "../stats";

export interface YieldThresholdConversion {
  fredSeriesId: string;
  fredSeriesLabel: string;
  etfTicker: string;
  targetYieldPct: number;
  currentYieldPct: number;
  currentYieldDate: string;
  currentEtfPrice: number;
  targetEtfPrice: number;
  alertDirection: "above" | "below";
  regressionSlope: number;
  regressionRSquared: number;
  sampleSize: number;
  lookbackYears: number;
  dataLimitations: string[];
}

const TRADING_DAYS_PER_YEAR = 260;

/**
 * No intraday Treasury yield data exists anywhere this app can source for
 * free — FRED (the only yield provider here) is daily-close only, per
 * fred.ts's own "FRED series update at most daily" comment. This converts a
 * yield threshold into the equivalent price on a real, intraday-tradable
 * Treasury ETF (TLT/IEF/SHY) instead, so the existing price_threshold alert
 * type can be reused as-is — no new alert plumbing needed.
 *
 * The conversion is an OLS fit of the ETF's real daily closes against the
 * real FRED yield series' daily closes over the trailing window — an
 * empirically observed relationship, not a textbook duration formula. A
 * fund's real duration drifts as its underlying bonds mature and roll, so
 * this should be recomputed periodically, not treated as a fixed constant.
 */
export async function computeYieldThresholdEtfPrice(
  fredSeriesId: string,
  fredSeriesLabel: string,
  etfTicker: string,
  targetYieldPct: number,
  lookbackYears: number = 2
): Promise<YieldThresholdConversion> {
  const symbol = etfTicker.trim().toUpperCase();
  const lookbackDays = Math.round(lookbackYears * 365 + 15);
  const fredLimit = Math.round(lookbackYears * TRADING_DAYS_PER_YEAR + 20);

  const [yieldObs, bars] = await Promise.all([
    fetchFredSeries(fredSeriesId, fredLimit),
    getDailyBars(symbol, lookbackDays),
  ]);

  const priceByDate = new Map(bars.map((b) => [b.dateKey, b.close]));
  const pairs: { date: string; yield: number; price: number }[] = [];
  for (const obs of yieldObs) {
    if (obs.value === null) continue;
    const price = priceByDate.get(obs.date);
    if (price !== undefined) pairs.push({ date: obs.date, yield: obs.value, price });
  }

  if (pairs.length < 10) {
    throw new Error(
      `Only ${pairs.length} real overlapping trading day(s) found between ${fredSeriesId} and ${symbol} — too thin to fit a reliable price-yield relationship.`
    );
  }

  const reg = linearRegression(
    pairs.map((p) => p.yield),
    pairs.map((p) => p.price)
  );
  if (reg === null) {
    throw new Error(`Regression failed for ${fredSeriesId} vs ${symbol} — insufficient variance in the sample.`);
  }

  const latestPair = pairs[pairs.length - 1];
  const targetEtfPrice = reg.intercept + reg.slope * targetYieldPct;
  // A rising yield should push the ETF's price down (inverse relationship) —
  // so a threshold ABOVE today's yield means alerting when price falls
  // BELOW targetEtfPrice, and vice versa. Derived from the actual current
  // values rather than assumed from the regression's sign, so it stays
  // correct even for a series where the relationship runs the other way.
  const alertDirection: "above" | "below" = targetYieldPct >= latestPair.yield ? "below" : "above";

  const dataLimitations: string[] = [
    `No real intraday Treasury yield data exists anywhere this app can source for free (FRED, the only yield provider here, is daily-close only — see fred.ts). This converts your ${targetYieldPct}% ${fredSeriesLabel} threshold into an equivalent real ${symbol} price using an empirical fit of ${symbol}'s actual daily closes against ${fredSeriesId}'s actual daily closes over the trailing ${lookbackYears} year(s) (n=${pairs.length} real overlapping trading days, R²=${reg.rSquared.toFixed(3)}) — not a textbook duration formula.`,
    `${symbol}'s real duration/composition drifts over time as its underlying bonds mature and roll, so this is a real historical relationship, not a fixed constant — recompute rather than treating the target price as permanent.`,
    `As of ${latestPair.date} (the most recent day with both a real ${fredSeriesId} print and a real ${symbol} close), ${fredSeriesLabel} was ${latestPair.yield.toFixed(2)}% and ${symbol} closed at $${latestPair.price.toFixed(2)}.`,
  ];

  return {
    fredSeriesId,
    fredSeriesLabel,
    etfTicker: symbol,
    targetYieldPct,
    currentYieldPct: latestPair.yield,
    currentYieldDate: latestPair.date,
    currentEtfPrice: latestPair.price,
    targetEtfPrice,
    alertDirection,
    regressionSlope: reg.slope,
    regressionRSquared: reg.rSquared,
    sampleSize: pairs.length,
    lookbackYears,
    dataLimitations,
  };
}
