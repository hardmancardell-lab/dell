export type IndicatorClassification = "leading" | "coincident" | "lagging";

export interface IndicatorMeta {
  id: string;
  label: string;
  seriesId: string;
  unit: string;
  classification: IndicatorClassification;
  classificationNote: string;
  description: string;
  isFlagship: boolean;
  /** If true, the chart shows YoY % change computed from the raw series rather than its level. */
  yoyTransform?: boolean;
  /** Observations per year, required when yoyTransform is true (12 for monthly, 4 for quarterly). */
  periodsPerYear?: number;
  /**
   * Which direction of movement generally signals healthier economic
   * conditions — used to compute a simple favorable/unfavorable count per
   * sector. A blunt heuristic, not a substitute for the written analysis
   * (e.g. consumer credit's "healthy" direction genuinely depends on
   * whether it's growing faster or slower than income, which this binary
   * can't capture — treated conservatively as "down" = deleveraging).
   */
  favorableTrend: "up" | "down";
}

/**
 * Six flagship indicators (shown on the Dashboard sub-tab by default) plus
 * the rest of the library (selectable via dropdown). Chosen to span the
 * pillars the user asked about specifically: growth/business cycle, labor,
 * credit conditions, inflation, and consumer strength — rather than
 * duplicating single-pillar coverage.
 *
 * FRED series IDs here are best-effort selections, not yet all live-tested
 * (same situation every other data source in this app started from —
 * WILL5000PRFC and the FMP screener both turned out to be wrong on first
 * try). Verify each against a live fetch before trusting the chart; swap
 * out any that 400.
 *
 * Pure data, no imports — safe to bundle into client components directly
 * (the dropdown needs this list without pulling in server-only fred.ts).
 */
