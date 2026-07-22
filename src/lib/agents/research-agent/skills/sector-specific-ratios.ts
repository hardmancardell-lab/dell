import type { FmpBalanceSheet, FmpCashFlowStatement, FmpIncomeStatement, FmpProfile } from "@/lib/data/fmp";
import type { SectorRatio, SectorSpecificPanel } from "../types";
import { stdDev } from "../stats";

function available(label: string, value: number | null, unit: string, benchmark: string, passed: boolean | null, note: string | null = null): SectorRatio {
  return {
    label,
    available: value !== null,
    value: value !== null ? `${value.toFixed(1)}${unit}` : null,
    benchmark,
    passed: value !== null ? passed : null,
    note: value !== null ? note : "Required inputs missing or zero/negative in the data returned for this ticker.",
  };
}

function unavailable(label: string, benchmark: string, reason: string): SectorRatio {
  return { label, available: false, value: null, benchmark, passed: null, note: reason };
}

const NEEDS_DISCLOSURE_DATA =
  "Not disclosed in standard financial statements — requires investor-relations disclosures or a specialized industry data feed, not available from FMP's statement endpoints.";

interface Inputs {
  profile: FmpProfile;
  income: FmpIncomeStatement[]; // most recent first
  balance: FmpBalanceSheet[];
  cashFlow: FmpCashFlowStatement[];
}

function faangBigTech({ income, cashFlow, balance }: Inputs): SectorRatio[] {
  const i0 = income[0];
  const b0 = balance[0];
  const c0 = cashFlow[0];

  // NOPAT approximated at a flat 21% US statutory rate (no effective-tax-rate
  // field on the free tier) — a simplification, not a precise NOPAT.
  const nopat = i0 ? i0.operatingIncome * 0.79 : null;
  const investedCapital = b0 ? b0.totalDebt + b0.totalStockholdersEquity - b0.cashAndCashEquivalents : null;
  const roic = nopat !== null && investedCapital !== null && investedCapital > 0 ? (nopat / investedCapital) * 100 : null;

  const fcf = c0?.freeCashFlow ?? (c0 ? c0.operatingCashFlow - Math.abs(c0.capitalExpenditure) : null);
  const fcfConversion = fcf !== null && i0 && i0.netIncome > 0 ? (fcf / i0.netIncome) * 100 : null;

  const sbcToRevenue = c0 && i0 && i0.revenue > 0 ? (c0.stockBasedCompensation / i0.revenue) * 100 : null;

  return [
    available("ROIC (approx., 21% flat tax NOPAT)", roic, "%", "Graham/Buffett floor: ≥20%", roic !== null ? roic >= 20 : null),
    available("FCF Conversion Rate", fcfConversion, "%", "Quality floor: ≥100%", fcfConversion !== null ? fcfConversion >= 100 : null),
    available("Stock-Based Comp / Revenue", sbcToRevenue, "%", "Lower is better — high SBC masks true dilution cost", sbcToRevenue !== null ? sbcToRevenue < 10 : null, "Subtract this from reported FCF to find the true owner's cash yield."),
  ];
}

function semiconductors({ income, cashFlow }: Inputs): SectorRatio[] {
  const i0 = income[0];
  const c0 = cashFlow[0];

  const capexToRevenue = c0 && i0 && i0.revenue > 0 ? (Math.abs(c0.capitalExpenditure) / i0.revenue) * 100 : null;

  const grossMargins = income
    .filter((s) => s.revenue > 0)
    .map((s) => (s.grossProfit / s.revenue) * 100);
  const marginStd = stdDev(grossMargins);
  const latestGrossMargin = income[0]?.revenue > 0 ? (income[0].grossProfit / income[0].revenue) * 100 : null;

  return [
    available("CapEx / Revenue", capexToRevenue, "%", "High = capital buildout phase (fab construction)", null),
    available("Gross Margin (latest)", latestGrossMargin, "%", "Moat floor: ≥50-60%", latestGrossMargin !== null ? latestGrossMargin >= 50 : null),
    available("Gross Margin Std Dev (available years)", marginStd, " pts", "Lower = more rigid moat, more stable earning power", marginStd !== null ? marginStd < 5 : null, `Based on ${grossMargins.length} year(s) available, not a full 5yr cycle.`),
    unavailable("Book-to-Bill Ratio", "> 1.0 = expanding demand", "Orders received vs. orders shipped isn't a financial-statement line item — needs company earnings-call disclosures or an industry tracker (e.g. SEMI)."),
  ];
}

