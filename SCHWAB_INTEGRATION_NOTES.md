# Schwab Integration — What's Unverified Until Approval Lands

The trading agent (`/trading/options-calculator`, `/trading/pm-volume`) is fully built, type-checked, and verified end-to-end against synthetic data (`SCHWAB_MOCK_MODE=true` in `.env.local` — see "How to re-test with mock data" below). Everything in this file is about the **real Schwab integration specifically**, which could not be live-tested before app approval. None of it blocks using the app once approval completes and `node scripts/schwab-authorize.mjs` has been run — but the first real run should be treated as a verification pass, the same way FMP's actual free-tier limits were only discovered by live probing (see `src/lib/agents/research-agent/skills/sector-fundamentals.ts` for that precedent).

## Checklist — verify these once you have real tokens

1. **OAuth callback URL works as expected.**
   `scripts/schwab-authorize.mjs` uses `https://127.0.0.1` as the redirect URI by default (overridable via `SCHWAB_REDIRECT_URI` in `.env.local`). This must **exactly match** the callback URL you registered in the Schwab developer app. If the script errors immediately or the browser doesn't redirect at all after login, check that these match character-for-character.
   → *How to check:* just run the script. If it fails at the redirect step, fix the mismatch and retry.

2. **Price history endpoint: multi-day minute-bar backfill.**
   `src/lib/data/schwab.ts`'s `fetchMinuteBars` uses `periodType=day, frequencyType=minute` with explicit `startDate`/`endDate` (epoch ms) instead of Schwab's `period` enum (which only accepts 1/2/3/4/5/10 for `periodType=day`). It's unconfirmed whether Schwab's API actually honors an extended date range this way, or silently clamps to a shorter window.
   → *How to check:* call `fetchMinuteBars` for a known symbol with a 6-month range and inspect how many calendar days of candles actually come back vs. how many were requested. `historical-composite.ts` already defaults to a conservative `HISTORICAL_COMPOSITE_LOOKBACK_DAYS = 180` (in `src/lib/agents/trading-agent/constants.ts`) — bump this once you know the real ceiling.

3. **Premarket data actually comes back.**
   `needExtendedHoursData=true` is passed on every price-history request — this is what's supposed to include the 4:00-9:30am ET premarket window. Unconfirmed whether this returns dense minute-by-minute premarket bars or sparse/missing data (premarket liquidity is thin, so even real data may have gaps — that's expected; a total absence of premarket bars would mean this parameter isn't doing what's assumed).
   → *How to check:* pull one day of bars for a liquid ticker (e.g. AAPL) and confirm bars exist with timestamps between 4:00-9:30am ET.

4. **Quote field names.**
   `fetchQuote` in `schwab.ts` reads `data[symbol].quote.lastPrice` and `.totalVolume`. Confirmed from Schwab's documented `fields` parameter (`quote`/`fundamental`/`extended`/`reference`/`regular`) but the exact field names inside the `quote` object weren't verified against a real response.
   → *How to check:* log one raw response from `/quotes` and diff against the assumed shape in `schwab.ts`.

5. **Options chain response shape.**
   `fetchOptionsChain` assumes the TD-Ameritrade-inherited nested shape: `callExpDateMap`/`putExpDateMap` → `"<expiration>:<dte>"` keys → strike-price-string keys → array of contracts, with fields `openInterest`, `totalVolume`, `volatility`, `delta`, `gamma`, `theta`, `vega`, `strikePrice`, `expirationDate`, `daysToExpiration`. This is the highest-risk assumption in the whole integration — it's a distinctive, easy-to-get-wrong structure, and if the field names are off, `flattenExpDateMap` will silently default everything to `0` (defensive by design, so it won't crash — but the UI will show all-zero OI/volume instead of erroring, which is a *quieter* failure mode worth specifically checking for).
   → *How to check:* pull one chain for a liquid ticker/near expiration and confirm real (nonzero) OI and volume numbers show up in the `/trading/pm-volume` page's "Options Chain Snapshot" section.

6. **Rate limits.**
   Documented publicly as ~120 requests/minute for market data, 2-4/sec for trade requests — not tested against this specific app registration. The historical composite alone makes one `/pricehistory` call per invocation (not per-day), so it shouldn't be rate-limit-heavy, but repeated testing across many tickers in a short window could still hit it.
   → *How to check:* watch for HTTP 429s in `schwab.ts`'s thrown errors during initial testing.

7. **Token refresh actually works end-to-end.**
   `src/lib/data/schwab-auth.ts` refreshes the access token ~2 minutes before its 30-minute expiry, and hard-fails with a clear message if the refresh token itself is past Schwab's 7-day limit. The refresh *logic* is written against Schwab's documented OAuth token endpoint but has never actually round-tripped against the real endpoint.
   → *How to check:* after initial auth, leave the app idle for 30+ minutes, then make another request — confirm it refreshes silently instead of erroring.

## How to re-test with mock data anytime

Add `SCHWAB_MOCK_MODE=true` to `.env.local` (any value other than the literal string `"true"` is treated as off). This makes `schwab.ts` return synthetic-but-realistic candles/quotes/chains from `src/lib/data/schwab-mock.ts` instead of calling the real API — no tokens required. Useful for re-verifying UI/logic changes without burning real API calls or waiting on OAuth. Remove the line (or set it to anything else) to go back to real Schwab calls. It's unset by default in `.env.local` right now so real credentials take over automatically once they exist.
