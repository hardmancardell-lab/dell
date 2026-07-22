// Same shape/pattern as trading-agent/skills/glossary.ts, scoped to Research
// Agent concepts (macro matrix terms, Graham checklist criteria, sector
// analysis) — the follow-up that file's own comment anticipated.

export type ResearchGlossaryCategory = "macro" | "graham-checklist" | "sector-analysis";

export interface ResearchGlossaryEntry {
  term: string; // stable key, referenced by <GlossaryTerm term="..." getEntry={getResearchGlossaryEntry}>
  label: string;
  category: ResearchGlossaryCategory;
  definition: string;
  seeAlso?: string[];
}

export const RESEARCH_GLOSSARY_ENTRIES: ResearchGlossaryEntry[] = [
  // --- Macro ---
  {
    term: "buffettIndicator",
    label: "Buffett Indicator",
    category: "macro",
    definition:
      "Total stock market value divided by GDP, expressed as a percentage — a rough gauge of whether the market is expensive relative to the size of the real economy. Named for Warren Buffett, who called it 'probably the best single measure of where valuations stand.' This app uses nonfinancial corporate equities over GDP as the free, FRED-available proxy, which understates true total market value (excludes financials and private companies).",
    seeAlso: ["valuationCondition"],
  },
  {
    term: "cape",
    label: "Shiller CAPE",
    category: "macro",
    definition:
      "Cyclically-Adjusted Price-to-Earnings ratio — stock price divided by the average of 10 years of inflation-adjusted earnings, smoothing out the swings a single year's earnings can have. Not published on FRED (this app's free data source), so it shows as unavailable here rather than an estimate.",
  },
  {
    term: "yieldCurveInversion",
    label: "Yield Curve Inversion",
    category: "macro",
    definition:
      "Normally, longer-term bonds pay higher yields than short-term ones (compensation for tying up money longer). An 'inverted' curve is when that flips — short-term yields exceed long-term ones — which has preceded every US recession since 1955, typically by 6-24 months, because it signals markets expect the Fed to cut rates in response to future weakness.",
    seeAlso: ["creditCondition"],
  },
  {
    term: "highYieldOas",
    label: "High-Yield OAS Spread",
    category: "macro",
    definition:
      "Option-Adjusted Spread — the extra yield investors demand to hold risky ('junk') corporate bonds over safe Treasuries of the same maturity. A wide spread means investors are pricing in more default risk (fear); a narrow spread means credit markets are relaxed (complacency, or genuine strength).",
    seeAlso: ["creditCondition"],
  },
  {
    term: "capacityUtilization",
    label: "Capacity Utilization",
    category: "macro",
    definition:
      "The percentage of the economy's total industrial production capacity that's actually being used. Below the long-run average signals slack demand (a trough); above it signals the economy may be running hot enough to risk overheating.",
    seeAlso: ["productionPhase"],
  },
  {
    term: "creditCondition",
    label: "Credit Condition (tight / neutral / loose)",
    category: "macro",
    definition:
      "This app's own classification of how easy or hard it currently is to borrow money, combining whether the yield curve is inverted with how wide high-yield spreads are. 'Tight' means borrowing is expensive and risk-averse; 'loose' means credit is cheap and flowing freely.",
    seeAlso: ["yieldCurveInversion", "highYieldOas"],
  },
  {
    term: "valuationCondition",
    label: "Valuation Condition (cheap / fair / extended / speculative)",
    category: "macro",
    definition:
      "This app's own classification of how expensive the overall market looks, based on the Buffett Indicator's historical range. 'Speculative' means valuations are historically stretched — not a timing signal by itself, but a reason to demand a bigger margin of safety on individual picks.",
    seeAlso: ["buffettIndicator"],
  },
  {
    term: "productionPhase",
    label: "Production Phase (trough / normal / overheated)",
    category: "macro",
    definition:
      "This app's own classification of where the industrial economy sits relative to its long-run average capacity utilization. A 'trough' often coincides with cyclically depressed asset prices — exactly the environment where Graham-style bargain-hunting (assets trading below liquidation value) tends to surface real candidates.",
    seeAlso: ["capacityUtilization"],
  },
  {
    term: "marginPressure",
    label: "Margin Pressure (compressing / neutral / expanding)",
    category: "macro",
    definition:
      "Compares how fast producer prices (what businesses pay for inputs) are rising versus consumer prices (what businesses can charge). 'Compressing' means input costs are outrunning what companies can pass through to customers — a squeeze on profit margins, worse for companies with weak pricing power.",
  },
  {
    term: "macroStanceLabel",
    label: "Macro Stance (e.g. 'Speculative euphoria', 'Cyclical distress', 'Margin compression')",
    category: "macro",
    definition:
      "This app's own rule-based synthesis of the four matrix sections into a plain-language read of the current environment. These labels can combine (e.g. 'Speculative euphoria + Margin compression') — they're not mutually exclusive, and 'No extreme signal' means nothing in the matrix is currently flashing an outlier reading.",
  },

  // --- Graham Checklist ---
  {
    term: "ncav",
    label: "Net Current Asset Value (NCAV)",
    category: "graham-checklist",
    definition:
      "Benjamin Graham's most conservative valuation floor: current assets minus ALL liabilities (including long-term debt), ignoring fixed assets and goodwill entirely. A stock trading at or below two-thirds of NCAV per share is, in theory, priced as if the company were worth more dead (liquidated) than alive — a rare, deep-value signal.",
  },
  {
    term: "fixedChargeCoverage",
    label: "Fixed-Charge Coverage",
    category: "graham-checklist",
    definition:
      "Operating income (EBIT) divided by interest expense — how many times over a company can pay its interest obligations from operating earnings. Graham's threshold here is 4x; below that, a company has little cushion if earnings dip.",
  },
  {
    term: "grahamMultiplier",
    label: "Graham Multiplier (P/E × P/B)",
    category: "graham-checklist",
    definition:
      "Price-to-earnings multiplied by price-to-book. Graham's rule of thumb: don't pay more than 22.5 for this combined multiple — it catches stocks that look cheap on earnings but expensive on book value (or vice versa), not just one ratio in isolation.",
  },
  {
    term: "qualityTier",
    label: "Quality Tier (Strong / Moderate / Weak)",
    category: "graham-checklist",
    definition:
      "A simple 3-tier summary of how many of the 7 Graham checklist criteria a company passes: Strong (6-7 of 7), Moderate (4-5), Weak (0-3). A blended score for quick scanning — the full checklist breakdown underneath is what actually matters for a real decision.",
  },

  // --- Sector Analysis ---
  {
    term: "sloos",
    label: "SLOOS (Bank Lending Standards)",
    category: "sector-analysis",
    definition:
      "The Senior Loan Officer Opinion Survey — a quarterly Fed survey asking banks directly whether they're tightening or loosening lending standards. One of the most reliable recession-leading indicators, because credit tightening chokes off business investment before it shows up in GDP.",
  },
  {
    term: "cfnai",
    label: "CFNAI (Chicago Fed National Activity Index)",
    category: "sector-analysis",
    definition:
      "A weighted composite of 85 monthly economic indicators, built specifically to lead the business cycle. Zero represents trend growth; sustained readings below -0.7 have historically signaled recession. Used in this app as the closest free substitute for the ISM Manufacturing PMI.",
  },
  {
    term: "businessCycleTag",
    label: "Business-Cycle Tag (early-cycle / expansion / late-cycle / contraction)",
    category: "sector-analysis",
    definition:
      "This app's own rule-based read of where a sector sits in the business cycle, derived from the macro matrix's production phase and credit condition — a documented heuristic, not an economic model, meant to add context to individual stock picks within that sector.",
  },
];

export function getResearchGlossaryEntry(term: string): ResearchGlossaryEntry | undefined {
  return RESEARCH_GLOSSARY_ENTRIES.find((e) => e.term === term);
}
