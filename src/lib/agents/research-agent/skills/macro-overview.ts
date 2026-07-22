import { fetchFredSeries, latest, yoyPercentChange } from "@/lib/data/fred";
import type {
  BeigeBookSection,
  CreditCondition,
  CreditSection,
  InflationSection,
  MacroBriefing,
  MacroMarginMatrix,
  MarginPressure,
  ProductionPhase,
  ProductionSection,
  SepStyleRow,
  ValuationCondition,
  ValuationSection,
} from "../types";

// Long-run average capacity utilization (total industry), roughly 1972-2019 per Fed data.
const CAPACITY_UTILIZATION_LONG_RUN_AVG = 80;

function creditCondition(
  yieldCurveInverted: boolean,
  highYieldSpread: number
): CreditCondition {
  if (yieldCurveInverted && highYieldSpread > 5) return "tight";
  if (!yieldCurveInverted && highYieldSpread < 3.5) return "loose";
  return "neutral";
}

// Bands follow the commonly cited historical Buffett Indicator ranges.
// Treat as directional, not precise — Graham's own view was that aggregate
// judgment matters more than false precision in a single ratio.
function valuationCondition(buffettIndicatorPct: number): ValuationCondition {
  if (buffettIndicatorPct < 75) return "cheap";
  if (buffettIndicatorPct < 115) return "fair";
  if (buffettIndicatorPct < 150) return "extended";
  return "speculative";
}

function productionPhase(
  capacityUtilization: number,
  longRunAvg: number
): ProductionPhase {
  if (capacityUtilization < longRunAvg - 3) return "trough";
  if (capacityUtilization > longRunAvg + 3) return "overheated";
  return "normal";
}

function marginPressure(
  ppiYoY: number | null,
  cpiYoY: number | null
): MarginPressure {
  if (ppiYoY === null || cpiYoY === null) return "neutral";
  const gap = ppiYoY - cpiYoY;
  if (gap > 1.5) return "compressing";
  if (gap < -1.5) return "expanding";
  return "neutral";
}

function synthesizeStance(
  credit: CreditSection,
  valuation: ValuationSection,
  production: ProductionSection,
  inflation: InflationSection
): { label: string; rationale: string[] } {
  const rationale: string[] = [];
  const labels: string[] = [];

  const speculativeValuation =
    valuation.valuationCondition === "extended" ||
    valuation.valuationCondition === "speculative";

  if (speculativeValuation && credit.creditCondition === "loose") {
    labels.push("Speculative euphoria");
    rationale.push(
      `Buffett Indicator at ${valuation.buffettIndicator.value.toFixed(
        0
      )}% combined with narrow high-yield spreads (${credit.highYieldSpread.value.toFixed(
        2
      )}%) suggests broad optimism is priced in. Demand an elevated margin of safety on individual positions; lean toward cash/short-term instruments over chasing the index.`
    );
  }

  if (
    production.productionPhase === "trough" &&
    credit.creditCondition === "tight"
  ) {
    labels.push("Cyclical distress");
    rationale.push(
      `Capacity utilization (${production.capacityUtilization.value.toFixed(
        1
      )}%) is running below its long-run average while credit spreads are wide — a classic setup for cyclical pessimism. Screen for asset-rich, low-leverage businesses trading near or below net-current-asset value rather than avoiding the sector outright.`
    );
  }

  if (inflation.marginPressure === "compressing") {
    labels.push("Margin compression");
    rationale.push(
      `Producer prices are outrunning consumer prices (PPI YoY ${inflation.ppiYoY?.toFixed(
        1
      )}% vs CPI YoY ${inflation.cpiYoY?.toFixed(
        1
      )}%), meaning input cost inflation is not fully passing through. Favor firms with real pricing power or rigid, low cost structures; be skeptical of reported margins at weaker competitors.`
    );
  }

  if (labels.length === 0) {
    labels.push("No extreme signal");
    rationale.push(
      "Credit, valuation, production, and margin readings are all within normal historical ranges. This is not a market-timing signal — continue bottom-up security selection with a standard margin of safety."
    );
  }

  return { label: labels.join(" + "), rationale };
}

