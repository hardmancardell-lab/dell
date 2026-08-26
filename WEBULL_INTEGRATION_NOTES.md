# Webull OpenAPI Integration — Status

## What this is for

Webull's OpenAPI is a market-data + trading API (quotes, historical bars, real-time streaming) — **not** a news source. It cannot replace GDELT (see the separate GDELT reliability fix in `geopolitical-news.ts`). The real motivation: Alpaca's free tier only supplies IEX-only data (single exchange, weakest in premarket, already flagged as a real limitation elsewhere in this app). If Webull's entitlements give better data quality, it's a genuine upgrade to `market-data.ts`'s equities path — just not a fix for the news problem.

## One-time setup

1. Get your App Key + App Secret from Webull: **OpenAPI Management > App Management** on webull.com.
2. Add to `.env.local`:
   ```
   WEBULL_APP_KEY=
   WEBULL_APP_SECRET=
   ```
3. Add the same two to Vercel's env vars (Production + Preview) once verified locally.
4. Hit `GET /api/webull-quote-test?symbol=AAPL` and confirm you get back a real, sane price — this is the first live test of the whole integration.

## What's confirmed vs. unverified

**Confirmed** (verified against Webull's own published test vector, not guessed):
- The HMAC-SHA1 signing algorithm in `src/lib/data/webull.ts`'s `signRequest()`. Reproduces Webull's documented worked example signature (`kvlS6opdZDhEBo5jq40nHYXaLvM=`) byte-for-byte from their published app_secret/path/params/headers/body.
- The quote-snapshot endpoint path: `/openapi/market-data/stock/snapshot` — this exact path is shown as a live example in Webull's own Market Data API overview docs.

**Unverified — needs a real key to confirm:**
- The exact response field names for the snapshot endpoint (`fetchQuote` guesses `price`/`last_price` and `volume`/`total_volume` — check the real JSON shape and simplify once confirmed).
- The historical-bars endpoint path entirely. Webull's docs site is JS-rendered and didn't yield a concrete example path or response shape for `history_bar` beyond a placeholder (`/path/to/history_bar`) in one doc page. `fetchDailyBars`/`fetchMinuteBars` in `webull.ts` extrapolate a path following the confirmed snapshot endpoint's `/openapi/market-data/stock/` prefix — this is a best-effort guess, not confirmed, and is very likely to need correction once tested against a real response.
- Whether your specific App Key actually has live market-data entitlements (Nasdaq Basic/Level 1 for stocks/ETFs per Webull's docs) or will only get 15-minute-delayed sandbox data — this determines whether it's actually an upgrade over Alpaca's free tier at all.
- Real request-limit behavior (not yet observed live).

## Not yet wired into `market-data.ts`

`webull.ts` is a standalone client, not yet plugged into the app's provider-selection logic (`getProvider()` in `market-data.ts`) — deliberately, until the quote/bars shapes above are confirmed live. Once verified, wiring it in as an opt-in `MARKET_DATA_PROVIDER=webull` value (matching the existing `alpaca`/`schwab` pattern) is a small, low-risk follow-up.
