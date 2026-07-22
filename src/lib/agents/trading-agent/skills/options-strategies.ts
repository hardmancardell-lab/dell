import type { OptionsStrategyCategory } from "../types";

/**
 * Reference/educational content — same static-content pattern as
 * fx-research-sources.ts. No data fetching, no computation; this is a
 * catalog plus a reading guide, cross-referenced against the signals this
 * app actually computes (gex-signal.ts, options-flow-skew.ts).
 */
export const OPTIONS_STRATEGY_CATEGORIES: OptionsStrategyCategory[] = [
  {
    id: "income",
    title: "1. Income / Premium-Selling",
    intro:
      "Collect option premium by selling optionality, betting realized volatility comes in lower than what's priced. Best suited to positive-gamma, range-bound conditions.",
    strategies: [
      {
        name: "Covered Call",
        whatItIs: "Sell a call against shares you already own.",
        whenToUse:
          "Neutral-to-mildly-bullish outlook, want to generate income on an existing holding, and are willing to cap further upside at the strike sold.",
        oiVolumeNote:
          "Rising open interest at the sold strike alongside a stable or grinding-higher underlying often reflects other holders running the same trade — a crowded call strike can itself become resistance, especially where it coincides with this app's GEX call wall.",
      },
      {
        name: "Cash-Secured Put",
        whatItIs: "Sell a put backed by enough cash to buy the shares if assigned.",
        whenToUse:
          "Willing to own the stock at a lower price, positive-to-neutral outlook, and put implied volatility looks rich relative to your own expected move.",
        oiVolumeNote:
          "Heavy open-interest buildup at a put strike below spot often marks a level market makers — short gamma there — will lean on hedging flow to defend, similar to a GEX put wall.",
      },
      {
        name: "Credit Spread (Bull Put / Bear Call)",
        whatItIs: "Sell a closer-to-the-money option, buy a further one for defined risk.",
        whenToUse:
          "Want a high-probability, defined-risk income trade expressing a moderate directional or neutral view rather than an unlimited-risk naked short.",
        oiVolumeNote:
          "A strike where volume traded today far exceeds existing open interest suggests fresh positioning being opened at that level, not existing holders simply trading with each other.",
      },
      {
        name: "Iron Condor",
        whatItIs: "A bull put spread and a bear call spread combined — profits if the underlying stays inside the range.",
        whenToUse:
          "Expecting low realized volatility / range-bound movement — the textbook fit for a positive dealer-gamma regime, where dealer hedging itself tends to dampen swings.",
        oiVolumeNote:
          "Open interest concentrated symmetrically on both sides of spot is the options market's own range forecast — the wing strikes often cluster near this app's GEX call and put walls.",
      },
    ],
  },
  {
    id: "directional",
    title: "2. Directional",
    intro:
      "Express a view on where the underlying is headed, with defined maximum loss (the premium paid).",
    strategies: [
      {
        name: "Long Call / Long Put",
        whatItIs: "Buy a call or put outright.",
        whenToUse:
          "Strong directional conviction, want defined max loss with leveraged upside, and implied volatility isn't so rich that you're overpaying for that leverage.",
        oiVolumeNote:
          "A volume surge far exceeding existing open interest at an out-of-the-money strike is one of the more literal \"someone is positioning ahead of news\" reads — commonly called unusual options activity.",
      },
      {
        name: "Debit Spread (Bull Call / Bear Put)",
        whatItIs: "Buy a closer strike, sell a further one to offset the cost.",
        whenToUse:
          "Directional view, but want to reduce the cost and volatility exposure (vega) of a naked long option in exchange for a capped payoff.",
        oiVolumeNote:
          "A wall of open interest at the short strike marks the level the trade is effectively betting will act as a boundary to the move.",
      },
    ],
  },
  {
    id: "volatility",
    title: "3. Volatility",
    intro:
      "Trade the magnitude of a move (or the lack of one) rather than its direction — positioning is driven by the options market's own term structure and implied-vs-realized volatility gap.",
    strategies: [
      {
        name: "Long Straddle / Strangle",
        whatItIs: "Buy a call and a put (same or different strikes), profiting from a big move in either direction.",
        whenToUse:
          "Ahead of a known catalyst (earnings, a Fed decision, a data print) — fits a negative-gamma regime where dealer hedging amplifies rather than dampens moves, especially alongside backwardation (near-term IV priced above far-term).",
        oiVolumeNote:
          "Open interest rising on both the call and put side simultaneously, or near-term IV climbing above further-dated IV, reflects the market itself pricing in an event.",
      },
      {
        name: "Short Straddle / Strangle",
        whatItIs: "Sell both a call and a put, betting on low realized volatility — carries substantial (theoretically unlimited) risk.",
        whenToUse:
          "Positive-gamma regime with implied volatility rich relative to the realized move you actually expect, and only with an explicit hedging/risk plan given the uncapped risk.",
        oiVolumeNote:
          "Elevated open interest building without corresponding movement in the underlying is a marker of range-bound positioning consistent with this trade's thesis.",
      },
      {
        name: "Calendar Spread",
        whatItIs: "Sell a near-dated option, buy a further-dated option at the same strike, profiting from the difference in time decay (and often a normalizing term structure).",
        whenToUse:
          "Elevated near-term IV expected to settle after an event passes, or — with no strong directional or volatility signal either way — a reasonable lower-risk default rather than a naked directional or volatility bet.",
        oiVolumeNote:
          "Requires comparing open interest and IV across two expirations rather than reading a single expiration in isolation — this app's IV term-structure signal (near vs. far) is exactly that comparison.",
      },
    ],
  },
  {
    id: "hedging",
    title: "4. Hedging",
    intro:
      "Use options as insurance on an existing position rather than as a standalone bet.",
    strategies: [
      {
        name: "Protective Put",
        whatItIs: "Buy a put against shares you own, capping downside for the cost of the premium.",
        whenToUse:
          "Want to stay long through uncertainty but cap downside risk — fits a negative-gamma, volatile regime where a sharp move is more plausible.",
        oiVolumeNote:
          "Broad put open-interest growth across many strikes and names simultaneously (not concentrated in one underlying) is a classic hedging-demand signature, distinct from concentrated single-name bearish speculation.",
      },
      {
        name: "Collar",
        whatItIs: "Combine a protective put with a covered call, using the call premium to offset the put's cost.",
        whenToUse:
          "Want downside protection without paying full premium out of pocket, and are willing to cap upside in exchange — common around concentrated stock positions.",
        oiVolumeNote:
          "Paired open-interest growth in both a downside put and an upside call around the same time, at strikes roughly symmetric around spot, often reflects this exact structure being built.",
      },
    ],
  },
];

