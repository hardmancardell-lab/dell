// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/market-data-chaos.test.mts
// Regression test for the provider chaos table (audit 05-market-data.md): timeouts, 429/5xx retry with Retry-After,
// candle validation, pagination truncation, cache-key stability, symbol routing, strict Tradier parsing, mock guard.
// Fake fetch and fake keys only; no network.
import { setFakeEnv, install, json, hang, HTML502, makeT, attempt, calls, bar } from "./fixtures/fake-fetch.mts";
import * as alpaca from "../src/lib/data/alpaca.ts";
import * as oanda from "../src/lib/data/oanda.ts";
import * as coinbase from "../src/lib/data/coinbase.ts";
import * as tradier from "../src/lib/data/tradier.ts";
import * as fred from "../src/lib/data/fred.ts";
import * as md from "../src/lib/data/market-data.ts";
import { setProviderSleep, setProviderTimeoutMs, snapWindow, cleanCandles, parseRetryAfterMs } from "../src/lib/data/provider-http.ts";

const { t, summary } = makeT();
setFakeEnv();
const sleeps: number[] = [];
setProviderSleep(async (ms) => {
  sleeps.push(ms);
});
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 14, 14, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------- timeouts: a client that never answers rejects, with the provider named
setProviderTimeoutMs(60);
{
  const cases: [string, () => Promise<unknown>][] = [
    ["alpaca bars", () => alpaca.fetchDailyBars("AAPL", T0 - 5 * 86400000, T0, 1800)],
    ["alpaca quote", () => alpaca.fetchQuote("AAPL")],
    ["alpaca options", () => alpaca.fetchOptionsChain("AAPL")],
    ["oanda bars", () => oanda.fetchDailyBars("EUR/USD", T0 - 5 * 86400000, T0, 1800)],
    ["oanda quote", () => oanda.fetchQuote("EUR/USD")],
    ["coinbase bars", () => coinbase.fetchDailyBars("BTC-USD", T0 - 5 * 86400000, T0, 1800)],
    ["coinbase quote", () => coinbase.fetchQuote("BTC-USD")],
    ["tradier expirations", () => tradier.getExpirations("AAPL")],
    ["fred", () => fred.fetchFredSeries("DGS3MO", 3)],
  ];
  for (const [name, fn] of cases) {
    install(() => hang());
    const started = Date.now();
    const r = await attempt(fn);
    const ms = Date.now() - started;
    t(`timeout: ${name} rejects instead of hanging, naming the provider`, r.threw && /timed out/i.test(String(r.error?.message)) && ms < 2500, r.threw ? `${r.error?.message} ${ms}ms` : "returned");
  }
}
setProviderTimeoutMs(undefined);

// ---------------------------------------------------------------- 429 / 5xx: retry with backoff, Retry-After honoured, at most 2 retries
{
  sleeps.length = 0;
  install((url, init, n) => (n < 3 ? json("busy", 429, { "retry-after": "2" }) : json({ latestTrade: { p: 50, t: iso(Date.now()) } })));
  const q = await alpaca.fetchQuote("AAPL");
  t("429 with Retry-After: waits at least 2 s, retries, then succeeds (3 calls)", q.lastPrice === 50 && calls.length === 3 && sleeps.length === 2 && sleeps.every((s) => s >= 2000), JSON.stringify({ calls: calls.length, sleeps }));
}
{
  sleeps.length = 0;
  install(() => json("down", 503));
  const r = await attempt(() => alpaca.fetchQuote("AAPL"));
  t("5xx forever: gives up after 3 attempts total (2 retries) with an error naming Alpaca and 503", r.threw && calls.length === 3 && /Alpaca/.test(r.error.message) && /503/.test(r.error.message), r.threw ? r.error.message : "");
}
{
  sleeps.length = 0;
  install(() => json("slow down", 429, { "retry-after": "3600" }));
  const r = await attempt(() => alpaca.fetchQuote("AAPL"));
  t("Retry-After far beyond the budget is not waited out: one call, clear 429 error", r.threw && calls.length === 1 && /429/.test(r.error.message) && sleeps.length === 0, r.threw ? `${calls.length} ${r.error.message}` : "");
}
{
  install(() => json({ error: "no" }, 404));
  const r = await attempt(() => alpaca.fetchQuote("AAPL"));
  t("a 404 is not retried", r.threw && calls.length === 1);
}
{
  install(() => json(HTML502, 502));
  setProviderSleep(async () => {});
  const r = await attempt(() => alpaca.fetchDailyBars("AAPL", T0 - 86400000, T0, 1800));
  t("an HTML 502 page is cut to 160 characters in the message", r.threw && r.error.message.length < 320, r.threw ? String(r.error.message.length) : "");
  setProviderSleep(async (ms) => {
    sleeps.push(ms);
  });
}
t("parseRetryAfterMs: seconds, HTTP date, garbage", parseRetryAfterMs("5") === 5000 && parseRetryAfterMs("abc") === null && parseRetryAfterMs(null) === null && parseRetryAfterMs(new Date(1_000_000 + 4000).toUTCString(), 1_000_000) !== null);

