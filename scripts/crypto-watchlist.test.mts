// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/crypto-watchlist.test.mts
// Offline checks of the crypto watchlist snapshot: the 24h / 7d change maths and the per-coin isolation, against fake data.
import * as W from "../src/lib/agents/trading-agent/skills/crypto-watchlist.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number | null, b: number, tol = 1e-9) => a !== null && Math.abs(a - b) <= tol;
const HOUR = 3_600_000, DAY = 24 * HOUR;

// Hourly candles, one per hour for 8 days up to "now", close = 100 at the start rising 1 per hour.
const NOW = Date.UTC(2026, 9, 14, 12, 30); // 12:30, so the latest finished hourly candle started 11:00
const start = NOW - 8 * DAY - (NOW % HOUR);
const bars = [];
for (let t0 = start, i = 0; t0 + HOUR <= NOW; t0 += HOUR, i++) bars.push({ datetime: t0, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 });
const closeAt = (ms: number) => bars.find((b) => b.datetime + HOUR === ms)?.close;

// ---------------------------------------------------------------- priceAt
{
  const target = NOW - DAY; // 12:30 yesterday: the 11:00 to 12:00 candle was the last finished one, so its 12:00 close is the price
  const px = W.priceAt(bars, target, HOUR);
  t("price at a moment is the close of the last candle already finished", px === closeAt(Math.floor(target / HOUR) * HOUR), String(px));
  t("a candle still forming at the target is not used", W.priceAt([{ datetime: NOW - HOUR / 2, open: 1, high: 1, low: 1, close: 1, volume: 0 }], NOW, HOUR) === null);
  t("no candle that far back gives null, not a guess", W.priceAt(bars, start - DAY, HOUR) === null && W.priceAt([], NOW, HOUR) === null);
}

// ---------------------------------------------------------------- pctChange
t("percent change", near(W.pctChange(110, 100), 10) && near(W.pctChange(90, 100), -10));
t("missing or non-positive reference gives null", W.pctChange(100, null) === null && W.pctChange(null, 100) === null && W.pctChange(100, 0) === null && W.pctChange(100, -5) === null);

// ---------------------------------------------------------------- computeChanges
{
  const last = 300;
  const c = W.computeChanges(last, bars, NOW);
  const ref24 = W.priceAt(bars, NOW - DAY, HOUR), ref7 = W.priceAt(bars, NOW - 7 * DAY, HOUR);
  t("24h and 7d changes use the hourly close at those moments", near(c.change24hPct, (last / ref24 - 1) * 100) && near(c.change7dPct, (last / ref7 - 1) * 100));
  const short = W.computeChanges(last, bars.slice(-40), NOW); // 40 hours of candles: 24h exists, 7d does not
  t("a coin with under a week of candles has 24h but a null 7d", short.change24hPct !== null && short.change7dPct === null);
}

// ---------------------------------------------------------------- snapshot service
{
  const deps = {
    now: () => NOW,
    quote: async (s: string) => {
      if (s === "BAD-USD") throw new Error("Coinbase request failed for /products/BAD-USD/ticker: 404");
      return { lastPrice: s === "ETH-USD" ? 3000 : 300 };
    },
    hourlyBars: async (s: string) => bars,
  };
  const snap = await W.getCryptoWatchlistSnapshot(["btc", "ETH-USD", "bad", "eth/usd", "AAPL USD!", "BTC-USD"], deps);
  t("symbols are normalised and de-duplicated, junk dropped", snap.rows.map((r) => r.symbol).join() === "BTC-USD,ETH-USD,BAD-USD", snap.rows.map((r) => r.symbol).join());
  t("one failing coin carries its own error and the others still price", snap.rows[2].error !== null && snap.rows[0].error === null && snap.rows[0].lastPrice === 300 && snap.rows[1].lastPrice === 3000);
  t("a failed row has no numbers, not stale or zero ones", snap.rows[2].lastPrice === null && snap.rows[2].change24hPct === null);
  t("the snapshot states its data caveat", snap.dataLimitations.some((d) => /one exchange/.test(d)));
  const many = await W.getCryptoWatchlistSnapshot(Array.from({ length: 40 }, (_, i) => `C${i}X-USD`), deps);
  t("the list is capped and says so", many.rows.length === 25 && many.dataLimitations.some((d) => /first 25 of 40/.test(d)));
}

console.log(bad === 0 ? "\nall passed" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
