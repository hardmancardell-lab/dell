// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/market-data-quote-contract.test.mts
// Contract: a missing price is an error (NoPriceError), never the number 0, and the consumers do not act on it.
// Fake fetch only; no network, no real key.
import { setFakeEnv, install, json, makeT, attempt, calls } from "./fixtures/fake-fetch.mts";
import * as alpaca from "../src/lib/data/alpaca.ts";
import * as oanda from "../src/lib/data/oanda.ts";
import * as coinbase from "../src/lib/data/coinbase.ts";
import * as md from "../src/lib/data/market-data.ts";
import { isNoPriceError } from "../src/lib/data/market-data-types.ts";
import { evaluateAlertRule } from "../src/lib/agents/trading-agent/skills/alert-conditions.ts";
import { valuatePortfolio } from "../src/lib/agents/trading-agent/skills/portfolio-valuation.ts";

const { t, summary } = makeT();
setFakeEnv();

// ---- Alpaca fetchQuote
for (const [label, body] of [
  ["{}", {}],
  ["null trade", { latestTrade: null }],
  ["price 0", { latestTrade: { p: 0 } }],
  ["price -4", { latestTrade: { p: -4 } }],
  ["price NaN string", { latestTrade: { p: "abc" } }],
]) {
  install(() => json(body));
  const r = await attempt(() => alpaca.fetchQuote("AAPL"));
  t(`alpaca fetchQuote(${label}) throws NoPriceError, not 0`, r.threw && isNoPriceError(r.error), r.threw ? String(r.error?.message) : JSON.stringify(r.value));
}
{
  const nowIso = new Date(Date.now() - 5_000).toISOString();
  install(() => json({ latestTrade: { p: 189.5, t: nowIso }, dailyBar: { v: 1234 } }));
  const q = await alpaca.fetchQuote(" aapl ");
  t("alpaca quote: price, feed, asOf from latestTrade.t, not delayed when fresh", q.lastPrice === 189.5 && q.feed === "iex" && q.asOf === Date.parse(nowIso) && q.delayed === false, JSON.stringify(q));
  t("alpaca quote: symbol trimmed and uppercased in the URL", calls[0].url.includes("/stocks/AAPL/snapshot"), calls[0].url);
  const old = new Date(Date.now() - 6 * 3600_000).toISOString();
  install(() => json({ latestTrade: { p: 10, t: old } }));
  const q2 = await alpaca.fetchQuote("AAPL");
  t("alpaca quote: a 6-hour-old trade is flagged delayed", q2.delayed === true && q2.asOf === Date.parse(old));
}

// ---- OANDA fetchQuote
install(() => json({ candles: [] }));
{
  const r = await attempt(() => oanda.fetchQuote("EUR/USD"));
  t("oanda fetchQuote with no candles (weekend) throws NoPriceError", r.threw && isNoPriceError(r.error), r.threw ? String(r.error?.message) : JSON.stringify(r.value));
}
install(() => json({ candles: [{ time: new Date(Date.now() - 60_000).toISOString(), volume: 3, complete: true }] }));
{
  const r = await attempt(() => oanda.fetchQuote("EUR/USD"));
  t("oanda candle with no mid price throws NoPriceError", r.threw && isNoPriceError(r.error));
}
{
  const ct = new Date(Date.now() - 90_000).toISOString();
  install(() => json({ candles: [{ time: ct, volume: 7, complete: true, mid: { o: "1.0800", h: "1.0810", l: "1.0795", c: "1.0805" } }] }));
  const q = await oanda.fetchQuote("eur/usd");
  t("oanda quote: close price, asOf = candle open + 1 minute, feed", q.lastPrice === 1.0805 && q.asOf === Date.parse(ct) + 60_000 && q.feed === "oanda-m1-close", JSON.stringify(q));
}

// ---- Coinbase fetchQuote
install(() => json({ price: "0", time: "2026-10-14T10:00:00Z" }));
{
  const r = await attempt(() => coinbase.fetchQuote("BTC-USD"));
  t("coinbase fetchQuote price 0 throws NoPriceError", r.threw && isNoPriceError(r.error));
}
{
  const ct = new Date(Date.now() - 2_000).toISOString();
  install(() => json({ price: "65000.5", volume: "12", time: ct }));
  const q = await coinbase.fetchQuote("BTC-USD");
  t("coinbase quote: asOf from ticker time, feed coinbase, not delayed", q.lastPrice === 65000.5 && q.asOf === Date.parse(ct) && q.feed === "coinbase" && q.delayed === false);
}

// ---- market-data entry point
install(() => json({}));
{
  const r = await attempt(() => md.fetchQuote("AAPL"));
  t("market-data fetchQuote propagates NoPriceError", r.threw && isNoPriceError(r.error));
}

// ---- alert-conditions: a missing price must never fire price_threshold
install(() => json({}));
{
  const rule = { id: "1", ticker: "AAPL", assetClass: "equity", conditionType: "price_threshold", params: { targetPrice: 150, direction: "below" } };
  const r = await evaluateAlertRule(rule);
  t("price_threshold below 150 with NO price does not trigger", r.triggered === false && /unavailable/i.test(r.message), JSON.stringify(r));
}
install(() => json({ candles: [] }));
{
  const rule = { id: "2", ticker: "EUR/USD", assetClass: "forex", conditionType: "price_threshold", params: { targetPrice: 1.05, direction: "below" } };
  const r = await evaluateAlertRule(rule);
  t("forex price_threshold on a weekend (no candles) does not trigger", r.triggered === false);
}
install(() => json({ latestTrade: { p: 140, t: new Date().toISOString() } }));
{
  const rule = { id: "3", ticker: "AAPL", assetClass: "equity", conditionType: "price_threshold", params: { targetPrice: 150, direction: "below" } };
  const r = await evaluateAlertRule(rule);
  t("price_threshold still fires on a real price below target", r.triggered === true && /140/.test(r.message), JSON.stringify(r));
}

// ---- portfolio valuation: an unpriced holding is excluded from totals and flagged, never -100%
{
  const h = (symbol, shares, cost) => ({ id: symbol, symbol, assetClass: "equity", shares, costBasisPerShare: cost, acquiredDate: "2025-01-02" });
  install((url) => {
    if (url.includes("/stocks/BAD/")) return json({});
    if (url.includes("/stocks/OK1/")) return json({ latestTrade: { p: 110, t: new Date().toISOString() } });
    if (url.includes("/stocks/OK2/")) return json({ latestTrade: { p: 55, t: new Date().toISOString() } });
    return json({}, 404);
  });
  const s = await valuatePortfolio([h("OK1", 10, 100), h("OK2", 10, 50), h("BAD", 10, 200)]);
  t("valuation: unpriced holding excluded, total P/L = +150 (not -1850)", Math.abs(s.totalUnrealizedPL - 150) < 1e-9, String(s.totalUnrealizedPL));
  t("valuation: totals cover priced holdings only", s.totalValue === 1650 && s.totalCostBasis === 1500, `${s.totalValue} ${s.totalCostBasis}`);
  const bad = s.valuations.find((v) => v.holding.symbol === "BAD");
  t("valuation: unpriced row flagged, price null, message says unavailable, no -100%", bad.priceUnavailable === true && bad.currentPrice === null && bad.unrealizedPLPercent === null && /unavailable/i.test(bad.error));
  t("valuation: summary carries the unpriced count and cost", s.unpricedCount === 1 && s.unpricedCostBasis === 2000);
  t("valuation: limitations mention the exclusion", s.dataLimitations.some((x) => /EXCLUDED/.test(x)));
}

summary();