// ---------------------------------------------------------------- malformed bodies name the provider (no bare SyntaxError / TypeError)
for (const [label, body] of [["HTML 200", "<html>oops</html>"], ["truncated JSON", '{"bars": [{"t":']]) {
  install(() => new Response(body, { status: 200 }));
  const r = await attempt(() => alpaca.fetchDailyBars("AAPL", T0 - 86400000, T0, 1800));
  t(`malformed body (${label}) gives a provider-named error`, r.threw && r.error?.name !== "SyntaxError" && /Alpaca/.test(String(r.error.message)), r.threw ? `${r.error?.name} ${r.error?.message}` : "returned");
}
{
  install(() => new Response("null", { status: 200 }));
  const r = await attempt(() => oanda.fetchDailyBars("EUR/USD", T0 - 86400000, T0, 1800));
  t("null body gives a provider-named error, not TypeError", r.threw && r.error?.name !== "TypeError");
}
{
  install(() => json({}));
  const r = await attempt(() => fred.fetchFredSeries("DGS3MO", 3));
  t("FRED 200 without observations gives a clear error, not TypeError", r.threw && r.error?.name !== "TypeError" && /FRED/.test(r.error.message));
  install(() => json({ observations: [{ date: "2026-10-01", value: "NaN" }, { date: "2026-10-02", value: "abc" }, { date: "2026-10-03", value: "." }, { date: "2026-10-04", value: "4.2" }] }));
  const obs = await fred.fetchFredSeries("DGS3MO", 4);
  t("FRED non-numeric values become null, never NaN", obs.filter((o) => o.value !== null).length === 1 && obs.every((o) => o.value === null || Number.isFinite(o.value)));
}

// ---------------------------------------------------------------- candle validation
{
  const bars = [
    bar(iso(T0 + 3 * 86400000), 10, 11, 9, 10),
    bar(iso(T0 + 1 * 86400000), 10, 11, 9, 10),
    bar(iso(T0 + 1 * 86400000), 10, 11, 9, 10), // duplicate timestamp
    { t: iso(T0 + 2 * 86400000), o: "NaN", h: 1, l: 1, c: 1, v: 1 }, // NaN open
    { t: iso(T0 + 4 * 86400000) }, // missing fields
    bar(iso(T0 + 5 * 86400000), -3, -2, -4, -3), // negative prices
    bar(iso(T0 + 6 * 86400000), 0, 0, 0, 0), // zero prices
    bar(iso(T0 + 7 * 86400000), 10, 8, 9, 9), // high < low
    { t: "not-a-date", o: 1, h: 2, l: 1, c: 1, v: 1 },
    bar(iso(T0 + 8 * 86400000), 10, 11, 9, 10, 0), // zero volume is legal
  ];
  install(() => json({ bars, next_page_token: null }));
  const r = await alpaca.fetchBarsForTimeframeDetailed("AAPL", "1Day", T0, T0 + 9 * 86400000, 1800);
  const times = r.candles.map((c) => c.datetime);
  t("alpaca candles: sorted ascending, only the 3 valid bars kept (zero volume allowed)", r.candles.length === 3 && times.every((x, i) => i === 0 || x > times[i - 1]), String(r.candles.length));
  t("alpaca candles: report counts 6 invalid and 1 duplicate dropped, with a warning", r.report.droppedInvalid === 6 && r.report.droppedDuplicate === 1 && r.report.warnings.length === 2, JSON.stringify(r.report));
  t("alpaca candles carry the feed name", r.candles.every((c) => c.feed === "iex"));
}
{
  install(() => json({ candles: [
    { time: iso(T0 + 120000), volume: 1, complete: true, mid: { o: "1.1", h: "1.2", l: "1.0", c: "1.1" } },
    { time: iso(T0), volume: 1, complete: true, mid: { o: "1.1", h: "1.2", l: "1.0", c: "1.1" } },
    { time: iso(T0), volume: 1, complete: true, mid: { o: "1.1", h: "1.2", l: "1.0", c: "1.1" } },
    { time: iso(T0 + 60000), volume: 1, complete: true }, // no mid: used to become 0
    { time: iso(T0 + 180000), volume: 1, complete: false, mid: { o: "1", h: "1", l: "1", c: "1" } },
  ] }));
  const r = await oanda.fetchBarsForTimeframeDetailed("EUR/USD", "1Min", T0, T0 + 600000, 1800);
  t("oanda candles: unsorted/duplicate/no-mid/incomplete cleaned, never a zero price", r.candles.length === 2 && r.candles.every((c) => c.close > 0) && r.candles[0].datetime < r.candles[1].datetime && r.report.droppedInvalid === 1 && r.report.droppedDuplicate === 1, JSON.stringify(r.report));
}
{
  const { candles, report } = cleanCandles([{ datetime: 1, open: 1, high: 2, low: 1, close: 1.5, volume: 1 }, { datetime: 1, open: 1, high: 2, low: 1, close: 1.5, volume: 1 }], "x");
  t("cleanCandles duplicate handling", candles.length === 1 && report.droppedDuplicate === 1);
}
t("coinbase parseCandles drops negative and zero prices", coinbase.parseCandles([[1791936000, 1, 2, 1.5, 1.6, 10], [1791849600, -3, 2, 1, -3, 10], [1791763200, 0, 0, 0, 0, 1]]).length === 1);

