import type { CentralBankEntry } from "./types";

/**
 * Static reference content, same pattern as trading-agent/skills/currency-drivers.ts and
 * options-strategies.ts — a structured data file rendered by a reference tab, not a live
 * data integration. Source: central_bank_rate_path_registry.json (project root), researched
 * and supplied by the user 2026-07-30. Extends the Economic Outlook's US-Fed-only coverage to
 * the 13 central banks below with real access methods and an honest read on how much to trust
 * each one's rate-path signal.
 *
 * None of these are wired to a live API in this app — the "access" field documents whether a
 * genuine free API exists (several do), but no fetch code queries them here. This is a lookup
 * reference for a human deciding where to go get real international rate data, not an
 * automated pipeline.
 */

export const CENTRAL_BANK_CRITICAL_DISTINCTION =
  "Not all central banks publish a rate path the way the Fed's SEP dot plot does. This matters a lot for how confidently you can use their number as a discount-rate input. EXPLICIT_OWN_PATH (rare, high-value): the bank publishes its own multi-year policy-rate forecast. MARKET_CONDITIONED (the majority): the bank forecasts GDP/inflation conditioned on the market's own forward-rate curve, not its own view — pull the market-implied path yourself (OIS/futures) rather than expecting the publication to hand you one. OPAQUE_OR_POLITICAL: limited/no formal forward guidance; forecasts are descriptive, not predictive.";

export const CENTRAL_BANK_COVERAGE_GAPS: string[] = [
  "No South Korea (Bank of Korea), no broader Southeast Asia (Indonesia, Vietnam, Thailand) central banks covered yet — add if any holding has meaningful exposure there.",
  "No Sweden (Riksbank) or Czech National Bank — both also publish EXPLICIT_OWN_PATH rate forecasts like Norway/NZ and would be good additions to the 'ground truth' comparison set if European exposure grows.",
  "PBoC entry is the weakest in this registry by design — China's opacity is a real analytical constraint, not a research gap to be solved; lean on IMF/OECD/private-bank China desks instead.",
];

