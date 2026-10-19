// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/chart-bars-route.test.mts
// The public GET /api/chart-bars route with no network and no key: strict query checks (ticker shape, timeframe, centre date,
// adjustment, events flag, query length), the per-address rate limit, the short cache header, the server-side cache, plain
// errors with no link in them, and an unchanged response shape. Mock market data is used; any real fetch throws.
import { makeT } from "./fixtures/fake-fetch.mts";

const { t, summary } = makeT();

process.env.MARKET_DATA_MOCK_MODE = "true";
let blockedCalls = 0;
globalThis.fetch = (async (input: any) => {
  blockedCalls += 1;
  throw new Error("BLOCKED " + (typeof input === "string" ? input : input.url));
}) as any;

const Q = await import("../src/lib/chart/chart-bars-query.ts");
const route = await import("../src/app/api/chart-bars/route.ts");
const get = (qs: string, ip = "10.1.0.1") => route.GET(new Request(`http://localhost/api/chart-bars?${qs}`, { headers: { "x-forwarded-for": ip } }));
const parse = (qs: string, now = Date.parse("2026-10-19T12:00:00Z")) => Q.parseChartBarsQuery(new URLSearchParams(qs), now);

// ------------------------------------------------------------------ pure query checks
{
  const ok = parse("ticker=aapl&timeframe=1yr");
  t("query: a plain request parses with the defaults (split adjustment, no centre date, bars not events)", ok.ok && ok.query.ticker === "aapl" && ok.query.adjustment === "split" && ok.query.centerDate === undefined && ok.query.events === false);
  for (const sym of ["BTC-USD", "EUR/USD", "ES=F", "^GSPC", "BRK.B", "AAPL261218C00200000"]) t(`query: symbol shape accepted: ${sym}`, parse(`ticker=${encodeURIComponent(sym)}&timeframe=1mo`).ok);
  for (const sym of ["<script>", "AAPL;DROP", "a b", "../etc/passwd", "AAPL\u0000", "A".repeat(21), "$$", "-AAPL", "AAPL\nX", "AAPL,MSFT"]) {
    const r = parse(`ticker=${encodeURIComponent(sym)}&timeframe=1mo`);
    t(`query: symbol shape refused: ${JSON.stringify(sym.slice(0, 12))}`, !r.ok && /letters and numbers/.test(r.error), JSON.stringify(r));
  }
  t("query: missing ticker or timeframe is refused", !parse("timeframe=1yr").ok && !parse("ticker=AAPL").ok && !parse("").ok);
  t("query: timeframe must be a known preset", !parse("ticker=AAPL&timeframe=10yr").ok && !parse("ticker=AAPL&timeframe=%3Cb%3E").ok && parse("ticker=AAPL&timeframe=5min").ok);
  t("query: an unknown timeframe is echoed back only in a cleaned form (no angle brackets)", !/[<>]/.test(parse("ticker=AAPL&timeframe=%3Cb%3E").error));
  t("query: centre date must be a real YYYY-MM-DD date", parse("ticker=AAPL&timeframe=1mo&centerDate=2026-02-31").ok === false && parse("ticker=AAPL&timeframe=1mo&centerDate=20260201").ok === false && parse("ticker=AAPL&timeframe=1mo&centerDate=2026-02-03").ok === true);
  t("query: centre date earlier than 2000 or later than tomorrow is refused", !parse("ticker=AAPL&timeframe=1mo&centerDate=1999-12-31").ok && !parse("ticker=AAPL&timeframe=1mo&centerDate=2026-10-21").ok && parse("ticker=AAPL&timeframe=1mo&centerDate=2026-10-20").ok && parse("ticker=AAPL&timeframe=1mo&centerDate=2000-01-01").ok);
  t("query: adjustment must be raw, split or all (an unknown value is now refused, not ignored)", parse("ticker=AAPL&timeframe=1yr&adjustment=raw").ok && !parse("ticker=AAPL&timeframe=1yr&adjustment=weird").ok && parse("ticker=AAPL&timeframe=1yr&adjustment=").ok);
  t("query: events flag is 1 or left out", parse("ticker=AAPL&timeframe=1yr&events=1").query.events === true && !parse("ticker=AAPL&timeframe=1yr&events=yes").ok);
  t("query: a very long query string is refused", !parse(`ticker=AAPL&timeframe=1yr&pad=${"x".repeat(400)}`).ok);
  t("cache seconds: intraday 15, daily and weekly 60, centred or events 300", Q.chartCacheSeconds({ timeframe: "5min" }) === 15 && Q.chartCacheSeconds({ timeframe: "1yr" }) === 60 && Q.chartCacheSeconds({ timeframe: "5yr" }) === 60 && Q.chartCacheSeconds({ timeframe: "5min", centerDate: "2026-01-02" }) === 300 && Q.chartCacheSeconds({ timeframe: "1yr", events: true }) === 300);
  const e = Q.safeChartError("Alpaca answered 500 for https://data.alpaca.markets/v2/stocks/AAPL/bars?apikey=abc\n" + "x".repeat(500));
  t("safe error: links are removed and the length is capped", !/https?:|apikey/.test(e) && e.length <= 300 && /\[link\]/.test(e), e.slice(0, 80));
}