// ---------------------------------------------------------------- Alpaca pagination: the cap is raised, truncation is reported, the newest bars are kept
{
  let page = 0;
  install(() => {
    page += 1;
    // newest-first (sort=desc): page 1 holds the newest bars
    const base = T0 - page * 2 * 86400000;
    return json({ bars: [bar(iso(base + 86400000)), bar(iso(base))], next_page_token: "more" });
  });
  const r = await alpaca.fetchBarsForTimeframeDetailed("AAPL", "1Day", T0 - 400 * 86400000, T0, 1800);
  t("pagination: requests newest-first (sort=desc)", /sort=desc/.test(calls[0].url));
  t("pagination: an endless page token stops at the cap and is flagged truncated with a warning", r.report.truncated === true && r.report.warnings.some((w) => /stopped after/.test(w)) && calls.length === alpaca.ALPACA_MAX_PAGES && calls.length > 20, `${calls.length}`);
  t("pagination: the newest bar of the range is kept", Math.max(...r.candles.map((c) => c.datetime)) === T0 - 2 * 86400000 + 86400000);
}
{
  let page = 0;
  install(() => {
    page += 1;
    return json({ bars: [bar(iso(T0 - page * 86400000))], next_page_token: page < 25 ? "next" : null });
  });
  const r = await alpaca.fetchBarsForTimeframeDetailed("AAPL", "1Day", T0 - 400 * 86400000, T0, 1800);
  t("pagination: 25 real pages are all followed (old cap was 20), not truncated", r.candles.length === 25 && r.report.truncated === false);
}
{
  let page = 0;
  install((url) => {
    page += 1;
    const snaps = { [`AAPL  261120C0${String(100000 + page * 1000).padStart(7, "0")}`.replace("0100", "0100")]: { latestQuote: { bp: 1, ap: 1.1 } } };
    return json({ snapshots: page === 1 ? { "AAPL  261120C00100000": { latestQuote: { bp: 1, ap: 1.1 } } } : { "AAPL  261120P00100000": { latestQuote: { bp: 1, ap: 1.1 } } }, next_page_token: page === 1 ? "p2" : null });
  });
  const chain = await alpaca.fetchOptionsChain("AAPL");
  t("alpaca options follow next_page_token (page 2 is requested)", calls.length === 2 && chain.calls.length === 1 && chain.puts.length === 1 && chain.delayed === true && chain.feed === "alpaca-indicative");
}