export const CENTRAL_BANKS: CentralBankEntry[] = [
  {
    id: "ecb_projections",
    countryOrArea: "Euro area",
    institution: "European Central Bank / Eurosystem",
    publication: "ECB (Mar/Sep) and Eurosystem (Jun/Dec) staff macroeconomic projections",
    forecasts: ["Real GDP growth", "HICP inflation", "unemployment", "country-level breakdowns in June/December editions"],
    horizon: "current year + ~3 years out",
    cadence: "quarterly (March, June, September, December)",
    ratePathTransparency: "MARKET_CONDITIONED",
    methodology:
      "Staff projections conditioned on market-implied interest rate expectations, not a Governing Council-published path; Governing Council decisions and guidance are communicated separately in the post-meeting statement.",
    access: {
      method: "free API",
      endpointOrSeriesId: "ECB Statistical Data Warehouse (SDW) SDMX 2.1 REST API, base https://sdw-wsrest.ecb.europa.eu; Python (sdw-api) and R (ecb) packages available",
      url: null,
      authRequired: false,
      cost: "free",
    },
    automationFeasibility: "high — genuine free REST/SDMX API, no registration required",
    pipelineRole: "Primary driver for any Euro-area revenue segment; also has its own ECB Survey of Professional Forecasters (quarterly) as a secondary consensus cross-check.",
  },
  {
    id: "boe_mpr",
    countryOrArea: "United Kingdom",
    institution: "Bank of England",
    publication: "Monetary Policy Report (MPR)",
    forecasts: ["GDP growth", "CPI inflation", "unemployment"],
    horizon: "~3 years",
    cadence: "8x/year, alongside every MPC decision",
    ratePathTransparency: "MARKET_CONDITIONED",
    methodology:
      "Baseline projection explicitly conditioned on the market-implied Bank Rate path, derived from a 15-working-day average of forward market rates ahead of each report — the MPC does not publish its own rate-path forecast.",
    access: {
      method: "free API",
      endpointOrSeriesId: "Bank of England IADB (Interactive Database), CSV/XML/HTML export via URL parameters (up to 300 series codes per request); R package 'boe' available",
      url: "https://www.bankofengland.co.uk/boeapps/database/",
      authRequired: false,
      cost: "free",
    },
    automationFeasibility: "high — free database API, no auth",
    pipelineRole:
      "Primary driver for UK revenue segments. Because the forecast is explicitly conditioned on market rates rather than the MPC's own view, treat the 'market curve implied path' quoted in each report as the actual rate-path input, not the GDP/CPI numbers alone.",
  },
  {
    id: "boj_outlook",
    countryOrArea: "Japan",
    institution: "Bank of Japan",
    publication: "Outlook for Economic Activity and Prices (Outlook Report)",
    forecasts: ["Real GDP growth", "CPI (core) inflation"],
    horizon: "current + 2 fiscal years out",
    cadence: "quarterly (January, April, July, October)",
    ratePathTransparency: "OPAQUE_OR_POLITICAL",
    methodology:
      "Median of individual Policy Board members' point-estimate forecasts (highest and lowest excluded), published as a range. No explicit policy-rate path is published; forward guidance is qualitative.",
    access: {
      method: "free API",
      endpointOrSeriesId: "BOJ Time-Series Data Search API, JSON/CSV output, official API service; Python (bojpy) and R (BOJ) wrappers exist",
      url: "https://www.stat-search.boj.or.jp/index_en.html",
      authRequired: false,
      cost: "free",
    },
    automationFeasibility: "high — genuine official free API with documented manual",
    pipelineRole: "Primary driver for Japan revenue segments. Given no published rate path, pair this with money-market futures (OIS) for the actual rate assumption rather than inferring one from the Outlook Report.",
  },
  {
    id: "pboc_reports",
    countryOrArea: "China",
    institution: "People's Bank of China",
    publication: "China Monetary Policy Implementation Report",
    forecasts: ["Descriptive GDP growth commentary (tracks the NPC's political 'around X%' annual growth target rather than an independent forecast)"],
    horizon: "current year, descriptive",
    cadence: "quarterly",
    ratePathTransparency: "OPAQUE_OR_POLITICAL",
    methodology:
      "Limited institutional independence relative to Western central banks (reports to the State Council); forward guidance is restricted and the 'target' is better read as a political growth objective than a statistical forecast.",
    access: { method: "web publication, no structured API found", endpointOrSeriesId: null, url: "https://www.pbc.gov.cn/en/", authRequired: false, cost: "free but not machine-friendly" },
    automationFeasibility: "low — no API; treat as a manually-reviewed input",
    pipelineRole:
      "For any China revenue exposure, weight IMF WEO / OECD China projections more heavily than PBoC's own report, and treat the NPC's annual growth target as a policy anchor rather than a forecast.",
  },
  {
    id: "boc_mpr",
    countryOrArea: "Canada",
    institution: "Bank of Canada",
    publication: "Monetary Policy Report (MPR)",
    forecasts: ["GDP growth", "CPI inflation"],
    horizon: "~3 years",
    cadence: "quarterly (Jan, Apr, Jul, Oct)",
    ratePathTransparency: "MARKET_CONDITIONED",
    methodology: "Base-case projection for growth and inflation plus explicit risk assessment; does not publish its own policy-rate path.",
    access: { method: "web publication + data tables", endpointOrSeriesId: null, url: "https://www.bankofcanada.ca/publications/mpr/", authRequired: false, cost: "free" },
    automationFeasibility: "medium — structured projections tables published per report but no dedicated REST API found; scrape the projections page each cycle",
    pipelineRole:
      "Primary driver for Canada revenue segments; current reports flag US trade-relationship risk explicitly, relevant for any cross-border NA segment already covered by the Fed-side outlook.",
  },
  {
    id: "rba_smp",
    countryOrArea: "Australia",
    institution: "Reserve Bank of Australia",
    publication: "Statement on Monetary Policy (SMP)",
    forecasts: ["GDP growth", "inflation", "unemployment"],
    horizon: "~2-3 years",
    cadence: "quarterly (Feb, May, Aug, Nov)",
    ratePathTransparency: "MARKET_CONDITIONED",
    methodology: "Forecast tables with historical archive; explicitly discusses risks to the outlook alongside the base case.",
    access: { method: "downloadable data tables", endpointOrSeriesId: "SMP Forecast Archive", url: "https://www.rba.gov.au/publications/smp/", authRequired: false, cost: "free" },
    automationFeasibility: "medium-high — forecast archive tables are downloadable, structured, and versioned",
    pipelineRole: "Primary driver for Australia/APAC-adjacent revenue segments (mining/commodity-linked exposure especially).",
  },
  {
    id: "rbnz_mps",
    countryOrArea: "New Zealand",
    institution: "Reserve Bank of New Zealand",
    publication: "Monetary Policy Statement (MPS) — OCR projection track",
    forecasts: ["Official Cash Rate (OCR) path", "GDP growth", "CPI inflation"],
    horizon: "~3 years",
    cadence: "quarterly, aligned with MPS releases",
    ratePathTransparency: "EXPLICIT_OWN_PATH",
    methodology:
      "One of the few central banks that publishes its own explicit multi-year OCR projection track, not merely a market-conditioned assumption — directly analogous to the Fed's SEP dot plot.",
    access: { method: "web publication + data", endpointOrSeriesId: null, url: "https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/the-official-cash-rate", authRequired: false, cost: "free" },
    automationFeasibility: "medium — data available but check for a structured export vs. PDF-only release",
    pipelineRole: "Small direct portfolio weight for most books, but useful as a rare 'ground truth' explicit rate path when validating whether market-conditioned approaches (BoE-style) are over/under-shooting elsewhere.",
  },
  {
    id: "norges_bank_mpr",
    countryOrArea: "Norway",
    institution: "Norges Bank",
    publication: "Monetary Policy Report (MPR) — policy rate path + fan chart",
    forecasts: ["Policy rate path (2-3 years)", "GDP growth", "inflation"],
    horizon: "2-3 years",
    cadence: "quarterly",
    ratePathTransparency: "EXPLICIT_OWN_PATH",
    methodology:
      "Publishes its own explicit policy-rate path (not market-conditioned) plus a fan chart showing forecast-error-based uncertainty bands that widen further out the horizon.",
    access: { method: "web publication + data", endpointOrSeriesId: null, url: "https://www.norges-bank.no/en/news-events/publications/Monetary-Policy-Report/", authRequired: false, cost: "free" },
    automationFeasibility: "medium — structured web reports, verify export options",
    pipelineRole: "Same 'ground truth' role as RBNZ — useful reference for validating rate-path methodology elsewhere, plus directly relevant for any Norway/Nordic energy-linked revenue exposure.",
  },
  {
    id: "rbi_mpc",
    countryOrArea: "India",
    institution: "Reserve Bank of India",
    publication: "Monetary Policy Committee (MPC) resolution + bi-monthly policy statements",
    forecasts: ["Real GDP growth", "CPI inflation"],
    horizon: "current + next fiscal year",
    cadence: "bi-monthly policy decisions (6x/year), forecasts revised at each",
    ratePathTransparency: "MARKET_CONDITIONED",
    methodology:
      "Repo rate decided by MPC vote; GDP/CPI projections revised at every bi-monthly meeting rather than a fixed quarterly cycle, so forecasts can move more frequently than G10 peers.",
    access: { method: "web publication, press releases", endpointOrSeriesId: null, url: "https://www.rbi.org.in/", authRequired: false, cost: "free" },
    automationFeasibility: "medium — no dedicated forecast API found, requires monitoring press releases/PIB announcements each cycle",
    pipelineRole: "Primary driver for India revenue exposure; the CPI target band is explicit (2-6%, 4% midpoint), useful as a standing reference point for inflation-surprise magnitude.",
  },
  {
    id: "bcb_focus",
    countryOrArea: "Brazil",
    institution: "Banco Central do Brasil",
    publication: "Focus Survey (Boletim Focus) + quarterly Inflation Report",
    forecasts: ["GDP growth", "IPCA inflation", "Selic policy rate", "exchange rate"],
    horizon: "current + next 1-2 years",
    cadence: "Focus survey: weekly; Inflation Report: quarterly",
    ratePathTransparency: "MARKET_CONDITIONED",
    methodology:
      "Focus is a survey of ~100 market economists (functionally Brazil's SPF/Blue Chip equivalent), published weekly — unusually high-frequency for a consensus survey, letting it react fast to data surprises.",
    access: { method: "free public data system", endpointOrSeriesId: null, url: "https://www.bcb.gov.br/", authRequired: false, cost: "free" },
    automationFeasibility: "high — BCB publishes structured expectations-system data, well-documented in BCB working papers",
    pipelineRole: "Best-in-class EM consensus instrument in this registry given its weekly cadence — useful template if you want the same frequency for other EM exposure.",
  },
  {
    id: "banxico_quarterly",
    countryOrArea: "Mexico",
    institution: "Banco de México",
    publication: "Quarterly Report + Citibanamex (Citi Mexico) Expectations Survey",
    forecasts: ["GDP growth", "headline and core inflation"],
    horizon: "current + next year",
    cadence: "Quarterly Report: quarterly; Citibanamex survey: bi-weekly/fortnightly",
    ratePathTransparency: "MARKET_CONDITIONED",
    methodology:
      "Banxico's own Quarterly Report gives GDP/inflation ranges; the Citibanamex survey is a private bank-run consensus poll (~30 banks) functioning as a faster-moving cross-check, similar in spirit to Brazil's Focus survey.",
    access: { method: "web publication (PDF reports)", endpointOrSeriesId: null, url: "https://www.banxico.org.mx/publications-and-press/quarterly-reports/", authRequired: false, cost: "free" },
    automationFeasibility: "medium — PDF-based reports, no dedicated forecast API found",
    pipelineRole: "Primary driver for Mexico/nearshoring-exposed revenue segments.",
  },
  {
    id: "snb_assessment",
    countryOrArea: "Switzerland",
    institution: "Swiss National Bank",
    publication: "Monetary Policy Assessment — conditional inflation forecast",
    forecasts: ["Inflation (conditional forecast)"],
    horizon: "3 years",
    cadence: "quarterly (March, June, September, December)",
    ratePathTransparency: "EXPLICIT_OWN_PATH",
    methodology:
      "Distinctive approach: the inflation forecast is explicitly conditioned on an assumption of an UNCHANGED policy rate over the full 3-year horizon. Because of this fixed assumption, changes in the forecast itself (not a stated path) are what signal the SNB's likely future direction — a rising forecast implies future tightening bias, a falling one implies easing bias.",
    access: { method: "web publication", endpointOrSeriesId: null, url: "https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions", authRequired: false, cost: "free" },
    automationFeasibility: "medium — structured quarterly releases, verify export format",
    pipelineRole:
      "Useful for Swiss-franc-denominated revenue/financing exposure; the 'unchanged rate' framing means you read the forecast drift as the signal, not a stated path — a different methodology than Norway/NZ's explicit paths, even though all three are tagged EXPLICIT_OWN_PATH-adjacent.",
  },
];
