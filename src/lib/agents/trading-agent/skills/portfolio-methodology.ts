import type { PortfolioMethodologyOutline } from "../types";

/**
 * Static reference content — same shape/pattern as options-strategies.ts:
 * pure data, no computation, cross-referencing what this app's Traditional
 * and Modern Portfolio Theory tabs actually compute rather than describing
 * the methodologies in the abstract.
 */
export const PORTFOLIO_METHODOLOGY_OUTLINES: PortfolioMethodologyOutline[] = [
  {
    id: "traditional",
    title: "Traditional: Fundamental Security Selection",
    summary:
      "Focus is on individual asset selection. Success relies on fundamental analysis — digging into balance sheets, management quality, and industry trends — to find undervalued securities. Risk is managed simply, by avoiding bad companies and spreading bets across a few sectors.",
    points: [
      {
        heading: "What you're looking for",
        detail:
          "Companies trading below their intrinsic worth — measured through balance-sheet strength, earnings stability, and conservative valuation multiples, not price momentum or market sentiment.",
      },
      {
        heading: "Risk management",
        detail:
          "Avoid bad companies (weak balance sheets, unstable earnings, excessive debt) and don't concentrate too heavily in one sector. This is a rule of thumb, not a calculated optimum — it doesn't ask how your holdings move relative to each other, just that you own a reasonable spread.",
      },
      {
        heading: "What this app computes for you",
        detail:
          "The Traditional tab pulls the Research Agent's own Sector Recommendations (which industries look constructive right now, from real macro indicator trends) and cross-references each sector's curated bellwether tickers against the Graham Checklist (7 criteria: earnings stability, current ratio, fixed-charge coverage, debt load, dividend record, Graham multiplier, and price vs. net current asset value) — the same checklist used standalone in Security Analysis.",
      },
      {
        heading: "Where it falls short",
        detail:
          "Candidate tickers are a small curated list (2-6 large-caps per sector), not a live market screen — a real screener needs a paid data plan. Sector diversification here is a count, not a measure of how your holdings actually move together.",
      },
    ],
  },
  {
    id: "modern",
    title: "Modern: Markowitz Portfolio Theory",
    summary:
      "Grounded in Harry Markowitz's Modern Portfolio Theory. The focus shifts from the individual asset to how assets behave in relation to one another — it's less about finding the perfect stock and more about finding the perfect combination of assets.",
    points: [
      {
        heading: "What you're looking for",
        detail:
          "The combination of holdings that gives the best expected return for a given level of risk — or the least risk for a given expected return. Two mediocre assets that move independently of each other can build a better portfolio than two great assets that move in lockstep.",
      },
      {
        heading: "Risk management",
        detail:
          "Diversification is measured, not assumed — via the covariance and correlation between every pair of holdings. A portfolio's risk isn't the average of its holdings' individual risks; it also depends on how those holdings co-move, which is why the correlation matrix matters as much as picking good assets.",
      },
      {
        heading: "What this app computes for you",
        detail:
          "The Modern Portfolio Theory tab computes each holding's beta (regression against the S&P 500 via SPY — how much it amplifies or dampens market moves), a full pairwise correlation matrix across your holdings, and an efficient frontier via Monte Carlo simulation (thousands of random long-only weight combinations), highlighting the max-Sharpe and minimum-volatility portfolios alongside your actual current weighting.",
      },
      {
        heading: "Where it falls short",
        detail:
          "Beta, correlation, and the frontier are all built from about a year of historical daily returns — history isn't a guarantee of future co-movement, especially in a market shock when correlations tend to rise together (\"diversification disappears exactly when you need it most\" is a well-known critique of this framework). The frontier itself is a random-sampling approximation, not an exact optimizer.",
      },
    ],
  },
];