export interface OiVolumeReadingEntry {
  pattern: string;
  meaning: string;
}

export const OI_VOLUME_READING_GUIDE: OiVolumeReadingEntry[] = [
  {
    pattern: "Rising open interest + rising price",
    meaning:
      "New long positions opening as price rises — bullish conviction building, not just existing positions changing hands.",
  },
  {
    pattern: "Rising open interest + falling price",
    meaning:
      "New short or put positions opening as price falls — bearish conviction building, not simply longs capitulating.",
  },
  {
    pattern: "Falling open interest",
    meaning:
      "Existing positions closing or unwinding, regardless of which direction price is moving — the prior trend's conviction is fading, not necessarily reversing.",
  },
  {
    pattern: "Volume far exceeding open interest at a strike",
    meaning:
      "Fresh positioning happening within the session rather than existing holders simply trading with each other. The larger the ratio, the more likely it reflects new information hitting the market — the pattern generally called \"unusual options activity.\"",
  },
  {
    pattern: "Open interest concentrated at specific strikes",
    meaning:
      "Those strikes often become de facto support/resistance, because market makers who are short gamma there must hedge by buying or selling the underlying as price approaches — exactly what this app's GEX call-wall/put-wall levels represent.",
  },
  {
    pattern: "Put/call open-interest ratio extremes",
    meaning:
      "A very high ratio can reflect broad hedging demand and genuine bearishness, or — at capitulation-level extremes — can be read as a contrarian bullish signal instead. The ratio alone doesn't distinguish the two; whether IV is also spiking and whether the positioning is broad-market or single-name context matters more than the number itself.",
  },
];

export interface InstitutionalUseCase {
  useCase: string;
  explanation: string;
}

export const INSTITUTIONAL_USE_CASES: InstitutionalUseCase[] = [
  {
    useCase: "Hedging / Tail-Risk Management",
    explanation:
      "Large asset managers and pension funds buy puts or put spreads to insure concentrated equity or index exposure against a sharp decline, without having to sell an underlying position that may be illiquid or trigger tax consequences.",
  },
  {
    useCase: "Income Generation on Large Holdings",
    explanation:
      "Institutions running systematic covered-call or put-writing overlay programs on large equity holdings sell options on a rolling basis to generate incremental yield on top of the underlying position.",
  },
  {
    useCase: "Leverage / Capital Efficiency",
    explanation:
      "Options let a desk express a view using a fraction of the capital a direct position in the underlying would require, freeing the remaining capital for other uses while maintaining the desired exposure.",
  },
  {
    useCase: "Expressing a View Without Moving the Underlying",
    explanation:
      "A large directional trade in the underlying itself can move the market against the trader. Options — particularly in deep, liquid names — can sometimes be sized and structured to express the same view with a smaller market-impact footprint.",
  },
  {
    useCase: "Volatility Trading",
    explanation:
      "Some institutional desks trade volatility itself as an asset class independent of direction — dispersion trades, volatility arbitrage between related instruments, or simply a view on whether realized volatility will exceed what's currently implied.",
  },
  {
    useCase: "Dealer Market-Making & Hedging Flow",
    explanation:
      "The counterparty to most of the above: market makers who sell options to these participants must dynamically hedge the resulting gamma exposure, and that hedging flow is exactly what this app's GEX/dealer-positioning signal (gex-signal.ts) is designed to model.",
  },
];