export const INDICATOR_LIBRARY: IndicatorMeta[] = [
  {
    id: "cfnai",
    label: "Chicago Fed National Activity Index",
    seriesId: "CFNAI",
    unit: "index (0 = trend growth)",
    classification: "leading",
    classificationNote:
      "A weighted composite of 85 monthly indicators, designed specifically to lead the business cycle. Sustained readings below -0.7 have historically signaled recession.",
    description:
      "The broadest single-number read on whether the economy is growing above or below its historical trend rate. Used here in place of the ISM Manufacturing PMI, which isn't distributed via FRED — CFNAI is the closest free equivalent for a single composite growth-cycle signal.",
    isFlagship: true,
    favorableTrend: "up",
  },
  {
    id: "initial-claims",
    label: "Initial Jobless Claims",
    seriesId: "ICSA",
    unit: "claims/week",
    classification: "leading",
    classificationNote:
      "Weekly and released with almost no lag — the fastest-moving labor market signal available. Turns before the unemployment rate does.",
    description:
      "The number of people filing for unemployment insurance for the first time each week. Because layoffs happen before the unemployment rate statistically catches up, this is the earliest real-time warning of labor market deterioration.",
    isFlagship: true,
    favorableTrend: "down",
  },
  {
    id: "yield-curve",
    label: "10Y-2Y Treasury Yield Spread",
    seriesId: "T10Y2Y",
    unit: "percentage points",
    classification: "leading",
    classificationNote:
      "Inversions (spread < 0) have preceded every US recession since 1955, typically by 6-24 months. Also directly a bank-profitability signal — see Layer 1's Credit section.",
    description:
      "The gap between long-term and short-term Treasury yields. A positive, steep curve rewards banks for maturity transformation (borrow short, lend long); an inverted curve squeezes that margin and signals the market expects the Fed to cut rates in response to future weakness.",
    isFlagship: true,
    favorableTrend: "up",
  },
  {
    id: "sloos-tightening",
    label: "Bank Lending Standards (Net % Tightening, C&I Loans)",
    seriesId: "DRTSCILM",
    unit: "net % of banks tightening",
    classification: "leading",
    classificationNote:
      "Quarterly Senior Loan Officer Opinion Survey. One of the most reliable recession-leading indicators — credit tightening chokes off business investment before it shows up in GDP.",
    description:
      "The net percentage of banks reporting tighter standards on commercial and industrial loans. When this spikes, it means credit is becoming harder to get regardless of what interest rates are doing — a direct read on the 'systemic liquidity' half of Graham's credit framework.",
    isFlagship: true,
    favorableTrend: "down",
  },
  {
    id: "core-pce",
    label: "Core PCE Price Index (YoY)",
    seriesId: "PCEPILFE",
    unit: "% YoY",
    classification: "coincident",
    classificationNote:
      "Released monthly with roughly a one-month lag. It's the Fed's actual policy target (not CPI) — Fed rate decisions react to this number specifically.",
    description:
      "Personal Consumption Expenditures price index excluding food and energy. Strips out volatile components to show underlying inflation trend. Because the Fed explicitly targets this measure, it's the single best predictor of the next rate move.",
    isFlagship: true,
    yoyTransform: true,
    periodsPerYear: 12,
    favorableTrend: "down",
  },
  {
    id: "consumer-sentiment",
    label: "University of Michigan Consumer Sentiment",
    seriesId: "UMCSENT",
    unit: "index (1966=100)",
    classification: "leading",
    classificationNote:
      "Survey-based, released with almost no lag. Captures consumer psychology before it shows up in actual spending data.",
    description:
      "A survey of consumer attitudes toward personal finances, business conditions, and buying intentions. Sentiment often deteriorates before spending does — consumers pull back on discretionary purchases first, sentiment reflects that shift immediately.",
    isFlagship: true,
    favorableTrend: "up",
  },
  {
    id: "real-retail-sales",
    label: "Real Retail & Food Services Sales",
    seriesId: "RRSFS",
    unit: "millions of chained 2017 dollars",
    classification: "coincident",
    classificationNote: "Monthly, inflation-adjusted. A direct, current-period read on consumer spending strength.",
    description: "Retail sales adjusted for inflation — strips out the effect of price increases to show whether consumers are actually buying more or just paying more for the same amount.",
    isFlagship: false,
    favorableTrend: "up",
  },
  {
    id: "housing-starts",
    label: "Housing Starts",
    seriesId: "HOUST",
    unit: "thousands of units, annualized",
    classification: "leading",
    classificationNote: "Highly rate-sensitive and reacts quickly to mortgage rate changes — a classic leading indicator of the credit-sensitive part of the economy.",
    description: "New residential construction starts. Housing is one of the most interest-rate-sensitive sectors, so this often turns before the broader economy does.",
    isFlagship: false,
    favorableTrend: "up",
  },
  {
    id: "building-permits",
    label: "Building Permits",
    seriesId: "PERMIT",
    unit: "thousands of units, annualized",
    classification: "leading",
    classificationNote: "Leads housing starts itself by 1-2 months — permits are pulled before construction begins.",
    description: "Authorized new housing units. An earlier-still signal than housing starts, since builders pull permits before breaking ground.",
    isFlagship: false,
    favorableTrend: "up",
  },
  {
    id: "durable-goods",
    label: "Durable Goods Orders",
    seriesId: "DGORDER",
    unit: "millions of dollars",
    classification: "leading",
    classificationNote: "Business capex intentions show up here before the equipment is actually built and shipped.",
    description: "New orders for goods meant to last 3+ years (machinery, equipment, vehicles). A direct read on business investment appetite — companies don't order capital equipment unless they expect demand.",
    isFlagship: false,
    favorableTrend: "up",
  },
  {
    id: "nonfarm-payrolls",
    label: "Nonfarm Payrolls",
    seriesId: "PAYEMS",
    unit: "thousands of jobs",
    classification: "lagging",
    classificationNote: "Heavily revised for months after initial release, and job losses/gains reflect decisions made in the recent past, not current conditions.",
    description: "Total US nonfarm employment. The most widely watched labor market number, but it's backward-looking by nature — Initial Claims moves first.",
    isFlagship: false,
    favorableTrend: "up",
  },
  {
    id: "unemployment-rate",
    label: "Unemployment Rate",
    seriesId: "UNRATE",
    unit: "%",
    classification: "lagging",
    classificationNote: "Classic lagging indicator — companies exhaust other options (hours cuts, hiring freezes) before layoffs show up here.",
    description: "The percentage of the labor force actively seeking work. Confirms a downturn is already underway rather than predicting one.",
    isFlagship: false,
    favorableTrend: "down",
  },
  {
    id: "jolts-openings",
    label: "JOLTS Job Openings",
    seriesId: "JTSJOL",
    unit: "thousands of openings",
    classification: "leading",
    classificationNote: "Falling openings signal employers pulling back on hiring plans before actual layoffs begin.",
    description: "The number of unfilled job openings nationally. A cooling in job openings typically precedes a cooling in actual hiring and, eventually, layoffs.",
    isFlagship: false,
    favorableTrend: "up",
  },
  {
    id: "consumer-credit",
    label: "Total Consumer Credit Outstanding",
    seriesId: "TOTALSL",
    unit: "millions of dollars",
    classification: "coincident",
    classificationNote: "Rising alongside strong spending is healthy; rising while sentiment/income falls signals consumers are borrowing to sustain spending — a warning sign.",
    description: "Total revolving and non-revolving consumer credit. The level matters less than the trend relative to income growth — credit growing faster than income is the tell.",
    isFlagship: false,
    favorableTrend: "down",
  },
  {
    id: "household-debt-service",
    label: "Household Debt Service Ratio",
    seriesId: "TDSP",
    unit: "% of disposable income",
    classification: "coincident",
    classificationNote: "A stock-like measure of accumulated financial strain — rises well before widespread delinquencies show up.",
    description: "The share of disposable personal income going toward required debt payments (mortgage + consumer debt). High and rising values mean households have less buffer to absorb a shock.",
    isFlagship: false,
    favorableTrend: "down",
  },
  {
    id: "personal-savings-rate",
    label: "Personal Savings Rate",
    seriesId: "PSAVERT",
    unit: "% of disposable income",
    classification: "leading",
    classificationNote: "A falling savings rate can temporarily prop up spending but signals shrinking capacity to absorb future shocks — watch the trend, not the level.",
    description: "The share of disposable income households are saving rather than spending. A depleted savings buffer is a leading indicator of consumer vulnerability even while current spending still looks fine.",
    isFlagship: false,
    favorableTrend: "up",
  },
];
