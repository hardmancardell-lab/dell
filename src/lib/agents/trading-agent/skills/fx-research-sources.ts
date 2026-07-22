export interface FxResearchSource {
  name: string;
  description: string;
}

export interface FxResearchCategory {
  id: string;
  title: string;
  intro: string;
  sources: FxResearchSource[];
}

export const FX_RESEARCH_CATEGORIES: FxResearchCategory[] = [
  {
    id: "balance-of-payments",
    title: "1. Balance of Payments & Official Statistics",
    intro:
      "A currency is ultimately a claim on an economy — BoP data is where that claim gets measured directly.",
    sources: [
      {
        name: "IMF Balance of Payments & International Investment Position Statistics",
        description:
          "The primary global source for current account, capital account, and financial account data by country — free, standardized across countries, published quarterly.",
      },
      {
        name: "FRED — U.S. Current Account & Net International Investment Position series",
        description:
          "Already the data source this app uses elsewhere (Macro tab). Current-account trend data lives here too, so BoP analysis can reuse the same client (src/lib/data/fred.ts) rather than a new integration.",
      },
      {
        name: "Federal Reserve H.10 Release — Foreign Exchange Rates",
        description:
          "Official daily and historical exchange rates for major currencies, published by the Fed — a primary-source reference for actual levels, not a third-party aggregator's numbers.",
      },
      {
        name: "ECB Statistical Data Warehouse",
        description:
          "Eurozone-side equivalent of FRED — current account, trade balance, and monetary statistics for the euro area, directly from the central bank that sets EUR policy.",
      },
    ],
  },
  {
    id: "positioning",
    title: "2. Positioning & Flow",
    intro:
      "Direction matters less than whether a trade is already crowded — positioning data answers that question directly instead of guessing from price action.",
    sources: [
      {
        name: "CFTC Commitment of Traders (COT) Report",
        description:
          "Weekly, free, shows aggregate speculative and commercial positioning in currency futures — directly actionable for checking whether a rate-differential or safe-haven trade is already crowded before entering.",
      },
    ],
  },
  {
    id: "central-banks",
    title: "3. Central Bank Primary Sources",
    intro:
      "Rate differentials and their expected path are set by these institutions directly — read the primary statement, not a summary of it.",
    sources: [
      { name: "Federal Reserve — FOMC Statements & Summary of Economic Projections (dot plot)", description: "USD side of every major pair." },
      { name: "European Central Bank — Press Conferences & Monetary Policy Statements", description: "EUR/USD." },
      { name: "Bank of Japan — Policy Statements", description: "USD/JPY — Japan held near-zero rates far longer than other major central banks, making policy shifts here unusually market-moving." },
      { name: "Bank of England — Monetary Policy Reports", description: "GBP/USD." },
      { name: "Swiss National Bank — Policy Announcements", description: "USD/CHF — the franc is a classic safe-haven currency, so SNB communication on intervention is itself market-moving." },
      { name: "Reserve Bank of Australia — Statements on Monetary Policy", description: "AUD/USD — read alongside Chinese trade data, since AUD behaves as a China-proxy currency." },
      { name: "Bank of Canada — Monetary Policy Reports", description: "USD/CAD — read alongside crude oil prices, since CAD behaves as an oil-proxy currency." },
    ],
  },
  {
    id: "academic",
    title: "4. Academic & Market-Microstructure Research",
    intro:
      "One paper here is independently verifiable as real, foundational research — cited for what it actually found, not for specific numbers attached to it in secondary retellings.",
    sources: [
      {
        name: "Andersen, Bollerslev, Diebold & Vega — \"Micro Effects of Macro Announcements: Real-Time Price Discovery in Foreign Exchange\" (American Economic Review, 2003)",
        description:
          "The core, verifiable finding: the mean of the exchange rate adjusts to a macro surprise almost instantly, while the volatility of the exchange rate persists and decays over the following hours. That size-and-sign asymmetry — not any specific pip figure — is the real, citable result behind the \"fade small surprises, ride large ones\" framework below.",
      },
      {
        name: "Bank for International Settlements — Triennial Central Bank Survey of FX Turnover",
        description:
          "The definitive source on FX market structure and turnover by currency pair, venue, and counterparty type — published every three years, free.",
      },
    ],
  },
];