export async function getMacroOverview(): Promise<MacroMarginMatrix> {
  const [
    t10y2y,
    hySpread,
    corporateEquities,
    gdp,
    gdpc1,
    indpro,
    tcu,
    dspic,
    cpi,
    ppi,
  ] = await Promise.all([
    fetchFredSeries("T10Y2Y", 10),
    fetchFredSeries("BAMLH0A0HYM2", 10),
    fetchFredSeries("NCBEILQ027S", 8),
    fetchFredSeries("GDP", 8),
    fetchFredSeries("GDPC1", 12),
    fetchFredSeries("INDPRO", 24),
    fetchFredSeries("TCU", 10),
    fetchFredSeries("DSPIC96", 24),
    fetchFredSeries("CPIAUCSL", 24),
    fetchFredSeries("PPIACO", 24),
  ]);

  const latestT10y2y = latest(t10y2y);
  const latestHy = latest(hySpread);
  const latestCorporateEquities = latest(corporateEquities);
  const latestGdp = latest(gdp);
  const latestIndpro = latest(indpro);
  const latestTcu = latest(tcu);
  const latestDspic = latest(dspic);
  const latestCpi = latest(cpi);
  const latestPpi = latest(ppi);

  if (
    !latestT10y2y ||
    !latestHy ||
    !latestCorporateEquities ||
    !latestGdp ||
    !latestIndpro ||
    !latestTcu ||
    !latestDspic ||
    !latestCpi ||
    !latestPpi
  ) {
    throw new Error("One or more FRED series returned no recent observations.");
  }

  const yieldCurveInverted = latestT10y2y.value < 0;

  const credit: CreditSection = {
    yieldCurveSpread: {
      seriesId: "T10Y2Y",
      label: "10Y-2Y Treasury Spread",
      date: latestT10y2y.date,
      value: latestT10y2y.value,
      unit: "percentage points",
    },
    yieldCurveInverted,
    highYieldSpread: {
      seriesId: "BAMLH0A0HYM2",
      label: "ICE BofA US High Yield Index OAS",
      date: latestHy.date,
      value: latestHy.value,
      unit: "percent",
    },
    creditCondition: creditCondition(yieldCurveInverted, latestHy.value),
  };

  // NCBEILQ027S is nonfinancial corporate equities market value, in millions;
  // GDP is in billions. This undercounts total market cap (excludes financials
  // and private companies) but is the standard FRED-available proxy since the
  // Wilshire 5000 series was discontinued.
  const corporateEquitiesBillions = latestCorporateEquities.value / 1000;
  const buffettValue = (corporateEquitiesBillions / latestGdp.value) * 100;
  const valuation: ValuationSection = {
    buffettIndicator: {
      value: buffettValue,
      marketCapDate: latestCorporateEquities.date,
      gdpDate: latestGdp.date,
    },
    cape: {
      value: null,
      note: "CAPE is not published on FRED. Source it from Robert Shiller's dataset (Yale) and wire it in as a manual override if you want it in the matrix.",
    },
    valuationCondition: valuationCondition(buffettValue),
  };

  const industrialProductionYoY = yoyPercentChange(indpro, 12);
  const realDisposableIncomeYoY = yoyPercentChange(dspic, 12);
  const production: ProductionSection = {
    industrialProduction: {
      seriesId: "INDPRO",
      label: "Industrial Production Index",
      date: latestIndpro.date,
      value: latestIndpro.value,
      unit: "index (2017=100)",
    },
    industrialProductionYoY,
    capacityUtilization: {
      seriesId: "TCU",
      label: "Capacity Utilization: Total Industry",
      date: latestTcu.date,
      value: latestTcu.value,
      unit: "percent of capacity",
    },
    capacityUtilizationLongRunAvg: CAPACITY_UTILIZATION_LONG_RUN_AVG,
    realDisposableIncome: {
      seriesId: "DSPIC96",
      label: "Real Disposable Personal Income",
      date: latestDspic.date,
      value: latestDspic.value,
      unit: "billions of chained 2017 dollars",
    },
    realDisposableIncomeYoY,
    productionPhase: productionPhase(
      latestTcu.value,
      CAPACITY_UTILIZATION_LONG_RUN_AVG
    ),
  };

  const cpiYoY = yoyPercentChange(cpi, 12);
  const ppiYoY = yoyPercentChange(ppi, 12);
  const realGdpYoY = yoyPercentChange(gdpc1, 4);
  const inflation: InflationSection = {
    cpi: {
      seriesId: "CPIAUCSL",
      label: "CPI, All Urban Consumers",
      date: latestCpi.date,
      value: latestCpi.value,
      unit: "index (1982-84=100)",
    },
    cpiYoY,
    ppi: {
      seriesId: "PPIACO",
      label: "PPI, All Commodities",
      date: latestPpi.date,
      value: latestPpi.value,
      unit: "index (1982=100)",
    },
    ppiYoY,
    realGdpYoY,
    marginPressure: marginPressure(ppiYoY, cpiYoY),
  };

  const stance = synthesizeStance(credit, valuation, production, inflation);

  return { credit, valuation, production, inflation, stance };
}

