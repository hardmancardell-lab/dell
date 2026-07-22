# Deferred Features — Recommended But Not Built, and Why

Source: the Competitive Analysis ("What to Build Next") artifact's Tier 1/2/3 Recommended
Build Priority, checked against ~30 real competitors across all three agents. Phase 7 executed
the Research Agent's feasible items. This file records everything else from that list —
split into **genuinely blocked** (a real constraint stops it today) and **feasible, just not
yet built** (no blocker, purely a prioritization choice) — so nothing gets silently forgotten.

No action needed on any of this right now. Revisit if/when priorities change.

---

## Genuinely blocked (real constraint, not just unprioritized)

### Mobile — native app
**Why blocked:** a native app (Swift/Kotlin or React Native) is a full second codebase, app-store
developer accounts, and a review/release process — a different order of investment than anything
built so far. Competitive research found mobile as the single most universal gap across all three
agent categories, but "build native" isn't a right-sized first step without validated demand.
**Status:** PWA is the recommended smaller step instead — see the sharing/PWA discussion in this
session. Not yet built either, but a much shorter path.

### Account aggregation (Portfolio Tracker)
**Why blocked:** not a data or engineering limitation — a direct conflict with this app's core
design principle (no third-party credential/account linking, manual entry only, established at
the start of this project and reaffirmed multiple times). Real aggregation (Plaid-style) means
holding or proxying other institutions' credentials. Needs its own dedicated conversation about
whether to relax that principle before any design work — not a default "yes, build it."

### Institutional/13F ownership tracking (Research Agent)
**Why blocked:** zero evidence FMP's free tier supports this — no endpoint, type, or reference
anywhere in the codebase (unlike the screener's confirmed 402 or the statement-fetchers'
confirmed 5-year cap, both verified empirically). Would need a fresh probe against FMP's API
before committing to anything. Not tested this pass.

### International / ex-US equity coverage (Research Agent)
**Why blocked:** same reasoning as 13F data — no confirmed FMP support, uncharted. Deferred
pending a probe.

### True push alerts (Research Agent, and everywhere else in this app)
**Why blocked:** architectural, not per-feature — this app has no background server process
anywhere (a standing decision from early in the project, reaffirmed at every phase). What exists
instead is real: on-load flags computed from live data (e.g. Watchlist Overview's "Strong"
badges), not a faked notification. A true push-alert system would require introducing the exact
kind of standing infrastructure (scheduler, always-on server, delivery channel) this app has
deliberately avoided.

### Institutional-grade options/futures microstructure indicators (Trading Agent)
CVD, footprint/cluster charts, liquidity heatmaps, iceberg detection — need Level 2 order-book
depth or bid/ask-tagged tick data. Researched in Phase 5: Polygon has no L2 at any tier, IEX
Cloud shut down in 2024, Databento is the real option ($179/mo+ after a one-time free credit).
No free path exists. Revisit only if paying for Databento becomes worthwhile.

### Real-time futures data (Trading Agent)
Already resolved via ETF proxies for both Futures and Commodities (user-approved). True futures
tick data needs a CQG (~$10/mo) or Rithmic (~$25/mo) feed even with an active Tradier Futures
account — confirmed this session the account is pending, not yet active, and commissions/data
fees apply regardless. Not pursued further; proxies are the standing solution.

### Custom scripting language (Pine Script equivalent, Trading Agent)
Large, open-ended undertaking (parser, sandboxed execution, its own UI) — no partial version
was scoped or estimated. Flagged as a real competitor differentiator, not attempted.

### Analyst consensus estimates / price targets (Research Agent)
**Not actually a gap** — deliberately excluded on principle. Graham's method avoids forward
guessing; building this would work against the checklist's own philosophy, not close a gap.
Recorded here for completeness, not as a TODO.

---

## Feasible, just not yet built (no blocker — pure prioritization)

These have no known technical or philosophical obstacle. They weren't built because Phase 7
scoped to Research Agent only; Trading Agent and Portfolio Tracker's own Tier 1/2 items are
still open:

- **Configurable/custom screener criteria (Trading Agent)** — the existing scanner uses fixed
  signals (Volume Displacement, Momentum, Mean Reversion); a user-defined criteria builder is
  buildable on the same data, just not built.
- **Unusual options flow scanner (Trading Agent)** — a dedicated "unusual activity" view distinct
  from the existing GEX/skew signals; those signals already compute most of the needed inputs.
- **Paper/simulated trading** — originally scoped under Trading Agent in the competitive
  analysis. Redirected to Portfolio Tracker per direct instruction; see the scenario-simulation
  plan built in this same session.
- **Dividend tracking (Portfolio Tracker)** — Research Agent's Security Analyst now has a
  dividend growth-trend read (Phase 7), but Portfolio Tracker itself has no dividend-income
  view across actual held positions (yield-on-cost, upcoming ex-dates, income total). Buildable
  from data already fetched (`fetchProfile`, `dividendHistory`) — not yet wired into the
  Dashboard.
- **Tax-lot accounting (Portfolio Tracker)** — `PortfolioHolding` already has `acquiredDate` and
  `costBasisPerShare` per lot; short/long-term gain classification and a realized-gains ledger
  are a natural extension, not yet built.
- **Multi-leg options P&L visualizer (Trading Agent)** — the Options Strategy Guide explains
  strategies conceptually; a payoff-diagram calculator for a specific position isn't built.
- **Community/social feed** — flagged as a broad competitor feature (shared watchlists,
  discussion). No design work has started; would also raise the same multi-user/backend
  questions as the data-sharing goal being scoped now.
- **Multi-currency / crypto holdings in Portfolio Tracker** — the tracker supports equities/
  bonds/commodities/futures-proxies/forex already; crypto as its own asset class isn't wired in.
