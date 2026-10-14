// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/crypto-data.test.mts
// Offline checks of the Coinbase candle helpers (symbol shape, candle-size choice, request windows, parsing, weekly
// buckets). Set LIVE=1 to also pull real BTC-USD candles and run the crypto backtest end to end (public API, no key).
import * as C from "../src/lib/data/coinbase.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const DAY = 86_400_000;

// ---------------------------------------------------------------- symbol shape
t("coin-USD product ids are crypto", ["BTC-USD", "eth-usd", "DOGE-USD", " SOL-USD "].every(C.isCryptoSymbol));
t("equities, forex pairs and other symbols are not", ["AAPL", "EUR/USD", "BTC/USD", "BTC-EUR", "SPY", "BRK.B", "-USD", ""].every((s) => !C.isCryptoSymbol(s)));

// ---------------------------------------------------------------- candle size
const MIN = 60_000, HOUR = 3_600_000;
t("1h and 4h are built from 1h candles, 10min from 5min, 30min from 15min", C.pickGranularitySec(HOUR) === 3600 && C.pickGranularitySec(4 * HOUR) === 3600 && C.pickGranularitySec(10 * MIN) === 300 && C.pickGranularitySec(30 * MIN) === 900);
t("1min, 5min, 15min, 6h and 1d are native", [1, 5, 15].every((m, i) => C.pickGranularitySec(m * MIN) === [60, 300, 900][i]) && C.pickGranularitySec(6 * HOUR) === 21600 && C.pickGranularitySec(DAY) === 86400);
t("1 week uses daily candles; an odd width falls back to the largest size that divides it", C.pickGranularitySec(7 * DAY) === 86400 && C.pickGranularitySec(7 * MIN) === 60);
t("a width no native size divides returns null", C.pickGranularitySec(30_000) === null);

// ---------------------------------------------------------------- request windows
{
  const start = Date.UTC(2020, 0, 1), end = Date.UTC(2026, 9, 14);
  const w = C.planWindows(start, end, 86400);
  const covers = w[0].startMs === start && w[w.length - 1].endMs === end && w.every((x, i) => i === 0 || x.startMs === w[i - 1].endMs);
  t("windows run end to end without gaps or overlap, from start to end", covers, `${w.length} windows`);
  t("no window asks for more than 300 candles", w.every((x) => (x.endMs - x.startMs) / (86400 * 1000) <= 300));
  t("a range under one window is a single request", C.planWindows(start, start + 10 * DAY, 86400).length === 1);
  t("an empty or reversed range makes no requests", C.planWindows(end, start, 86400).length === 0 && C.planWindows(start, start, 60).length === 0);
  const fiveYears = C.planWindows(end - 5 * 365 * DAY, end, 86400).length;
  t("five years of daily candles is a handful of requests", fiveYears >= 6 && fiveYears <= 8, String(fiveYears));
}

// ---------------------------------------------------------------- parsing (Coinbase row order is time, low, high, open, close, volume)
{
  const rows = [[1791936000, 81560.04, 84062.11, 83101.99, 81947.4, 3987.88], [1791849600, 80927.48, 84070.33, 81735.6, 83101.99, 5184.64], ["x"], [1, 2, 3], null, [1791763200, "bad", 1, 1, 1, 1]];
  const c = C.parseCandles(rows);
  t("parse keeps good rows, drops malformed ones and does not throw on non-arrays", c.length === 2 && C.parseCandles(null).length === 0 && C.parseCandles({}).length === 0);
  t("parse maps columns correctly and converts seconds to milliseconds", c[0].datetime === 1791936000000 && c[0].open === 83101.99 && c[0].close === 81947.4 && c[0].high === 84062.11 && c[0].low === 81560.04 && c[0].volume === 3987.88);
}

// ---------------------------------------------------------------- weekly buckets start on Monday 00:00 UTC
{
  const mon = Date.UTC(2026, 9, 5); // Monday 5 Oct 2026
  const days = Array.from({ length: 14 }, (_, i) => ({ datetime: mon + i * DAY, open: 100 + i, high: 110 + i, low: 90 + i, close: 101 + i, volume: 1 }));
  const w = C.aggregateCryptoCandles(days, 7 * DAY);
  t("two Monday-to-Sunday weeks make two weekly candles", w.length === 2, String(w.length));
  t("a weekly candle opens Monday 00:00 UTC", w.every((x) => new Date(x.datetime).getUTCDay() === 1 && x.datetime % DAY === 0) && w[0].datetime === mon);
  t("a weekly candle has the first open, last close, highest high, lowest low and summed volume", w[0].open === 100 && w[0].close === 107 && w[0].high === 116 && w[0].low === 90 && w[0].volume === 7);
  const h = Array.from({ length: 8 }, (_, i) => ({ datetime: mon + i * HOUR, open: 1, high: 2, low: 0.5, close: 1.5, volume: 2 }));
  t("4-hour candles built from hourly ones start on 4-hour boundaries", C.aggregateCryptoCandles(h, 4 * HOUR).every((x) => x.datetime % (4 * HOUR) === 0));
}

// ---------------------------------------------------------------- live (public API)
if (process.env.LIVE === "1") {
  const end = Date.now();
  const daily = await C.fetchDailyBars("BTC-USD", end - 700 * DAY, end, 0);
  t("live: 700 days of BTC-USD come back in order with no duplicate days", daily.length >= 695 && daily.every((c, i) => i === 0 || c.datetime > daily[i - 1].datetime), String(daily.length));
  t("live: daily candles open at 00:00 UTC and high >= low", daily.every((c) => c.datetime % DAY === 0 && c.high >= c.low));
  const gaps = daily.filter((c, i) => i > 0 && c.datetime - daily[i - 1].datetime !== DAY).length;
  t("live: no missing days in the last 700", gaps === 0, `${gaps} gaps`);
  const q = await C.fetchQuote("BTC-USD");
  t("live: quote is a positive price near the last daily close", q.lastPrice > 0 && Math.abs(q.lastPrice / daily[daily.length - 1].close - 1) < 0.15, String(q.lastPrice));
  const h4 = await C.fetchBarsForBucket("BTC-USD", 4 * HOUR, end - 10 * DAY, end, 0);
  t("live: 4-hour candles for 10 days (about 60) on 4-hour boundaries", h4.length >= 55 && h4.length <= 62 && h4.every((c) => c.datetime % (4 * HOUR) === 0), String(h4.length));
  const wk = await C.fetchBarsForBucket("BTC-USD", 7 * DAY, end - 365 * DAY, end, 0);
  t("live: weekly candles for a year start on Mondays", wk.length >= 52 && wk.every((c) => new Date(c.datetime).getUTCDay() === 1), String(wk.length));

  const { runBacktest } = await import("../src/lib/agents/trading-agent/skills/historical-backtest.ts");
  const r = await runBacktest("BTC-USD", "momentum", 3);
  t("live backtest: BTC-USD momentum scans about three years of days", r.tradingDaysScanned >= 1050 && r.tradingDaysScanned <= 1140 && r.horizons.length === 5, String(r.tradingDaysScanned));
  t("live backtest: the crypto caveat comes first and the date keys are UTC days", /^Crypto:/.test(r.dataLimitations[0]) && r.tradeLog.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.dateKey)));
  const last = new Date(end).toISOString().slice(0, 10);
  t("live backtest: no trade-log date is in the future", r.tradeLog.every((x) => x.dateKey <= last));
  console.log(`  momentum: ${r.signalOccurrences} occurrences; horizons n=${r.horizons.map((h) => h.sampleSize).join("/")}`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