function softwareSaas({ income, cashFlow }: Inputs): SectorRatio[] {
  const i0 = income[0];
  const i1 = income[1];
  const c0 = cashFlow[0];

  const revenueGrowth = i0 && i1 && i1.revenue > 0 ? ((i0.revenue - i1.revenue) / i1.revenue) * 100 : null;
  const fcf = c0?.freeCashFlow ?? (c0 ? c0.operatingCashFlow - Math.abs(c0.capitalExpenditure) : null);
  const fcfMargin = fcf !== null && i0 && i0.revenue > 0 ? (fcf / i0.revenue) * 100 : null;
  const ruleOf40 = revenueGrowth !== null && fcfMargin !== null ? revenueGrowth + fcfMargin : null;

  const rdToRevenue = i0 && i0.revenue > 0 ? (i0.researchAndDevelopmentExpenses / i0.revenue) * 100 : null;

  return [
    available("Rule of 40 (Rev Growth + FCF Margin)", ruleOf40, " pts", "Floor: ≥40", ruleOf40 !== null ? ruleOf40 >= 40 : null, revenueGrowth !== null && fcfMargin !== null ? `Growth ${revenueGrowth.toFixed(1)}% + FCF margin ${fcfMargin.toFixed(1)}%` : null),
    available("R&D / Revenue", rdToRevenue, "%", "Reinvestment intensity — no hard Graham threshold, compare to sector peers", null),
    unavailable("LTV / CAC", "Sustainability floor: ≥3.0x", NEEDS_DISCLOSURE_DATA),
    unavailable("Net Revenue Retention (NRR)", "Healthy floor: ≥110%", NEEDS_DISCLOSURE_DATA),
  ];
}

function telecomMediaInfrastructure({ profile, income, balance }: Inputs): SectorRatio[] {
  const i0 = income[0];
  const b0 = balance[0];

  const ebitda = i0?.ebitda ?? (i0 ? i0.operatingIncome : null);
  const enterpriseValue = b0 ? profile.mktCap + b0.totalDebt - b0.cashAndCashEquivalents : null;
  const evToEbitda = enterpriseValue !== null && ebitda !== null && ebitda > 0 ? enterpriseValue / ebitda : null;

  const netDebt = b0?.netDebt ?? (b0 ? b0.totalDebt - b0.cashAndCashEquivalents : null);
  const netDebtToEbitda = netDebt !== null && ebitda !== null && ebitda > 0 ? netDebt / ebitda : null;

  return [
    available("EV / EBITDA", evToEbitda, "x", "Graham's PE surrogate for capital-intensive sectors — compare to peers, no universal floor", null, "EV = market cap + total debt − cash (approximation, not a dedicated enterprise-value feed)."),
    available("Net Debt / EBITDA", netDebtToEbitda, "x", "Structurally acceptable range for mature telecom/utility: 3.5x-5.0x", netDebtToEbitda !== null ? netDebtToEbitda <= 5 : null),
  ];
}

function consumerDiscretionary({ profile, income, balance, cashFlow }: Inputs): SectorRatio[] {
  const i0 = income[0];
  const b0 = balance[0];
  const c0 = cashFlow[0];

  const dio = i0 && b0 && i0.costOfRevenue > 0 ? (b0.inventory / i0.costOfRevenue) * 365 : null;

  const fcf = c0?.freeCashFlow ?? (c0 ? c0.operatingCashFlow - Math.abs(c0.capitalExpenditure) : null);
  const fcfYield = fcf !== null && profile.mktCap > 0 ? (fcf / profile.mktCap) * 100 : null;

  return [
    available("Days Inventory Outstanding (DIO)", dio, " days", "Rising DIO = fading brand moat, margin-destroying markdowns ahead", null),
    available("FCF Yield", fcfYield, "%", "Higher = more capacity for opportunistic buybacks", fcfYield !== null ? fcfYield > 4 : null),
    unavailable("Lease-Adjusted Leverage Ratio", "Debt + Capitalized Leases / EBITDAR", "Capitalized lease and EBITDAR breakouts aren't in the standard statement fields returned by FMP's free tier."),
  ];
}