function buildNationalSummary(
  matrix: MacroMarginMatrix,
  unrate: { date: string; value: number },
  fedFunds: { date: string; value: number }
): BeigeBookSection[] {
  return [
    {
      category: "Labor Markets & Employment",
      narrative: `The unemployment rate stands at ${unrate.value.toFixed(1)}% as of ${unrate.date}. Real disposable personal income is running at ${matrix.production.realDisposableIncomeYoY !== null ? `${matrix.production.realDisposableIncomeYoY.toFixed(1)}% year-over-year` : "an unavailable growth rate"}, the closest proxy this app has to labor-market income strength.`,
    },
    {
      category: "Prices",
      narrative: `Consumer prices (CPI) are running at ${matrix.inflation.cpiYoY !== null ? `${matrix.inflation.cpiYoY.toFixed(1)}%` : "N/A"} year-over-year; producer prices (PPI) at ${matrix.inflation.ppiYoY !== null ? `${matrix.inflation.ppiYoY.toFixed(1)}%` : "N/A"} year-over-year. Margin pressure — whether producer cost inflation is outrunning what businesses can pass through — currently reads as "${matrix.inflation.marginPressure}".`,
    },
    {
      category: "Consumer & Business Activity",
      narrative: `Real GDP is growing at ${matrix.inflation.realGdpYoY !== null ? `${matrix.inflation.realGdpYoY.toFixed(1)}%` : "an unavailable rate"} year-over-year. Broad market valuation, read via the Buffett Indicator (nonfinancial corporate equities over GDP), stands at ${matrix.valuation.buffettIndicator.value.toFixed(0)}% — classified as "${matrix.valuation.valuationCondition}".`,
    },
    {
      category: "Manufacturing & Production",
      narrative: `Industrial production is running at ${matrix.production.industrialProductionYoY !== null ? `${matrix.production.industrialProductionYoY.toFixed(1)}%` : "an unavailable rate"} year-over-year, with capacity utilization at ${matrix.production.capacityUtilization.value.toFixed(1)}% against a long-run average near ${matrix.production.capacityUtilizationLongRunAvg}% — the production phase currently reads as "${matrix.production.productionPhase}".`,
    },
    {
      category: "Banking & Financial Conditions",
      narrative: `The effective federal funds rate is ${fedFunds.value.toFixed(2)}% as of ${fedFunds.date}. The 10-year/2-year Treasury spread is ${matrix.credit.yieldCurveSpread.value.toFixed(2)} percentage points (${matrix.credit.yieldCurveInverted ? "inverted" : "not inverted"}), and high-yield credit spreads sit at ${matrix.credit.highYieldSpread.value.toFixed(2)}% — overall credit conditions read as "${matrix.credit.creditCondition}".`,
    },
  ];
}

function readingDirection(current: number | null, prior: number | null): SepStyleRow["direction"] {
  if (current === null || prior === null) return "unknown";
  const diff = current - prior;
  if (Math.abs(diff) < 0.05) return "flat";
  return diff > 0 ? "up" : "down";
}

