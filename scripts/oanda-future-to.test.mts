// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/oanda-future-to.test.mts
// Regression test (2026-10-21): every forex chart failed in production because snapWindow rounds the request END up to the next cache bucket,
// so OANDA was asked for a `to` in the future and answered 400 "Invalid value specified for 'to'. Time is in the future".
// The OANDA functions must never send a `to` later than now, and must keep the URL identical for calls inside one cache bucket.
// Fake fetch and fake keys only; no network.
import { setFakeEnv, install, json, calls } from "./fixtures/fake-fetch.mts";
import * as oanda from "../src/lib/data/oanda.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };

setFakeEnv();
const toOf = (url: string) => Date.parse(new URL(url).searchParams.get("to") ?? "");
const emptyOanda = () => json({ instrument: "EUR_USD", granularity: "M5", candles: [] });

for (const revalidate of [15, 60, 300, 1800, 3600]) {
  install(() => emptyOanda());
  const now = Date.now();
  await oanda.fetchBarsForTimeframeDetailed("EUR/USD", "5Min", now - 3 * 3600_000, now, revalidate);
  const tos = calls.map((c) => toOf(c.url));
  t(`candles: no 'to' is in the future (revalidate ${revalidate}s)`, tos.length > 0 && tos.every((x) => Number.isFinite(x) && x <= Date.now()), JSON.stringify(tos.map((x) => x - Date.now())));
}

// Every window the app really uses: end = now, and end a little past now.
install(() => emptyOanda());
const n0 = Date.now();
await oanda.fetchBarsForTimeframeDetailed("EUR/USD", "1Min", n0 - 600_000, n0 + 600_000, 60);
t("candles: an end past now is capped, never sent", calls.every((c) => toOf(c.url) <= Date.now()), String(calls.map((c) => toOf(c.url) - Date.now())));

// Bid/ask used by paper-order fills for forex.
install(() => json({ instrument: "EUR_USD", granularity: "M1", candles: [] }));
await oanda.fetchLatestBidAsk("EUR/USD");
t("latest bid/ask: 'to' is not in the future", calls.length === 1 && toOf(calls[0].url) <= Date.now(), JSON.stringify(calls.map((c) => c.url.slice(-80))));

// Cache-key stability: two calls inside one bucket build the identical URL.
install(() => emptyOanda());
const now2 = Date.now();
await oanda.fetchBarsForTimeframeDetailed("EUR/USD", "5Min", now2 - 7200_000, now2, 1800);
const u1 = calls.map((c) => c.url).join("|");
install(() => emptyOanda());
await oanda.fetchBarsForTimeframeDetailed("EUR/USD", "5Min", now2 - 7200_000 + 40, now2 + 40, 1800);
const u2 = calls.map((c) => c.url).join("|");
t("candles: calls inside one cache bucket still build the identical URL", u1 === u2 && u1.length > 0, `${u1.slice(-90)} vs ${u2.slice(-90)}`);

// An empty window (end at or before the start of the current bucket) sends nothing instead of an invalid range.
install(() => emptyOanda());
const nowF = Date.now();
const r = await oanda.fetchBarsForTimeframeDetailed("EUR/USD", "5Min", nowF + 5_000, nowF + 10_000, 1800);
t("candles: a window entirely in the future sends no request and returns no candles", calls.length === 0 && r.candles.length === 0, String(calls.length));

console.log(`\n${passed} passed, ${bad} failed`);
if (bad) process.exit(1);
