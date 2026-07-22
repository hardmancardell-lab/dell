// Originally the user's stated observed threshold (4-5x); lowered to 2x per
// explicit request (2026-07-17) to catch anomalies earlier/more often.
export const PM_VOLUME_ANOMALY_MULTIPLE = 2;

export const ROLLING_AVERAGE_LOOKBACK_DAYS = 20;

// Conservative starting window — minute-bar historical depth on either
// provider's free tier is unconfirmed until live-tested (see schwab.ts and
// ALPACA_INTEGRATION_NOTES.md). On Alpaca specifically, a 180-day premarket
// minute-bar pull means many paginated requests per symbol (see MAX_PAGES in
// alpaca.ts) — may need tuning down once real rate-limit behavior is known.
export const HISTORICAL_COMPOSITE_LOOKBACK_DAYS = 180;

// Watchlist scan — Volume Displacement (full-session daily volume, not
// premarket-only, so it applies uniformly across equities/futures/forex).
export const VOLUME_DISPLACEMENT_MULTIPLE = 2;
export const VOLUME_DISPLACEMENT_LOOKBACK_DAYS = 20;

// Watchlist scan — Momentum (3 consecutive green closes with strictly
// increasing volume each day).
export const MOMENTUM_WINDOW_DAYS = 3;

// Calendar-effects / ORB — day-of-week uses cheap daily bars, so the same
// generous multi-year dropdown as HistoricalBacktestTab.tsx is fine.
export const DAY_OF_WEEK_LOOKBACK_YEAR_OPTIONS = [1, 2, 3, 5];
// Time-of-day needs minute bars for one ticker — 180 matches
// HISTORICAL_COMPOSITE_LOOKBACK_DAYS above, already exercised live elsewhere.
export const TIME_OF_DAY_LOOKBACK_DAY_OPTIONS = [30, 90, 180];
// ORB watchlist scan pulls minute bars for every ticker in parallel — the
// expensive case (see ALPACA_INTEGRATION_NOTES.md's documented 200 req/min
// free-tier limit) — kept in months, default well within Alpaca's per-symbol
// pagination cap.
export const ORB_LOOKBACK_MONTH_OPTIONS = [1, 3, 6];

// Single-weekday calendar effects ("last N Fridays") — occurrence-count
// based rather than calendar-year based, so a recent short-term catalyst
// doesn't get diluted into a full-year bucket. 50 occurrences of one weekday
// spans ~1 calendar year, same order of minute-bar pull as
// HISTORICAL_COMPOSITE_LOOKBACK_DAYS/TIME_OF_DAY above — real, unverified-
// beyond-what's-live-tested depth risk applies the same way here.
export const SINGLE_WEEKDAY_OCCURRENCE_OPTIONS = [20, 50, 100];