/**
 * Presented in a table styled after the FOMC's own Summary of Economic
 * Projections (metric / current / prior / direction columns) — but every
 * number here is this app's own CURRENT real FRED reading, never a forward
 * projection. This app has no monetary-policy forecasting model and will
 * not fabricate one; see MacroBriefing.asOfNote for the explicit disclosure
 * shown alongside this table in the UI.
 *
 * Deliberately re-fetches GDPC1/CPIAUCSL rather than reusing getMacroOverview's
 * already-fetched values, since those only expose the latest-vs-N-periods-back
 * YoY figure, not enough history to also compute the PRIOR period's YoY for
 * the "direction" column — same intentional-duplication precedent as
 * bond-macro.ts (cheap given fetchFredSeries's 12h cache).
 */
export async function getMacroBriefing(matrix: MacroMarginMatrix): Promise<MacroBriefing> {
  const [unrate, fedFunds, gdpc1, cpi] = await Promise.all([
    fetchFredSeries("UNRATE", 14),
    fetchFredSeries("FEDFUNDS", 14),
    fetchFredSeries("GDPC1", 8),
    fetchFredSeries("CPIAUCSL", 26),
  ]);

  const latestUnrate = latest(unrate);
  const latestFedFunds = latest(fedFunds);
  if (!latestUnrate || !latestFedFunds) {
    throw new Error("One or more FRED series returned no recent observations for the macro briefing.");
  }

  const cleanUnrate = unrate.filter((o) => o.value !== null);
  const cleanFedFunds = fedFunds.filter((o) => o.value !== null);
  const unrateYearAgo = cleanUnrate.length >= 13 ? cleanUnrate[cleanUnrate.length - 13] : null;
  const fedFundsYearAgo = cleanFedFunds.length >= 13 ? cleanFedFunds[cleanFedFunds.length - 13] : null;

  const gdpYoYNow = yoyPercentChange(gdpc1, 4);
  const gdpYoYPrior = yoyPercentChange(gdpc1.slice(0, -1), 4);
  const cpiYoYNow = yoyPercentChange(cpi, 12);
  const cpiYoYPrior = yoyPercentChange(cpi.slice(0, -1), 12);
  const latestGdp = latest(gdpc1);
  const latestCpi = latest(cpi);

  const currentConditionsTable: SepStyleRow[] = [
    {
      metric: "Real GDP Growth (YoY)",
      currentValue: gdpYoYNow,
      currentDate: latestGdp?.date ?? "",
      yearAgoValue: gdpYoYPrior,
      yearAgoDate: "prior quarter's YoY reading",
      direction: readingDirection(gdpYoYNow, gdpYoYPrior),
    },
    {
      metric: "Unemployment Rate",
      currentValue: latestUnrate.value,
      currentDate: latestUnrate.date,
      yearAgoValue: unrateYearAgo?.value ?? null,
      yearAgoDate: unrateYearAgo?.date ?? "unavailable",
      direction: readingDirection(latestUnrate.value, unrateYearAgo?.value ?? null),
    },
    {
      metric: "Headline Inflation (CPI YoY)",
      currentValue: cpiYoYNow,
      currentDate: latestCpi?.date ?? "",
      yearAgoValue: cpiYoYPrior,
      yearAgoDate: "prior month's YoY reading",
      direction: readingDirection(cpiYoYNow, cpiYoYPrior),
    },
    {
      metric: "Federal Funds Rate (Effective)",
      currentValue: latestFedFunds.value,
      currentDate: latestFedFunds.date,
      yearAgoValue: fedFundsYearAgo?.value ?? null,
      yearAgoDate: fedFundsYearAgo?.date ?? "unavailable",
      direction: readingDirection(latestFedFunds.value, fedFundsYearAgo?.value ?? null),
    },
  ];

  return {
    matrix,
    nationalSummary: buildNationalSummary(matrix, latestUnrate, latestFedFunds),
    currentConditionsTable,
    asOfNote:
      "These are this app's own current real FRED readings, not a forecast. The FOMC's own Summary of Economic Projections publishes the Fed's actual forward-looking projections for GDP, unemployment, inflation, and the fed funds rate across future years — this app has no monetary-policy forecasting model and does not generate one.",
  };
}
