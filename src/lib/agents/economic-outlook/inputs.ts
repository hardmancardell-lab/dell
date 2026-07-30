import { annualizedPercentChange, fetchFredSeries, latest, yoyPercentChange, type FredObservation } from "@/lib/data/fred";
import { getMacroOverview } from "@/lib/agents/research-agent/skills/macro-overview";
import type { MacroMarginMatrix } from "@/lib/agents/research-agent/types";

/** The hard-number half of an OutlookIndicator — current_reading/source/date, always real, fetched fresh every call. Claude fills howDerived/roleInOutlook on top of this in the narrative pass; it never gets to touch these fields. */
export interface RawIndicatorReading {
  indicator: string;
  currentReading: string;
  source: string;
  rawValue: number | null;
}

export interface EconomicOutlookInputs {
  matrix: MacroMarginMatrix;
  labor: RawIndicatorReading[];
  inflation: RawIndicatorReading[];
  growthAndFinancialConditions: RawIndicatorReading[];
  fedFundsEffective: { value: number; date: string };
  dataLimitations: string[];
}

function reading(indicator: string, obs: { date: string; value: number } | null, seriesId: string, fmt: (v: number) => string): RawIndicatorReading | null {
  if (!obs) return null;
  return {
    indicator,
    currentReading: `${fmt(obs.value)} as of ${obs.date}`,
    source: `FRED ${seriesId}`,
    rawValue: obs.value,
  };
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const pct2 = (v: number) => `${v.toFixed(2)}%`;
const thousands = (v: number) => `${v.toLocaleString()} thousand`;

/**
 * Pulls every real number the Economic Outlook needs. Reuses
 * getMacroOverview() for credit/valuation/production/inflation-margin (no
 * duplicate FRED calls for those), and fetches the additional dual-mandate
 * and financial-conditions series directly — all live-verified against real
 * FRED responses before being wired in, same discipline as every other
 * indicator already in this app.
 */
export async function getEconomicOutlookInputs(): Promise<EconomicOutlookInputs> {
  const dataLimitations: string[] = [];

  const [
    matrix,
    unrate,
    u6rate,
    fedFunds,
    payems,
    civpart,
    primeAgeLfpr,
    jtsjol,
    jtsjor,
    jtsqur,
    pcepi,
    pcepilfe,
    nfci,
    t10yie,
    t5yie,
    mich,
    gdppot,
    igOas,
  ] = await Promise.all([
    getMacroOverview(),
    fetchFredSeries("UNRATE", 4),
    fetchFredSeries("U6RATE", 4),
    fetchFredSeries("FEDFUNDS", 4),
    fetchFredSeries("PAYEMS", 4),
    fetchFredSeries("CIVPART", 4),
    fetchFredSeries("LNS11300060", 4),
    fetchFredSeries("JTSJOL", 4),
    fetchFredSeries("JTSJOR", 4),
    fetchFredSeries("JTSQUR", 4),
    fetchFredSeries("PCEPI", 20),
    fetchFredSeries("PCEPILFE", 20),
    fetchFredSeries("NFCI", 4),
    fetchFredSeries("T10YIE", 4),
    fetchFredSeries("T5YIE", 4),
    fetchFredSeries("MICH", 4),
    fetchFredSeries("GDPPOT", 8),
    fetchFredSeries("BAMLC0A0CM", 4),
  ]);

  const latestUnrate = latest(unrate);
  const latestU6 = latest(u6rate);
  const latestFedFunds = latest(fedFunds);
  const latestPayems = latest(payems);
  const latestCivpart = latest(civpart);
  const latestPrimeAgeLfpr = latest(primeAgeLfpr);
  const latestJtsjol = latest(jtsjol);
  const latestJtsjor = latest(jtsjor);
  const latestJtsqur = latest(jtsqur);
  const latestNfci = latest(nfci);
  const latestT10yie = latest(t10yie);
  const latestT5yie = latest(t5yie);
  const latestMich = latest(mich);
  const latestIgOas = latest(igOas);

  if (!latestUnrate || !latestFedFunds) {
    throw new Error("UNRATE/FEDFUNDS returned no recent observations — cannot build the outlook without these.");
  }

  const labor: RawIndicatorReading[] = [];
  const push = (r: RawIndicatorReading | null) => {
    if (r) labor.push(r);
    else dataLimitations.push("A labor indicator was skipped — its FRED series returned no recent observation.");
  };
  push(reading("U-3 Unemployment Rate", latestUnrate, "UNRATE", pct));
  push(reading("U-6 Underemployment Rate", latestU6, "U6RATE", pct));
  push(reading("Nonfarm Payrolls (level)", latestPayems, "PAYEMS", thousands));
  push(reading("Labor Force Participation Rate", latestCivpart, "CIVPART", pct));
  push(reading("Prime-Age (25-54) LFPR", latestPrimeAgeLfpr, "LNS11300060", pct));
  push(reading("JOLTS Job Openings Rate", latestJtsjor, "JTSJOR", pct));
  push(reading("JOLTS Job Openings (level)", latestJtsjol, "JTSJOL", thousands));
  push(reading("JOLTS Quits Rate", latestJtsqur, "JTSQUR", pct));
  if (latestJtsjor && latestUnrate) {
    labor.push({
      indicator: "Beveridge Curve Position (openings rate vs. unemployment rate)",
      currentReading: `Job openings rate ${latestJtsjor.value.toFixed(1)}% vs. unemployment rate ${latestUnrate.value.toFixed(1)}% (${latestJtsjor.date} / ${latestUnrate.date})`,
      source: "FRED JTSJOR, UNRATE",
      rawValue: latestJtsjor.value - latestUnrate.value,
    });
  }

  const pcepiYoY = yoyPercentChange(pcepi, 12);
  const corePceYoY = yoyPercentChange(pcepilfe, 12);
  const corePce3moAnnualized = annualizedPercentChange(pcepilfe, 3);
  const corePce6moAnnualized = annualizedPercentChange(pcepilfe, 6);
  const latestPcepi = latest(pcepi);
  const latestPcepilfe = latest(pcepilfe);

  const inflation: RawIndicatorReading[] = [];
  const pushInf = (r: RawIndicatorReading | null) => {
    if (r) inflation.push(r);
    else dataLimitations.push("An inflation indicator was skipped — its FRED series returned no recent observation.");
  };
  if (latestPcepi && pcepiYoY !== null) {
    pushInf({ indicator: "Headline PCE Price Index (YoY)", currentReading: `${pcepiYoY.toFixed(1)}% as of ${latestPcepi.date}`, source: "FRED PCEPI", rawValue: pcepiYoY });
  }
  if (latestPcepilfe && corePceYoY !== null) {
    pushInf({ indicator: "Core PCE Price Index (YoY)", currentReading: `${corePceYoY.toFixed(1)}% as of ${latestPcepilfe.date}`, source: "FRED PCEPILFE", rawValue: corePceYoY });
  }
  if (corePce3moAnnualized !== null && corePce6moAnnualized !== null && latestPcepilfe) {
    inflation.push({
      indicator: "Core PCE, 3mo vs. 6mo Annualized",
      currentReading: `3mo annualized ${corePce3moAnnualized.toFixed(1)}% vs. 6mo annualized ${corePce6moAnnualized.toFixed(1)}% (as of ${latestPcepilfe.date})`,
      source: "FRED PCEPILFE (computed)",
      rawValue: corePce3moAnnualized,
    });
  } else {
    dataLimitations.push("3mo/6mo annualized core PCE could not be computed — insufficient recent history returned from FRED.");
  }
  pushInf(reading("10-Year Breakeven Inflation Rate", latestT10yie, "T10YIE", pct2));
  pushInf(reading("5-Year Breakeven Inflation Rate", latestT5yie, "T5YIE", pct2));
  pushInf(reading("U. Michigan 1-Year Expected Inflation", latestMich, "MICH", pct));

  const growthAndFinancialConditions: RawIndicatorReading[] = [];
  const latestGdppot = pickGdppotAtOrBefore(gdppot, matrix.inflation.cpi.date);
  if (latestGdppot) {
    growthAndFinancialConditions.push({
      indicator: "Real GDP vs. CBO Potential GDP",
      currentReading: `Real GDP YoY ${matrix.inflation.realGdpYoY !== null ? `${matrix.inflation.realGdpYoY.toFixed(1)}%` : "N/A"}; CBO potential GDP estimate ${latestGdppot.value.toFixed(0)}bn (chained 2017$) as of ${latestGdppot.date}`,
      source: "FRED GDPC1, GDPPOT",
      rawValue: matrix.inflation.realGdpYoY,
    });
  } else {
    dataLimitations.push("CBO potential GDP (GDPPOT) had no observation at or before the latest real-GDP date.");
  }
  growthAndFinancialConditions.push({
    indicator: "r-star (Neutral Real Rate)",
    currentReading: "Not available — no reliable free real-time r-star series is integrated in this app (the NY Fed's Holston-Laubach-Williams estimate isn't published as a simple FRED series). Treat qualitatively against the effective fed funds rate instead.",
    source: "Unavailable",
    rawValue: null,
  });
  growthAndFinancialConditions.push({
    indicator: "High-Yield Credit Spread (OAS)",
    currentReading: `${matrix.credit.highYieldSpread.value.toFixed(2)}% as of ${matrix.credit.highYieldSpread.date}`,
    source: "FRED BAMLH0A0HYM2",
    rawValue: matrix.credit.highYieldSpread.value,
  });
  if (latestIgOas) {
    growthAndFinancialConditions.push({
      indicator: "Investment-Grade Credit Spread (OAS)",
      currentReading: `${latestIgOas.value.toFixed(2)}% as of ${latestIgOas.date}`,
      source: "FRED BAMLC0A0CM",
      rawValue: latestIgOas.value,
    });
  }
  if (latestNfci) {
    growthAndFinancialConditions.push({
      indicator: "Chicago Fed National Financial Conditions Index",
      currentReading: `${latestNfci.value.toFixed(2)} as of ${latestNfci.date} (0 = historical average; negative = looser than average, positive = tighter)`,
      source: "FRED NFCI",
      rawValue: latestNfci.value,
    });
  }
  growthAndFinancialConditions.push({
    indicator: "Buffett Indicator (Market Cap / GDP)",
    currentReading: `${matrix.valuation.buffettIndicator.value.toFixed(0)}% — classified "${matrix.valuation.valuationCondition}"`,
    source: "FRED NCBEILQ027S, GDP",
    rawValue: matrix.valuation.buffettIndicator.value,
  });

  return {
    matrix,
    labor,
    inflation,
    growthAndFinancialConditions,
    fedFundsEffective: { value: latestFedFunds.value, date: latestFedFunds.date },
    dataLimitations,
  };
}

/** GDPPOT includes CBO's forward projected quarters — take the most recent observation at or before the real-GDP as-of date, not the newest row in the series (which would be a future projection, not "current"). */
function pickGdppotAtOrBefore(observations: FredObservation[], onOrBeforeDate: string): { date: string; value: number } | null {
  const clean = observations.filter((o) => o.value !== null && o.date <= onOrBeforeDate);
  if (clean.length === 0) return null;
  const last = clean[clean.length - 1];
  return { date: last.date, value: last.value as number };
}
