// Plain reference content — same shape/pattern as options-strategies.ts and
// portfolio-methodology.ts. Scoped to Trading Agent concepts (statistics,
// performance metrics, strategy concepts, options/macro terms) since that's
// what triggered the request — Research Agent and Portfolio Tracker have
// their own jargon (NCAV, Graham checklist criteria, Sharpe ratio, efficient
// frontier) that would get their own glossary using this identical pattern
// as a natural follow-up, not built here.

export type GlossaryCategory = "statistics" | "performance" | "strategy" | "options";

export interface GlossaryEntry {
  term: string; // stable key, referenced by <GlossaryTerm term="...">
  label: string; // display name
  category: GlossaryCategory;
  definition: string;
  seeAlso?: string[]; // other term keys
}

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  // --- Statistics ---
  {
    term: "pValue",
    label: "p-value",
    category: "statistics",
    definition:
      "The probability of seeing a result at least this extreme if there were actually no real effect (pure chance). Smaller means more surprising — conventionally, below 0.05 is treated as \"probably real,\" but this app doesn't stop there (see Passes All 3 Bars).",
    seeAlso: ["fdrAdjustedP", "passesAllThreeBars"],
  },
  {
    term: "fdrAdjustedP",
    label: "FDR-adjusted p",
    category: "statistics",
    definition:
      "A corrected p-value that accounts for testing many things at once (e.g. 5 different horizons or checkpoints in the same backtest). Testing more things makes it more likely something looks significant purely by chance — this Benjamini-Hochberg correction raises the bar accordingly, so a raw p-value under 0.05 doesn't automatically mean it survives here.",
    seeAlso: ["pValue"],
  },
  {
    term: "bootstrapCi",
    label: "Bootstrap 95% CI",
    category: "statistics",
    definition:
      "A confidence interval built by resampling the actual historical occurrences thousands of times and seeing how much the average result varies. If this range excludes zero, the effect looks real rather than noise that could plausibly average out to nothing.",
  },
  {
    term: "oosSignAgrees",
    label: "OOS Sign Agrees",
    category: "statistics",
    definition:
      "Out-of-sample sign agreement: the historical occurrences are split chronologically — the earliest 75% (\"train\") and the most recent 25% (\"test\"). This checks whether the effect pointed the same direction (up or down) in both halves, not just in the data as a whole — a basic check against an effect that only existed in the past and has since disappeared.",
  },
  {
    term: "passesAllThreeBars",
    label: "Passes All 3 Bars",
    category: "statistics",
    definition:
      "This app's minimum bar for treating a result as a real, tradeable edge rather than noise: it must (1) survive FDR correction, AND (2) have a bootstrap confidence interval that excludes zero, AND (3) point the same direction in both the early and recent halves of history. All three, not just one — a result can look good on any single measure and still fail this bar.",
    seeAlso: ["fdrAdjustedP", "bootstrapCi", "oosSignAgrees"],
  },
  {
    term: "zScore",
    label: "Z-Score",
    category: "statistics",
    definition:
      "How many standard deviations today's value is from its recent rolling average. A z-score of +2 means today is unusually high relative to its own recent history; -2 means unusually low. Used by Mean Reversion to flag when a price has drifted unusually far from its own trend.",
  },
  {
    term: "sampleSize",
    label: "Sample Size (N)",
    category: "statistics",
    definition:
      "How many historical occurrences the result is based on. Below about 30, this app explicitly flags results as directional only — small samples can look statistically striking purely by chance.",
  },

  // --- Performance metrics ---
  {
    term: "winRate",
    label: "Win Rate",
    category: "performance",
    definition: "The percentage of historical occurrences that were profitable (return > 0).",
  },
  {
    term: "profitFactor",
    label: "Profit Factor",
    category: "performance",
    definition:
      "Total gains from winning occurrences divided by total losses from losing ones. Above 1.0 means the wins outweighed the losses in aggregate; below 1.0 means the losses outweighed the wins, even if the win rate looks decent.",
  },
  {
    term: "expectancy",
    label: "Expectancy",
    category: "performance",
    definition:
      "The average return per occurrence, blending win rate and average win/loss size into one number. Mathematically the same as the plain average return shown elsewhere — shown again here because it's the conventional name traders use when talking about a strategy's per-trade edge.",
  },
  {
    term: "maxDrawdown",
    label: "Max Drawdown",
    category: "performance",
    definition:
      "The largest peak-to-trough decline if you'd taken every occurrence in sequence, compounding as you go. A simulation, not a guarantee — and since some of this app's forward-return windows overlap (see the data-limitations notes on each backtest), this understates real drawdown risk somewhat.",
  },
  {
    term: "avgWinLoss",
    label: "Avg Win / Avg Loss",
    category: "performance",
    definition: "The average return across winning occurrences only, and separately across losing occurrences only.",
  },

  // --- Strategy concepts ---
  {
    term: "openingRangeBreakout",
    label: "Opening Range Breakout (ORB)",
    category: "strategy",
    definition:
      "A strategy built around the first few minutes of the trading day: the high/low of that opening window defines a \"range,\" and a breakout signal fires the first time price closes beyond that range afterward. The idea is that an early break of the opening range can signal the direction the rest of the session tends to follow.",
  },
  {
    term: "meanReversion",
    label: "Mean Reversion",
    category: "strategy",
    definition:
      "The idea that a price which has moved unusually far from its own recent average tends to drift back toward that average. Flagged here using a z-score threshold — a statistical observation, not a guarantee reversion will actually happen.",
    seeAlso: ["zScore"],
  },
  {
    term: "momentum",
    label: "Momentum",
    category: "strategy",
    definition:
      "The idea that a stock already moving in a direction, with rising volume behind the move, tends to keep moving that way in the near term. This app's version specifically looks for 3 consecutive green closing days with strictly increasing volume.",
  },
  {
    term: "volumeDisplacement",
    label: "Volume Displacement",
    category: "strategy",
    definition:
      "A flag for when today's trading volume is unusually high relative to its own recent trailing average — a sign that something is drawing unusual attention or activity to a ticker right now.",
  },
  {
    term: "calendarEffects",
    label: "Calendar Effects",
    category: "strategy",
    definition:
      "Patterns tied to the calendar rather than to price action itself — does a ticker tend to move differently on certain days of the week, or at certain times within the trading session? Tested with the same statistical rigor as every other backtest in this app, since most apparent calendar patterns turn out to be noise.",
  },
  {
    term: "premarketVolumeAnomaly",
    label: "Premarket Volume Anomaly",
    category: "strategy",
    definition:
      "A flag for when premarket trading volume (4:00-9:30am ET) is unusually high relative to its own trailing average — often a sign of overnight news driving early interest before the regular session even opens.",
  },

  // --- Options / macro ---
  {
    term: "gex",
    label: "GEX (Gamma Exposure)",
    category: "options",
    definition:
      "An estimate of how much options dealers would need to buy or sell the underlying stock to stay hedged as its price moves, based on the options positions currently open. Positive GEX regimes tend to dampen price swings (dealers buy dips and sell rallies to stay hedged); negative GEX regimes tend to amplify them (dealers do the opposite).",
    seeAlso: ["gammaFlip"],
  },
  {
    term: "gammaFlip",
    label: "Gamma Flip",
    category: "options",
    definition:
      "The price level where dealer gamma exposure flips from positive to negative (or vice versa) — often watched as a level where a stock's typical \"calm, range-bound\" behavior can shift to more volatile behavior, or the reverse.",
    seeAlso: ["gex"],
  },
  {
    term: "putCallRatio",
    label: "Put/Call Ratio",
    category: "options",
    definition:
      "Put volume divided by call volume for a given underlying. A high ratio suggests more bearish positioning (or hedging) relative to bullish; a low ratio suggests the opposite. A simple directional read, not a precise timing signal.",
  },
  {
    term: "ivTermStructure",
    label: "IV Term Structure",
    category: "options",
    definition:
      "How implied volatility compares between near-term and longer-term option expirations. \"Backwardation\" (near-term IV higher than longer-term) often shows up around known near-term catalysts like earnings; \"contango\" (the normal, calmer shape) is near-term IV lower than longer-term.",
  },
];

export function getGlossaryEntry(term: string): GlossaryEntry | undefined {
  return GLOSSARY_ENTRIES.find((e) => e.term === term);
}