// ---------------------------------------------------------------- cache keys: equal requests seconds apart build the same URL
{
  install(() => json({ bars: [], next_page_token: null }));
  const now = Date.now();
  await alpaca.fetchDailyBars("AAPL", now - 60 * 86400000, now, 1800);
  await alpaca.fetchDailyBars("AAPL", now + 25 - 60 * 86400000, now + 25, 1800);
  t("alpaca: two calls 25 ms apart use an identical URL (fetch cache can hit)", calls.length === 2 && calls[0].url === calls[1].url, calls.map((c) => c.url).join(" | "));
  install(() => json({ candles: [] }));
  await oanda.fetchMinuteBars("EUR/USD", now - 3600_000, now, 60);
  await oanda.fetchMinuteBars("EUR/USD", now + 40 - 3600_000, now + 40, 60);
  t("oanda: two calls 40 ms apart use an identical URL", calls.length === 2 && calls[0].url === calls[1].url);
  install(() => json([]));
  await coinbase.fetchMinuteBars("BTC-USD", now - 3600_000, now, 60);
  await coinbase.fetchMinuteBars("BTC-USD", now + 40 - 3600_000, now + 40, 60);
  t("coinbase: two calls 40 ms apart use an identical URL", calls.length === 2 && calls[0].url === calls[1].url);
  const w = snapWindow(1_000_123, 2_000_456, 60);
  t("snapWindow floors the start and ceils the end (newest data never cut)", w.startMs <= 1_000_123 && w.endMs >= 2_000_456 && w.startMs % 60000 === 0 && w.endMs % 60000 === 0);
}

// ---------------------------------------------------------------- symbol handling and routing
{
  const cls = md.classifySymbol;
  const rows: [string, string, string][] = [
    ["AAPL", "equity", "AAPL"],
    [" aapl ", "equity", "AAPL"],
    ["BRK.B", "equity", "BRK.B"],
    ["T", "equity", "T"],
    ["BTC-USD", "crypto", "BTC-USD"],
    ["btc-usd", "crypto", "BTC-USD"],
    ["BTC/USD", "crypto", "BTC-USD"],
    ["ETH/USD", "crypto", "ETH-USD"],
    ["EUR/USD", "forex", "EUR/USD"],
    ["usd/jpy", "forex", "USD/JPY"],
    ["^GSPC", "unsupported", "^GSPC"],
    ["/ES", "unsupported", "/ES"],
    ["ES=F", "unsupported", "ES=F"],
    ["BTC-EUR", "unsupported", "BTC-EUR"],
    ["", "unsupported", ""],
  ];
  for (const [input, kind, sym] of rows) {
    const c = cls(input);
    t(`routing: ${JSON.stringify(input)} -> ${kind} ${sym}`, c.kind === kind && c.symbol === sym, JSON.stringify(c));
  }
}
{
  install((url) => (url.includes("coinbase") ? json({ price: "65000", time: iso(Date.now()) }) : json({}, 500)));
  const q = await md.fetchQuote("BTC/USD");
  t("BTC/USD is served by Coinbase, never OANDA", q.lastPrice === 65000 && calls.every((c) => c.url.includes("api.exchange.coinbase.com") && c.url.includes("BTC-USD")));
}
{
  setFakeEnv({ OANDA_API_TOKEN: undefined });
  install(() => json({}));
  const r = await attempt(() => md.fetchQuote("EUR/USD"));
  t("EUR/USD without an OANDA token: clear error, no request to the stock endpoint", r.threw && /OANDA_API_TOKEN/.test(r.error.message) && calls.length === 0);
  const r2 = await attempt(() => md.fetchDailyBars("^GSPC", T0 - 86400000, T0, 60));
  t("unsupported symbol (^GSPC): clear error, no request", r2.threw && /Unsupported symbol/.test(r2.error.message) && calls.length === 0);
  setFakeEnv();
}
{
  install(() => json({ bars: [], next_page_token: null }));
  await md.fetchDailyBars(" msft ", T0 - 86400000, T0, 1800);
  t("equity symbol is trimmed and uppercased before the Alpaca request", calls[0].url.includes("/stocks/MSFT/bars"), calls[0].url);
}

