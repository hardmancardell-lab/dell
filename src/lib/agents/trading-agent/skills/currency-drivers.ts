// Static authored reference content, same pattern as fx-research-sources.ts
// but complementary scope: that file is "where to find FX data," this one is
// "what actually moves a currency's value," written in an expert
// international-finance/macroeconomics voice per the user's explicit request.

export interface CurrencyDriverExample {
  label: string;
  detail: string;
}

export interface CurrencyDriverCategory {
  id: string;
  title: string;
  intro: string;
  mechanism: string;
  examples: CurrencyDriverExample[];
}

export const CURRENCY_DRIVER_CATEGORIES: CurrencyDriverCategory[] = [
  {
    id: "rate-differentials",
    title: "Interest Rate Differentials & Central Bank Policy",
    intro:
      "The single largest systematic driver of exchange rates over any horizon longer than a few days. Capital flows toward the currency offering the higher risk-adjusted real yield — this is the mechanism behind carry trades, and it's why rate-decision days and central bank forward guidance move currency pairs more reliably than almost any other scheduled event.",
    mechanism:
      "When one central bank hikes (or is expected to hike) faster than another, that currency's short-term instruments become relatively more attractive, pulling in capital flows and appreciating the currency — until the market has fully priced the expected path, at which point it's the surprise relative to expectations, not the absolute rate level, that moves price. Forward guidance and dot-plot-style projections often move a currency more than the actual rate decision, because markets are forward-looking and the decision itself is usually already priced in.",
    examples: [
      { label: "Policy divergence", detail: "One central bank hiking while another holds or cuts — the classic setup behind sustained multi-month currency trends (e.g. Fed vs. ECB, Fed vs. BOJ)." },
      { label: "Forward guidance surprise", detail: "A central bank statement that's more hawkish or dovish than the market expected can move a pair sharply even with no change to the actual rate." },
      { label: "Real yield differentials", detail: "Nominal rate differentials adjusted for inflation expectations — what actually drives capital flows, since a high nominal rate with even higher inflation offers a negative real return." },
    ],
  },
  {
    id: "balance-of-payments",
    title: "Balance of Payments (BOP) Events",
    intro:
      "A country's balance of payments records every transaction between it and the rest of the world. Persistent imbalances here are a structural, slower-moving driver of currency valuation than rate differentials — but they set the medium-term trend that shorter-term rate and sentiment moves trade around.",
    mechanism:
      "A current account deficit means a country is importing more (goods, services, income) than it exports, and must fund that gap by attracting foreign capital (the capital/financial account) — if that capital doesn't show up in sufficient size, the currency has to weaken to make the country's exports cheaper and imports more expensive until the accounts rebalance. A persistent, large current account deficit funded increasingly by short-term 'hot money' rather than stable long-term investment is a classic precursor to a sharp currency correction.",
    examples: [
      { label: "Current account deficit/surplus", detail: "The broadest BOP read — a widening deficit is a structural headwind for a currency over time, a widening surplus a structural tailwind." },
      { label: "Trade balance releases", detail: "The monthly/quarterly trade-balance print is a direct, high-frequency proxy for the current account's trajectory." },
      { label: "Portfolio and FDI flows", detail: "Foreign direct investment and portfolio capital inflows are what actually fund a deficit — a sudden reversal of these flows (capital flight) is one of the fastest ways a currency can move sharply." },
    ],
  },
  {
    id: "fiscal-policy",
    title: "Fiscal Policy & Government Debt",
    intro:
      "Government spending, taxation, and debt issuance affect a currency both directly (through their effect on growth and inflation, which feed back into central bank policy) and through sovereign credit risk — a government whose debt trajectory looks unsustainable faces a currency risk premium regardless of what its central bank is doing.",
    mechanism:
      "Expansionary fiscal policy (deficit spending) can support near-term growth and, if it raises inflation expectations, can actually pressure a central bank toward tighter policy — a fiscal-monetary interaction that can either support or undermine a currency depending on how credible the fiscal path looks. At the extreme, a debt trajectory the market judges unsustainable (a widening deficit with no credible path to stabilization) can trigger a currency crisis independent of the central bank's own actions, because investors demand a growing risk premium to hold that country's assets, including its currency.",
    examples: [
      { label: "Deficit-to-GDP trajectory", detail: "A rapidly widening deficit-to-GDP ratio with no credible consolidation plan is a slow-burn currency risk, even when growth looks fine in the near term." },
      { label: "Sovereign credit rating actions", detail: "A rating downgrade (or the threat of one) directly repricing sovereign risk premia, which flows through to the currency." },
      { label: "Debt ceiling / fiscal standoff events", detail: "Political brinkmanship over government funding or debt limits creates acute, event-driven currency volatility even absent any change in underlying fundamentals." },
    ],
  },
  {
    id: "geopolitical-risk",
    title: "Geopolitical Risk & Safe-Haven Flows",
    intro:
      "In moments of acute global stress, capital doesn't just seek the highest yield — it seeks safety, and flows into a small set of currencies (historically USD, JPY, CHF) regardless of those countries' own domestic conditions at that moment. This is the mechanism that can decouple a currency's short-term move from its own economy's fundamentals entirely.",
    mechanism:
      "War, sanctions, a sudden sovereign default, or a systemic financial-stability scare triggers a global 'risk-off' flight: investors sell risk assets and emerging-market currencies broadly and buy the deepest, most liquid safe-haven assets, which happen to be denominated in a handful of reserve currencies. The scale of the move is often disproportionate to any direct economic link between the event and the safe-haven country — the mechanism is pure flight-to-safety, not fundamentals.",
    examples: [
      { label: "Armed conflict / war onset", detail: "Sudden safe-haven demand and a simultaneous flight from the currencies of directly and indirectly affected economies." },
      { label: "Sanctions regimes", detail: "Sanctions cutting a country off from international payment systems (e.g. SWIFT exclusion) can cause its currency to collapse independent of its underlying economic fundamentals, since the currency becomes practically unusable for cross-border trade." },
      { label: "Sovereign default or restructuring", detail: "A default event triggers an immediate, sharp currency devaluation as the market reprices the country's entire risk profile at once." },
    ],
  },
  {
    id: "macro-data-surprises",
    title: "Macroeconomic Data Surprises",
    intro:
      "Scheduled data releases move currencies not based on the absolute number, but based on the surprise relative to consensus expectations — a 'good' number that's still worse than expected can weaken a currency, and vice versa. This is the mechanism behind the sharp, short-lived volatility clustering around major data releases.",
    mechanism:
      "Markets price in the consensus expectation ahead of a release; the actual print only moves price to the extent it differs from that expectation, because the expected portion is already reflected. Inflation surprises are typically the most currency-moving data category, because they directly change the expected central bank policy path — a hot inflation print raises expected future rates (currency-supportive), a cool one lowers them (currency-negative), transmitting through the exact rate-differential mechanism above.",
    examples: [
      { label: "Inflation prints (CPI/PCE)", detail: "The most reliably currency-moving scheduled release, because it directly feeds the market's expected central bank policy path." },
      { label: "Employment reports", detail: "A strong labor market supports a hawkish policy path (currency-supportive); a weakening one supports a dovish path (currency-negative)." },
      { label: "GDP and PMI releases", detail: "Broader growth reads that shift the market's medium-term growth differential view between two economies." },
    ],
  },
  {
    id: "cross-border-events",
    title: "Cross-Border Events Between Countries",
    intro:
      "Events that specifically involve the relationship between two economies — not just domestic conditions in either one alone — can move a currency pair independent of either country's individual fundamentals, because they change the terms of trade or capital-flow relationship between them directly.",
    mechanism:
      "A trade dispute, a currency peg or intervention, or a bilateral policy shift changes the actual mechanics of how capital and goods flow between two specific economies, which shows up first and most directly in their bilateral exchange rate before it shows up in either country's broader domestic data.",
    examples: [
      { label: "Trade wars / tariff announcements", detail: "Directly repricing the expected trade balance between two economies, and by extension their bilateral exchange rate." },
      { label: "Currency pegs and bands", detail: "A country abandoning or adjusting a currency peg (or a managed band) can cause an immediate, discontinuous repricing, since the peg itself was suppressing the 'true' market-clearing rate." },
      { label: "Central bank FX intervention", detail: "Direct buying or selling of a currency by its own central bank to defend a level — can move a pair sharply and abruptly, and has historically been most consequential in USD/JPY given Japan's history of intervention." },
    ],
  },
];
