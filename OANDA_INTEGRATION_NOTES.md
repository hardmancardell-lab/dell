# OANDA Integration — Verified Live This Session

The OANDA client (`src/lib/data/oanda.ts`) was built against OANDA's v20 REST API docs, then **verified live** once the user's token arrived. Most of what follows below used to be "unverified until tested" (same treatment `SCHWAB_/ALPACA_/TRADIER_INTEGRATION_NOTES.md` give those clients) — this file now records what was actually confirmed, plus what's still worth rechecking.

OANDA is used for exactly one thing in this app: forex data. `market-data.ts` routes any `"EUR/USD"`-shaped symbol to OANDA whenever `OANDA_API_TOKEN` is set (checked before the generic Alpaca/Schwab branch, same precedent as Tradier's options-chain carve-out) — stocks/options stay on Alpaca/Tradier, unchanged.

## Important: this is a LIVE account, not practice

The user's token is a **live-account token**, confirmed by direct testing: the same token returned `401 Insufficient authorization` against `api-fxpractice.oanda.com` and `200 OK` with real data against `api-fxtrade.oanda.com`. `oanda.ts`'s `BASE_URL` was updated accordingly and the user explicitly confirmed this is fine. **This app has zero order-placement code anywhere** — every function in `oanda.ts` is a read-only GET against instrument/candle data, and it must stay that way. Do not add any trade-execution capability against this base URL without a fresh, explicit safety conversation — it is a real-money account.

## Confirmed live this session

1. **Base URL and auth work.** `Authorization: Bearer <token>` against `https://api-fxtrade.oanda.com` returns real data.
2. **Response shape matches what the code assumed** — confirmed via a direct test call: `{"instrument":"EUR_USD","granularity":"D","candles":[{"complete":true,"volume":127015,"time":"2026-07-12T21:00:00.000000000Z","mid":{"o":"1.14018","h":"1.14458","l":"1.13775","c":"1.13804"}}, ...]}`. OHLC really is returned as strings (`parseFloat`'d correctly in `toCandle()`), `complete`/`volume`/`time`/`mid` field names are all exactly right. No code changes were needed here — the docs-based assumptions were correct.
3. **Instrument-format conversion works.** `EUR/USD` → `EUR_USD` round-tripped correctly against the real API.
4. **Prices are real and sane.** EUR/USD ≈ 1.138 on the date tested — a plausible real exchange rate, not a placeholder.

## Still worth checking

1. **`fetchQuote`'s "last candle close" approximation.** No separate real-time pricing call is made — `fetchQuote` pulls the most recent 1-minute candle and uses its close as "the price." Worth checking whether this lags noticeably behind the true current price during fast-moving markets — if so, OANDA's account-scoped pricing endpoint (`/v3/accounts/{accountID}/pricing`) would be the fix, at the cost of needing to also store an account ID.

2. **Volume is a tick count, not traded volume.** Confirmed present in the response (`"volume":127015`), but forex is OTC/decentralized — there's no consolidated tape, so this counts price updates within the candle, not shares/contracts traded. Volume Displacement on a forex pair reflects a burst of *quote activity*, not literal traded volume the way it does for equities.

3. **Sub-minute granularity exists but isn't used yet.** OANDA supports `S5`/`S10`/`S15`/`S30` (5/10/15/30-second candles) — finer than the 1-minute floor this app currently uses everywhere (`GRANULARITY_MAP` in `oanda.ts` doesn't include them). A real opportunity to close part of the "no tick data" gap for forex specifically, deliberately deferred rather than retrofitting `PriceChart`'s shared timeframe presets — not built in this phase.

4. **Rate limits.** Not yet stress-tested. The Live Rates section polls all 10 pairs every 15 seconds (10 requests per poll cycle) — watch for 429s or throttling during extended use.
   → *How to check:* leave the Currency dashboard open for a few minutes and watch for errors appearing in the Live Rates grid.

5. **Only fully-closed candles are returned.** `fetchBarsForTimeframe` filters to `complete: true` candles, dropping the in-progress "current" candle (confirmed the response does include a `complete: false` in-progress candle as its last entry, correctly filtered out) — deliberate, means the very latest partial period never shows up in charts.

## How to re-test with mock data anytime

Same mechanism as every other provider: set `MARKET_DATA_MOCK_MODE=true` (or the original `SCHWAB_MOCK_MODE=true`) in `.env.local` to force synthetic data regardless of which real provider would otherwise be active — no OANDA token required.
