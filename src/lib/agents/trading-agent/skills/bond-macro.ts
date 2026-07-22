import { fetchFredSeries, latest } from "@/lib/data/fred";
import type { BondMacroSnapshot } from "../types";

// Same two FRED series macro-overview.ts already uses for the Macro tab's
// credit-condition read — fetched directly here (not via getMacroOverview())
// so the Bonds dashboard doesn't pull in unrelated Buffett-indicator/GDP calls
// it doesn't need.
export async function getBondMacroSnapshot(): Promise<BondMacroSnapshot> {
  const [t10y2y, hySpread] = await Promise.all([
    fetchFredSeries("T10Y2Y", 10),
    fetchFredSeries("BAMLH0A0HYM2", 10),
  ]);

  const latestT10y2y = latest(t10y2y);
  const latestHy = latest(hySpread);
  if (!latestT10y2y || !latestHy) {
    throw new Error("One or more FRED series returned no recent observations.");
  }

  return {
    yieldCurveSpread: {
      seriesId: "T10Y2Y",
      label: "10Y-2Y Treasury Spread",
      date: latestT10y2y.date,
      value: latestT10y2y.value,
    },
    yieldCurveInverted: latestT10y2y.value < 0,
    highYieldSpread: {
      seriesId: "BAMLH0A0HYM2",
      label: "ICE BofA US High Yield Index OAS",
      date: latestHy.date,
      value: latestHy.value,
    },
    dataLimitations: [
      "Reflects broad Treasury/credit conditions, not any single bond's price or yield — pair with Volume Displacement/Momentum on individual bond ETFs (e.g. TLT, IEF, HYG) in your watchlist below for ticker-level signals.",
    ],
  };
}