// ---------------------------------------------------------------- Tradier: strict parsing, feed flag, base-URL behaviour intact
{
  const mkc = (over) => ({ strike: 150, expiration_date: "2026-11-20", option_type: "call", bid: 1, ask: 1.2, last: 1.1, open_interest: 10, volume: 5, greeks: { mid_iv: 0.25, delta: 0.5, gamma: 0.02, theta: -0.1, vega: 0.1 }, ...over });
  install((url) =>
    url.includes("expirations")
      ? json({ expirations: { date: ["2026-11-20"] } })
      : json({ options: { option: [
          mkc({}),
          mkc({ option_type: "CALL ", strike: 155 }),
          mkc({ option_type: "put", strike: 150 }),
          mkc({ option_type: undefined, strike: 160 }),
          mkc({ option_type: "straddle", strike: 165 }),
          mkc({ strike: 150 }), // duplicate of the first call
          mkc({ strike: "170", option_type: "put" }),
          mkc({ strike: 175, expiration_date: undefined }),
          mkc({ strike: 180, bid: -1, ask: 0.5 }),
          mkc({ strike: 185, bid: 2, ask: 1 }),
          mkc({ strike: 190, greeks: { mid_iv: 25 } }), // already a percent: 2500 is implausible
          mkc({ strike: 195, trade_date: 1790000000000 }),
        ] } })
  );
  const chain = await tradier.fetchOptionsChain(" aapl ");
  const call = (k) => chain.calls.find((c) => c.strikePrice === k);
  t("tradier: only call/put (any case) are kept; missing or unknown option_type is skipped, never a put", chain.calls.length === 6 && chain.puts.length === 2, `${chain.calls.length} ${chain.puts.length}`);
  t("tradier: duplicate contracts counted once", chain.calls.filter((c) => c.strikePrice === 150).length === 1);
  t("tradier: string strike becomes a number; missing expiration skipped", chain.puts.some((p) => p.strikePrice === 170 && typeof p.strikePrice === "number") && !call(175));
  t("tradier: negative bid and crossed quotes are zeroed", call(180).bid === 0 && call(185).bid === 0 && call(185).ask === 0);
  t("tradier: implausible IV (2500%) stored as 0 (unknown)", call(190).volatility === 0 && call(150).volatility === 25);
  t("tradier: sandbox chain flagged delayed with feed and asOf from quote times", chain.feed === "tradier-sandbox" && chain.delayed === true && chain.asOf === 1790000000000);
  t("tradier: symbol trimmed and uppercased", calls[0].url.includes("symbol=AAPL"));
  const prod = await (async () => {
    setFakeEnv({ TRADIER_PRODUCTION_TOKEN: "FAKEPROD" });
    return tradier.fetchOptionsChain("AAPL", "2026-11-20", { feed: "production" });
  })();
  t("tradier: explicit production feed still talks to api.tradier.com and is not marked delayed", calls[calls.length - 1].url.startsWith("https://api.tradier.com/") && prod.delayed === false && prod.feed === "tradier-production");
  setFakeEnv();
}

// ---------------------------------------------------------------- mock mode: refused in production, synthetic marker otherwise
{
  setFakeEnv({ MARKET_DATA_MOCK_MODE: "true", NODE_ENV: "production" });
  install(() => json({}));
  for (const [name, fn] of [["fetchQuote", () => md.fetchQuote("AAPL")], ["fetchDailyBars", () => md.fetchDailyBars("AAPL", T0 - 86400000, T0, 60)], ["fetchOptionsChain", () => md.fetchOptionsChain("AAPL")]]) {
    const r = await attempt(fn);
    t(`mock mode in production: ${name} refuses to run`, r.threw && /production/i.test(r.error.message));
  }
  setFakeEnv({ SCHWAB_MOCK_MODE: "true", NODE_ENV: "production" });
  const r = await attempt(() => md.fetchQuote("AAPL"));
  t("SCHWAB_MOCK_MODE alias is refused in production too", r.threw);
  setFakeEnv({ MARKET_DATA_MOCK_MODE: "true", NODE_ENV: "development" });
  const q = await md.fetchQuote("AAPL");
  const bars = await md.fetchDailyBars("AAPL", T0 - 30 * 86400000, T0, 60);
  const ch = await md.fetchOptionsChain("AAPL");
  t("mock mode outside production marks quote, candles and chain as synthetic", q.synthetic === true && bars.length > 0 && bars.every((b) => b.synthetic === true) && ch.synthetic === true);
  t("mock mode makes no network call", calls.length === 0);
  setFakeEnv();
}

summary();
