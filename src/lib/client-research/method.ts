import { RESEARCH_GLOSSARY_ENTRIES } from "@/lib/agents/research-agent/skills/glossary";
import { PHASE_NAMES, PHASE_PLAIN } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import { DEFAULT_VALUATION_SETTINGS } from "@/lib/agents/research-agent/skills/phase-valuation";
import { DEFAULT_RATING_BANDS } from "@/lib/agents/research-agent/skills/valuation-rating";
import { DCF_PROJECTION_YEARS, DISCOUNT_RATE_PCT, MAX_GROWTH_ASSUMPTION_PCT, TERMINAL_GROWTH_PCT } from "@/lib/agents/research-agent/skills/valuation-methods";
import type { ClientPhaseNumber, MethodExplainer } from "./types";

/**
 * "How we value things", built from the same constants and tables the tools use, so the page cannot drift from the
 * maths: the five classic formulas and their assumptions come from valuation-methods.ts, the phases from
 * lifecycle-phase.ts, the bands from valuation-rating.ts, the macro words from the research glossary.
 * Plain wording is written here (reading grade 8 or lower); the full glossary definition sits beside it.
 */

/** Glossary terms worth showing a client, with a short plain version. Only macro terms the Environment section can show. */
const PLAIN_GLOSSARY: { key: string; plain: string }[] = [
  { key: "yieldCurveInversion", plain: "Short-term loans pay more than long-term ones. That is unusual, and it has often come before a slowdown." },
  { key: "highYieldOas", plain: "The extra interest risky companies pay to borrow, compared with the US government. Wide means worry. Narrow means calm." },
  { key: "creditCondition", plain: "How easy or hard it is to borrow money right now." },
  { key: "buffettIndicator", plain: "The value of the stock market compared with the size of the economy. A high number means stocks are expensive compared with the economy." },
  { key: "capacityUtilization", plain: "How much of the country's factory capacity is being used." },
  { key: "cfnai", plain: "A single score that blends 85 monthly economic reports. Zero means normal growth. Well below zero has often meant a downturn." },
  { key: "sloos", plain: "A survey where banks say whether they are making loans harder or easier to get." },
];

const OWN_WORDS: { term: string; plain: string }[] = [
  { term: "Business phase", plain: "Where a company is in its life: start-up, hyper growth, operating leverage, capital return or decline. It describes the business today. It is not a prediction." },
  { term: "Multiple", plain: "A price tag per dollar of something the company earns. Price / earnings of 20 means the market pays $20 for each $1 of yearly profit." },
  { term: "Free cash flow", plain: "The cash left after the company pays to run and keep up the business." },
  { term: "Own average", plain: "The average of the same measure for this one company over the past 12 months." },
  { term: "Price assumes", plain: "The growth rate the current price needs to make sense, given the cash the company makes now. It is a way to check what the market expects." },
  { term: "Estimate", plain: "A number worked out by a fixed rule from public data. It can be wrong, and it is not a promise." },
  { term: "Delayed price", plain: "A price that is some minutes old, or older, when you read it." },
];

export function buildMethodExplainer(): MethodExplainer {
  const b = DEFAULT_RATING_BANDS;
  const s = DEFAULT_VALUATION_SETTINGS;
  const phases = ([1, 2, 3, 4, 5] as ClientPhaseNumber[]).map((n) => ({ number: n, name: PHASE_NAMES[n], plain: PHASE_PLAIN[n] }));
  return {
    steps: [
      { title: "1. Read the business", body: "We read the company's own filings with the SEC. We ask three plain questions. Is revenue growing? Is it making money? Does it hand cash back to shareholders? The answers place it in one of five phases." },
      { title: "2. Use the measures that fit the phase", body: "A young company is judged on sales. A mature company is judged on profit and cash. We use the measures that suit the phase, so a company is compared in a fair way." },
      { title: "3. Compare it with its own past", body: "We set each measure today against the company's own average for the past 12 months. This shows whether the price is high or low for this company. It does not show what happens next." },
      { title: "4. Check what the price expects", body: `We work out what growth the price seems to need. We use a ${s.discountRatePct}% discount rate, ${s.terminalGrowthPct}% long-run growth and ${s.years} years. Then we set that next to the growth the company is delivering now.` },
      { title: "5. Say what we do not know", body: "Every number shows its source and its date. When data is missing, we say so. We never fill a gap with a guess." },
    ],
    phases,
    positions: [
      { label: "well above", rule: `${b.veryExpensivePct}% or more above its own average` },
      { label: "above", rule: `${b.expensivePct}% to ${b.veryExpensivePct}% above its own average` },
      { label: "near", rule: `Within ${b.expensivePct}% of its own average` },
      { label: "below", rule: `${Math.abs(b.attractivePct)}% to ${Math.abs(b.veryAttractivePct)}% below its own average` },
      { label: "well below", rule: `${Math.abs(b.veryAttractivePct)}% or more below its own average` },
    ],
    methods: [
      {
        name: "Value number",
        plain: "A rule of thumb that mixes earnings per share and book value per share. It sets a cautious upper limit and assumes no growth.",
        assumes: "Square root of 22.5 times earnings per share times book value per share. Needs positive earnings and book value.",
      },
      {
        name: "Growth formula",
        plain: "Starts with earnings per share, gives credit for past growth, and adjusts for what high-grade company bonds pay.",
        assumes: `Past earnings growth, capped at ${MAX_GROWTH_ASSUMPTION_PCT}% a year, and the current Aaa bond yield.`,
      },
      {
        name: "Earnings power value",
        plain: "Takes the average yearly profit and divides it by a required return. It assumes the company never grows, so it is a floor and not a goal.",
        assumes: `A ${DISCOUNT_RATE_PCT}% required return and the average profit of the years we have.`,
      },
      {
        name: "Discounted cash flow",
        plain: `Projects the cash the business may make over ${DCF_PROJECTION_YEARS} years, adds a value for the years after that, and brings it all back to today's dollars.`,
        assumes: `A ${DISCOUNT_RATE_PCT}% discount rate and ${TERMINAL_GROWTH_PCT}% growth after year ${DCF_PROJECTION_YEARS}. Small changes in these move the answer a lot, so treat it as one scenario.`,
      },
      {
        name: "Dividend discount model",
        plain: "Values a company by the dividends it pays, assuming they grow at a steady pace.",
        assumes: `A ${DISCOUNT_RATE_PCT}% required return. Needs at least two years of dividends.`,
      },
    ],
    words: [
      ...OWN_WORDS.map((w) => ({ term: w.term, plain: w.plain, fullDefinition: null })),
      ...PLAIN_GLOSSARY.flatMap((g) => {
        const e = RESEARCH_GLOSSARY_ENTRIES.find((x) => x.term === g.key);
        return e ? [{ term: e.label, plain: g.plain, fullDefinition: e.definition }] : [];
      }),
    ],
    limits: [
      "These are estimates from public data and fixed rules. They are not facts about the future.",
      "A company can look low or high against its own past year and still move either way.",
      "One year is a short window. An odd year can make today's price look high or low next to the past.",
      "Filings come out each quarter, so some numbers can be a few months old.",
      "Prices can be delayed.",
      "This is education and research, not personal advice. It does not know your goals, taxes or other savings. Talk to your advisor before you act on anything here.",
    ],
    open: [
      "Volatility forecasts are not shown. They need a long record of past implied volatility, and we do not have that data source yet.",
      "Crypto is covered only by one market-wide read. We do not yet have coin-by-coin research such as network activity, supply or fees.",
      "Funds, bonds, options, currencies and commodities are not valued here yet.",
    ],
  };
}