function reit({ income, cashFlow }: Inputs): SectorRatio[] {
  const i0 = income[0];
  const c0 = cashFlow[0];

  // FFO = Net Income + Depreciation − Gains on Property Sales. Gains on sale
  // isn't a standard line item here, so this is Net Income + D&A only — an
  // approximation, not the precise NAREIT definition.
  const ffo = i0 && c0 ? i0.netIncome + c0.depreciationAndAmortization : null;

  return [
    {
      label: "FFO (approx: Net Income + D&A)",
      available: ffo !== null,
      value: ffo !== null ? `$${(ffo / 1_000_000).toFixed(1)}M` : null,
      benchmark: "Baseline for dividend sustainability — not a pass/fail threshold",
      passed: null,
      note: "Approximation only: excludes gains/losses on property sales, which aren't a standard statement field.",
    },
    unavailable("AFFO", "Adjusted for recurring maintenance CapEx", "Maintenance vs. growth CapEx split isn't disclosed in standard statements."),
    unavailable("NAV Premium / Discount", "Compares market cap to appraised private market value", "Requires third-party property appraisal data, not available from a financial-statement API."),
  ];
}

function biotechOrQuantum({ balance, cashFlow }: Inputs, isQuantum: boolean): SectorRatio[] {
  const b0 = balance[0];
  const c0 = cashFlow[0];

  const cash = b0 ? b0.cashAndCashEquivalents + (b0.shortTermInvestments || 0) : null;
  const annualBurn = c0 && c0.operatingCashFlow < 0 ? Math.abs(c0.operatingCashFlow) : null;
  const runwayMonths = cash !== null && annualBurn !== null && annualBurn > 0 ? (cash / annualBurn) * 12 : null;
  const floor = isQuantum ? 24 : 18;

  const ratios: SectorRatio[] = [
    available(
      "Cash Runway",
      runwayMonths,
      " months",
      `Minimum floor: ${floor}-${isQuantum ? 36 : 24} months`,
      runwayMonths !== null ? runwayMonths >= floor : null,
      annualBurn === null ? "Operating cash flow is positive or unavailable — burn-rate runway doesn't apply." : null
    ),
  ];

  if (isQuantum) {
    ratios.push(
      unavailable("Qubit Scaling Capital Efficiency", "CapEx / net increase in fault-tolerant qubits", "Physical hardware milestones aren't financial-statement data — would need company technical disclosures, not available from any financial API.")
    );
  }

  return ratios;
}

function banking(): SectorRatio[] {
  return [
    unavailable("Net Interest Margin (NIM)", "Core structural profitability of maturity transformation", "Banks report interest income/expense in a different statement structure than standard corporates — not reliably present in generic income-statement fields on the free tier."),
    unavailable("Common Equity Tier 1 (CET1) Ratio", "Regulatory floor: ≥11-12%", "A regulatory capital disclosure (Basel III), not a financial-statement line item — needs bank regulatory filings (e.g. FFIEC call reports) or a specialized banking data provider."),
    unavailable("Efficiency Ratio", "Optimized floor: <55%", "Requires a non-interest-expense breakout not present in generic statement fields."),
  ];
}

function insurance(): SectorRatio[] {
  return [
    unavailable("Combined Ratio", "Underwriting profit floor: <100%", "Incurred losses and earned premiums are insurance-specific statutory disclosures, not in standard financial statements — needs SNL/AM Best or a specialized insurance data provider."),
  ];
}

function defenseContractor({ income, balance }: Inputs): SectorRatio[] {
  const operatingMargins = income
    .filter((s) => s.revenue > 0)
    .map((s) => (s.operatingIncome / s.revenue) * 100);
  const marginStd = stdDev(operatingMargins);

  const i0 = income[0];
  const b0 = balance[0];
  const workingCapitalToRevenue = i0 && b0 && i0.revenue > 0 ? ((b0.totalCurrentAssets - b0.totalCurrentLiabilities) / i0.revenue) * 100 : null;

  return [
    unavailable("Backlog / Revenue", "Multi-year visibility floor: > 2.0x", "Contract backlog isn't a financial-statement line item — disclosed only in earnings releases/10-K MD&A text, not structured API data."),
    available("Operating Margin Std Dev (available years)", marginStd, " pts", "Cost-plus contracts should show narrow variance", marginStd !== null ? marginStd < 3 : null, `Based on ${operatingMargins.length} year(s) available.`),
    available("Working Capital / Revenue", workingCapitalToRevenue, "%", "Tracks cash tied up in long-duration government projects", null),
  ];
}

