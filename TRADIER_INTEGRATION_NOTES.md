# Tradier Integration — Verified Live This Session

The Tradier client (`src/lib/data/tradier.ts`) was built directly against Tradier's current public docs, then **verified live** once the account cleared and both a production and a sandbox API key were provided. Same treatment `SCHWAB_/ALPACA_/OANDA_INTEGRATION_NOTES.md` give those clients — this file now records what was actually confirmed.

Tradier is used for exactly one thing in this app: options-chain data (`market-data.ts`'s `fetchOptionsChain` prefers it over Alpaca/Schwab whenever `TRADIER_ACCESS_TOKEN` is set — see that file). Stocks/bars/quotes stay on Alpaca, unchanged.

## Sandbox vs. production — both keys tested, sandbox chosen

Tradier issues separate keys for `api.tradier.com` (production) and `sandbox.tradier.com` (sandbox) — each key only authenticates against its own base URL (confirmed: cross-testing both keys against both URLs gave a clean 200/401/401/200 pattern). Critically, **sandbox market data is real, not simulated** — a live AAPL expirations pull returned byte-identical results from both the sandbox and production endpoints, and a real chain pull through sandbox showed genuine non-zero open interest (105, 458 on real contracts) and real Greeks. Only Tradier's account/trading endpoints are paper in sandbox; market data isn't. Given this app is read-only with no order-execution code anywhere, the sandbox key is the lower-stakes choice and what's actually wired in (`BASE_URL = "https://sandbox.tradier.com/v1"`). The production key is kept in `.env.local` as `TRADIER_ACCESS_TOKEN_PRODUCTION_UNUSED` in case it's ever needed, but nothing references it.

## Production mode: exists only for the option-flow logger

`tradier.ts` can also talk to `https://api.tradier.com/v1` (real-time for brokerage account holders), but only when a caller passes `feed: "production"`. The only caller that does is the intraday option-flow logger (`/api/cron/option-flow`), and only when `OPTION_FLOW_TRADIER_MODE=production` and `TRADIER_PRODUCTION_TOKEN` are both set. Why: the logger records five-minute snapshots next to a real-time spot price, and sandbox option data is delayed about 15 minutes, which misaligns the two and would make any live alert late. Details, the fail-loudly rules, how to switch and how to verify the feed (`quote_lag_seconds`) are in `OPTION_FLOW_LOG_NOTES.md`, section "Data feed".

What stays on the sandbox, unchanged: the GEX signal, the Gamma Heat Map, the options dashboard and expirations route, the strategy features, the VWAP band study, and the logger itself unless production is switched on. The 15-minute delay noted below therefore still applies to all of those. I found no strong reason to move any of them: they are interactive, not time-aligned to a five-minute log, and the sandbox token is the lower-stakes choice for a read-only app. That is a decision for the user, not made here.

Other facts: production uses a separate env var, `TRADIER_PRODUCTION_TOKEN`, with no fallback in either direction (the sandbox token is never sent to production or the reverse). It is not the `.env.local` key named `TRADIER_ACCESS_TOKEN_PRODUCTION_UNUSED`, which nothing reads; add `TRADIER_PRODUCTION_TOKEN` to Vercel (and to `.env.local` only if you want to try production locally). The client allows exactly two paths, `/markets/options/expirations` and `/markets/options/chains`, so account, order and watchlist endpoints cannot be requested by this app in either mode. Each option in a chain response may carry `trade_date`, `bid_date` and `ask_date` (epoch milliseconds, per Tradier's chain documentation); the client reads them as `quoteTimeMs` for the lag figure. **Not yet verified against a live response**; the first logger run will show it (`quote_lag_seconds` is null if the fields are absent).

## Confirmed live this session

1. **Expirations list.** `getExpirations("AAPL")` returns a real, sorted list of 24 future dates (2026-07-17 through 2028-12-15 at the time of testing).

2. **Response field names — all confirmed exactly as assumed.** A real chain pull showed `strike`, `open_interest` (real values like 105, 458 — not zero), `volume`, `bid`, `ask`, `last`, `expiration_date`, `option_type` (`"call"`/`"put"`), and `greeks.{delta,gamma,theta,vega,mid_iv}` all present with sane values. No field-name mismatches — `tradier.ts`'s original assumptions, based on docs alone, were correct.

## Still worth checking

1. **The single-contract response quirk.**
   Tradier is documented to return a single object (not a one-element array) for `options.option` when only one contract matches. `tradier.ts`'s `Array.isArray(...) ? ... : [...]` normalization handles this — but hasn't been exercised against a real single-contract response.
   → *How to check:* request a chain filtered tightly enough to return exactly one contract and confirm it doesn't get silently dropped.

2. **GEX math sanity check.**
   Before fully trusting a real signal, sanity-check the output against `signal_engine.py`'s own self-test shape (regime, gamma flip, call/put walls, quadrant label — see `METRICS_REPORT.md` in the earlier handoff package for the exact reference numbers from synthetic data). The TypeScript port in `gex-signal.ts` was cross-checked against that self-test during development; a real chain should produce *plausible* numbers of a similar shape (a gamma flip somewhere near the current spot price, walls at round-ish strikes with real open interest), not necessarily the same values.
   → *How to check:* pick a liquid, well-known underlying (e.g. SPY or AAPL) and eyeball whether the gamma flip level and walls look like something a real options desk would recognize, not obviously broken (e.g. a gamma flip 10x the spot price).

3. **Term structure needs two expirations.**
   `computeGexSignal` picks the two nearest future expirations as "near" and "far." If an underlying only has one expiration listed (unusual, but possible for thinly-traded names), the term structure signal is skipped and flagged in `dataLimitations` rather than guessed.

4. **15-minute delay, same as Alpaca's REST tier.**
   Tradier's sandbox data is delayed the industry-standard 15 minutes — consistent with the rest of this app's REST-based (not websocket) data, so no new tradeoff versus what's already true for stock quotes.

5. **Rate limits.**
   Not yet confirmed for the sandbox tier specifically. The GEX check fires up to 2 chain requests + 1 expirations request per underlying per check (near chain, far chain, expirations list) — watch for 429s if checking many watchlisted underlyings back-to-back.
   → *How to check:* watch the `dataLimitations`/error fields when running the GEX check across a multi-symbol Options watchlist.

## Forward paper-backtest log

`gex-paper-backtest-log.json` (project root, gitignored) accumulates one row per (underlying, expiration) the first time the GEX check runs for it — see `src/lib/agents/trading-agent/skills/paper-backtest-log.ts`. Realized Mon-Fri returns backfill automatically from real Alpaca daily bars once each expiration week has passed. The row schema matches `options-signals-project/backtest_engine.py`'s expected input exactly, so that already-validated statistics engine (not a TypeScript reimplementation) is what should actually run the significance testing once enough rows have accumulated — copy the JSON from the Paper Backtest Log tab and feed it to `backtest_engine.py`.

This log starts empty and only grows from real, forward-looking checks from whatever date this feature is first used — it does not and cannot backfill history, for the exact reason this integration exists (see the project's earlier scoping discussion: real historical open interest isn't available for free anywhere that was found).