// ------------------------------------------------------------------ route behaviour
{
  const bad = await get("ticker=%3Cscript%3E&timeframe=1yr", "10.1.1.1");
  t("route: a bad ticker is a 400 with a plain sentence and is not cached", bad.status === 400 && /letters and numbers/.test((await bad.json()).error) && bad.headers.get("cache-control") === "no-store");
  t("route: missing params keep the original 400 sentence", (await (await get("timeframe=1yr", "10.1.1.2")).json()).error === "Missing required 'ticker' and 'timeframe' query params.");
  t("route: unknown timeframe, bad date and bad adjustment are 400s", (await get("ticker=AAPL&timeframe=9yr", "10.1.1.3")).status === 400 && (await get("ticker=AAPL&timeframe=1yr&centerDate=nope", "10.1.1.3")).status === 400 && (await get("ticker=AAPL&timeframe=1yr&adjustment=zzz", "10.1.1.3")).status === 400);
  t("route: no real network call was attempted by any refused request", blockedCalls === 0, String(blockedCalls));

  const res = await get("ticker=AAPL&timeframe=1yr&adjustment=raw", "10.1.2.1");
  const body = await res.json();
  t("route: a good request is 200 with the same shape as before (symbol, timeframe, candles, dataLimitations, meta)", res.status === 200 && body.symbol === "AAPL" && body.timeframe === "1yr" && Array.isArray(body.candles) && body.candles.length > 10 && Array.isArray(body.dataLimitations) && typeof body.meta === "object", JSON.stringify(body).slice(0, 200));
  t("route: a daily chart gets a 60 second private cache header", res.headers.get("cache-control") === "private, max-age=60", res.headers.get("cache-control"));
  const intraday = await get("ticker=AAPL&timeframe=5min", "10.1.2.1");
  t("route: an intraday chart gets a 15 second cache header", intraday.status === 200 && intraday.headers.get("cache-control") === "private, max-age=15", intraday.headers.get("cache-control"));
  const centred = await get("ticker=AAPL&timeframe=1mo&centerDate=2026-03-02", "10.1.2.1");
  t("route: a window centred on a past date is cached for 300 seconds", centred.status === 200 && centred.headers.get("cache-control") === "private, max-age=300");
  const ev = await get("ticker=AAPL&timeframe=1yr&events=1", "10.1.2.1");
  const evBody = await ev.json();
  t("route: events=1 returns the events shape (events array and available flag)", ev.status === 200 && Array.isArray(evBody.events) && typeof evBody.available === "boolean", JSON.stringify(evBody).slice(0, 150));
  const again = await get("ticker=aapl&timeframe=1yr&adjustment=raw", "10.1.2.1");
  const againBody = await again.json();
  t("route: asking again (any letter case) inside the window is served from the server cache with identical bars", again.status === 200 && JSON.stringify(againBody.candles) === JSON.stringify(body.candles));

  const plain = await get("ticker=AAPL&timeframe=1sec", "10.1.2.2");
  const pb = await plain.json();
  t("route: a preset with no data source answers 500 with a plain sentence, not cached, no link", plain.status === 500 && /tick-data|not available/i.test(pb.error) && plain.headers.get("cache-control") === "no-store" && !/https?:/.test(pb.error), JSON.stringify(pb));

  const lim = [];
  for (let i = 0; i < 123; i++) lim.push((await get("ticker=%24%24", "10.1.3.9")).status);
  t("route: the 121st request in a minute from one address is rate limited (429) with a retry hint", lim.slice(0, 120).every((s) => s === 400) && lim[120] === 429 && lim[122] === 429, lim.slice(118, 123).join());
  const other = await get("ticker=AAPL&timeframe=1yr", "10.1.3.10");
  t("route: another address is not affected by that limit", other.status === 200);
  const lr = await get("ticker=%24%24", "10.1.3.9");
  t("route: the 429 body is JSON with retryAfterSec and a retry-after header", lr.status === 429 && Number(lr.headers.get("retry-after")) >= 1 && typeof (await lr.json()).retryAfterSec === "number");
}

summary();