export interface FxStrategySignal {
  id: string;
  name: string;
  buySignal: string;
  sellSignal: string;
  confirmingCheck: string;
}

export const FX_STRATEGY_FRAMEWORK: FxStrategySignal[] = [
  {
    id: "rate-differential",
    name: "Interest Rate Differential (Carry / UIP)",
    buySignal:
      "Policy-rate path widening in the currency's favor — a hawkish central bank (holding or hiking, hot inflation prints) against a dovish counter-currency central bank. What matters is the change in the expected path, not the static level.",
    sellSignal:
      "Differential compressing or reversing — dovish pivot signals (cooling CPI, rising unemployment, dovish central bank language).",
    confirmingCheck:
      "Use the real yield differential (nominal minus inflation expectations), not nominal alone, and check CFTC COT positioning first to avoid entering an already-crowded trade.",
  },
  {
    id: "balance-of-payments",
    name: "Balance of Payments",
    buySignal: "Current account surplus widening, or twin deficits (fiscal + current account) narrowing.",
    sellSignal:
      "Current account deficit widening AND financial-account (FDI + portfolio) inflows failing to keep pace. A deficit alone is not the signal — the U.S. ran current-account deficits for decades with a structurally strong dollar because reserve-currency status pulled in large offsetting financial-account inflows.",
    confirmingCheck:
      "Only flag bearish if the current-account trend and the financing trend point the same way at the same time — that combination is the real BoP-stress pattern (e.g. the 2013 \"Taper Tantrum\" Fragile Five episodes), not the deficit figure alone.",
  },
  {
    id: "safe-haven",
    name: "Safe-Haven / Risk-Off",
    buySignal:
      "Buy USD/CHF/JPY/gold: VIX spiking past a defined threshold, credit spreads widening, a real geopolitical catalyst confirmed via news coverage (see News Search tab).",
    sellSignal:
      "Sell safe havens / buy risk currencies (EM, AUD/NZD): VIX declining, spreads tightening, risk-on confirmed broadly across assets.",
    confirmingCheck:
      "Confirm the move shows up as a broad-basket safe-haven bid — not one pair moving on idiosyncratic news — before treating it as a real risk-off regime rather than noise.",
  },
  {
    id: "commodity-currency",
    name: "Commodity-Currency Correlation",
    buySignal:
      "Buy AUD/CAD/NOK: rising oil or industrial-metals prices, strong China PMI (AUD specifically is a China-proxy currency).",
    sellSignal: "Falling commodity prices, weak China demand data.",
    confirmingCheck:
      "Check that the rolling correlation hasn't decoupled — it does, e.g. when a central bank's own policy divergence overrides the commodity relationship. Use as a confirming signal alongside the rate-differential read, not standalone.",
  },
  {
    id: "event-reaction",
    name: "Event-Reaction: Fade vs. Ride",
    buySignal:
      "Ride the move: surprise magnitude is a genuine outlier (roughly 2+ standard deviations from consensus, not a narrow miss/beat), the initial move doesn't retrace more than half within the first 15-30 minutes, and it's confirmed by a follow-through print in the same data category weeks later.",
    sellSignal:
      "Fade the move: surprise is small or mixed (within roughly 1 standard deviation, or the headline number contradicts the internals — e.g. a weak headline payrolls print with hot wage growth), the initial spike retraces quickly, no confirming follow-through.",
    confirmingCheck:
      "Turning this into measured numbers (rather than a qualitative read) requires an economic calendar with a computed consensus-vs-actual surprise z-score plus historical intraday FX price data around event timestamps — neither is available in this app yet. See the caveat below before trusting any specific pip figure.",
  },
];