function stablecoin(): SectorRatio[] {
  return [
    unavailable("Reserve Backing Ratio", "Regulatory floor: ≥100%", "Requires reserve attestation data from the issuer or a crypto-specific data provider — completely outside the equities-fundamentals data domain this app uses."),
    unavailable("HQLA Ratio", "Liquidity resilience under stress", "Same as above — not applicable to a financial-statement API."),
  ];
}

export function getSectorSpecificPanel(inputs: Inputs): SectorSpecificPanel | null {
  const { profile } = inputs;
  const sector = (profile.sector || "").toLowerCase();
  const industry = (profile.industry || "").toLowerCase();
  const combined = `${sector} ${industry}`;

  if (combined.includes("reit")) {
    return { subSector: "Real Estate Investment Trust (REIT)", classificationNote: `Matched on industry/sector containing "reit".`, ratios: reit(inputs) };
  }
  if (combined.includes("insurance")) {
    return { subSector: "Insurance", classificationNote: `Matched on industry/sector containing "insurance".`, ratios: insurance() };
  }
  if (combined.includes("bank")) {
    return { subSector: "Banking", classificationNote: `Matched on industry/sector containing "bank".`, ratios: banking() };
  }
  if (combined.includes("biotechnology") || combined.includes("drug manufactur") || combined.includes("pharma")) {
    return { subSector: "Biomedical & Pharmaceuticals", classificationNote: `Matched on industry containing biotech/pharma keywords.`, ratios: biotechOrQuantum(inputs, false) };
  }
  if (combined.includes("quantum")) {
    return { subSector: "Quantum Computing", classificationNote: `Matched on industry/sector containing "quantum".`, ratios: biotechOrQuantum(inputs, true) };
  }
  if (combined.includes("semiconductor")) {
    return { subSector: "Semiconductors", classificationNote: `Matched on industry containing "semiconductor".`, ratios: semiconductors(inputs) };
  }
  if (combined.includes("aerospace") || combined.includes("defense")) {
    return { subSector: "Defense Contractors", classificationNote: `Matched on industry containing aerospace/defense keywords.`, ratios: defenseContractor(inputs) };
  }
  if (combined.includes("telecom") || combined.includes("utilit")) {
    return { subSector: "Telecommunications, Media & Infrastructure", classificationNote: `Matched on industry/sector containing telecom/utility keywords.`, ratios: telecomMediaInfrastructure(inputs) };
  }
  if (combined.includes("software")) {
    if (profile.mktCap > 200_000_000_000) {
      return { subSector: "FAANG / Mega-Cap Big Tech", classificationNote: `Matched on software industry + market cap > $200B.`, ratios: faangBigTech(inputs) };
    }
    return { subSector: "Technology & SaaS", classificationNote: `Matched on industry containing "software".`, ratios: softwareSaas(inputs) };
  }
  if (sector.includes("technology") && profile.mktCap > 200_000_000_000) {
    return { subSector: "FAANG / Mega-Cap Big Tech", classificationNote: `Matched on Technology sector + market cap > $200B.`, ratios: faangBigTech(inputs) };
  }
  if (sector.includes("communication services") && profile.mktCap > 200_000_000_000) {
    return { subSector: "FAANG / Mega-Cap Big Tech", classificationNote: `Matched on Communication Services sector + market cap > $200B.`, ratios: faangBigTech(inputs) };
  }
  if (combined.includes("stablecoin") || combined.includes("cryptocurrency")) {
    return { subSector: "Stablecoins & Asset Tokenization", classificationNote: `Matched on crypto/stablecoin keywords.`, ratios: stablecoin() };
  }
  if (sector.includes("consumer cyclical") || sector.includes("consumer discretionary")) {
    return { subSector: "Consumer Discretionary", classificationNote: `Matched on Consumer Cyclical sector.`, ratios: consumerDiscretionary(inputs) };
  }

  return null;
}
