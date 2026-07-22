# Alpaca Integration — What's Unverified Until You Test With Real Keys

The Alpaca client (`src/lib/data/alpaca.ts`) is built directly against Alpaca's current public docs (fetched and read while building this, not recalled from memory) but has **never made a real API call** — no live keys were available while it was written. Everything in this file is what to check the first time real `ALPACA_API_KEY_ID` / `ALPACA_SECRET_KEY` values are in `.env.local`, the same treatment `SCHWAB_INTEGRATION_NOTES.md` gives the Schwab client.

Alpaca is selected automatically once both env vars are set (see `src/lib/data/market-data.ts`'s `getProvider()`), no code change needed. Schwab's code is untouched and still works as a fallback (`MARKET_DATA_PROVIDER=schwab` to force it).

## Checklist — verify these once you have real keys

1. **Basic quote/bar sanity check first.**
   Before trusting anything else, call `fetchQuote("AAPL")` and `fetchDailyBars("AAPL", ...)` for a liquid, well-known ticker and confirm the price/volume numbers are real and roughly match what the actual market is doing that day. This is the cheapest possible check and catches a broken auth header or wrong base URL immediately.
   → *How to check:* hit the Equities dashboard or PM-Volume Tracker for AAPL and eyeball the numbers against a real quote source.

2. **Free-tier REST data has a documented 15-minute delay.**
   Only Alpaca's websocket stream is real-time on the free/Basic plan — REST endpoints (everything this integration uses) lag by ~15 minutes. This matters most for PM-Volume Tracker, which is inherently a "is this happening right now" signal. A 15-minute-old premarket read is still directionally useful, just not instantaneous — worth knowing, not necessarily a blocker.
   → *How to check:* compare a fetched quote's implied timestamp against wall-clock time during market hours.

3. **Premarket (extended-hours) bars actually come back.**
   Alpaca's plan comparison page states extended-hours data is included free, but no explicit "include extended hours" parameter is documented for the bars endpoint the way Schwab requires `needExtendedHoursData=true` — the assumption here is the IEX feed's regular bars endpoint just includes premarket trades since IEX itself trades in that window. Unconfirmed.
   → *How to check:* pull minute bars for a liquid ticker on a day with data and confirm bars exist with timestamps between 4:00-9:30am ET.

4. **Pagination on multi-day minute-bar pulls.**
   `alpaca.ts`'s `fetchBars()` loops on `next_page_token` up to `MAX_PAGES = 20` — untested whether that's enough pages for `HISTORICAL_COMPOSITE_LOOKBACK_DAYS = 180` worth of premarket-window minute bars per symbol, or whether it hits the 200 req/min rate limit before finishing.
   → *How to check:* run the PM-Volume Tracker's historical composite for a ticker and watch for either a truncated result (hit `MAX_PAGES`) or a 429 rate-limit error in the thrown error message.

5. **Options data — the least-certain piece of this whole integration.**
   Three real unknowns stacked together: (a) the exact endpoint path/version (`/v1beta1/options/snapshots/{symbol}`, assumed from search results, not confirmed via a fetched example response), (b) whether OCC-symbol parsing (`parseOccSymbol()` in `alpaca.ts`) correctly extracts strike/expiration/type from real Alpaca-returned keys, (c) whether open interest is available anywhere at all — current code assumes it is **not** and hardcodes it to 0, meaning `putCallOpenInterestRatio` will show as unreliable/zero-skewed even if this endpoint otherwise works.
   → *How to check:* hit the Options dashboard's flow-skew signal (uses `putCallVolumeRatio`, not OI) for a liquid underlying and confirm a real, non-zero, sane put/call volume ratio comes back before trusting anything else here.

6. **Rate limits.**
   Documented as 200 requests/minute on the free tier. The watchlist scan (`scanWatchlist()`) already fires one `fetchDailyBars` call per ticker in parallel via `Promise.all` — fine for a handful of tickers, but the PM-Volume sector/market scan (`pm-volume-scan.ts`) can fan out to ~34 tickers at once, each potentially needing multiple paginated calls if it also pulls minute bars. Watch for 429s specifically during a full market scan.
   → *How to check:* run "Scan Market (all sectors)" and check for rate-limit errors in the per-ticker `error` fields of the result.

7. **Symbol coverage gap — Currency and Futures stay unverified/mocked.**
   This integration only wires up Alpaca's stock/ETF endpoints. It does **not** attempt real forex-pair data (e.g. "EUR/USD") or futures data (e.g. "/ES") — Alpaca's coverage for true forex/futures wasn't confirmed during this build and was explicitly scoped out. Currency and Futures dashboards continue on `SCHWAB_MOCK_MODE=true`/`MARKET_DATA_MOCK_MODE=true` synthetic data regardless of which provider is otherwise active. Commodity/bond **ETF tickers** (GLD, USO, TLT, IEF, HYG, etc.) work fine through the stock endpoints since they trade as regular equities.

## How to re-test with mock data anytime

Same mechanism as before, plus a new neutral flag name: set `MARKET_DATA_MOCK_MODE=true` (or the original `SCHWAB_MOCK_MODE=true`, still honored) in `.env.local` to force synthetic data regardless of which provider would otherwise be active — no real keys of any kind required. Useful for re-verifying UI/logic changes without burning real API calls.
