// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/chart-integrity.test.mts
// Chart integrity (WP1): split adjustment reaches the provider URL, chart header facts are derived honestly, and the
// hand-built SVG charts obey the misleading-chart rules that can be checked automatically. Fake fetch only; no network.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setFakeEnv, install, json, makeT, calls, bar } from "../fixtures/fake-fetch.mts";
import * as alpaca from "../../src/lib/data/alpaca.ts";
import * as md from "../../src/lib/data/market-data.ts";
import { parseBarAdjustment, DEFAULT_BAR_ADJUSTMENT } from "../../src/lib/data/market-data-types.ts";
import { getChartBars } from "../../src/lib/agents/trading-agent/skills/chart-bars.ts";
import { formatBarLabel, formatTick, zoneForProvider } from "../../src/lib/chart/timeformat.ts";
import { INDICATORS, computeIndicator, indicatorDef } from "../../src/lib/chart/indicators.ts";
import { deriveChartMeta, describeFeed, describeAdjustment, volumeLegendLabel, formatAge, barMsFromTimeframe, isLikelyLiveEquitySession } from "../../src/lib/chart/meta.ts";

const { t, summary } = makeT();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
setFakeEnv();
const T0 = Date.UTC(2026, 9, 14, 14, 0, 0);
const DAY = 86_400_000;
const barsBody = () => json({ bars: [bar(new Date(T0 - DAY).toISOString()), bar(new Date(T0).toISOString())], next_page_token: null });
const param = (url: string, key: string) => new URL(url).searchParams.get(key);

// ---------------------------------------------------------------- 1. adjustment reaches the provider URL
t("default adjustment constant is split", DEFAULT_BAR_ADJUSTMENT === "split");
t(
  "parseBarAdjustment accepts the three modes and rejects junk",
  parseBarAdjustment("raw") === "raw" &&
    parseBarAdjustment("all") === "all" &&
    parseBarAdjustment("split") === "split" &&
    parseBarAdjustment("bogus") === "split" &&
    parseBarAdjustment(undefined) === "split" &&
    parseBarAdjustment(null, "raw") === "raw" &&
    parseBarAdjustment("RAW") === "split"
);

install(() => barsBody());
await alpaca.fetchDailyBars("AAPL", T0 - 5 * DAY, T0, 1800);
t("alpaca daily bars default to adjustment=split", param(calls[0].url, "adjustment") === "split", calls[0]?.url);
install(() => barsBody());
await alpaca.fetchDailyBars("AAPL", T0 - 5 * DAY, T0, 1800, { adjustment: "raw" });
t("alpaca daily bars with raw ask for adjustment=raw", param(calls[0].url, "adjustment") === "raw");
install(() => barsBody());
await alpaca.fetchMinuteBars("AAPL", T0 - DAY, T0, 60, { adjustment: "all" });
t("alpaca minute bars with all ask for adjustment=all", param(calls[0].url, "adjustment") === "all" && param(calls[0].url, "timeframe") === "1Min");
install(() => barsBody());
await alpaca.fetchBarsForTimeframe("AAPL", "5Min", T0 - DAY, T0, 60);
t("alpaca arbitrary timeframe defaults to split", param(calls[0].url, "adjustment") === "split" && param(calls[0].url, "timeframe") === "5Min");
install(() => barsBody());
await alpaca.fetchBarsForTimeframe("AAPL", "5Min", T0 - DAY, T0, 60, { adjustment: "nonsense" });
t("an invalid adjustment never reaches the URL (falls back to split)", param(calls[0].url, "adjustment") === "split");
install(() => barsBody());
const det = await alpaca.fetchBarsForTimeframeDetailed("AAPL", "1Day", T0 - 5 * DAY, T0, 60, { adjustment: "raw" });
t("detailed result reports the adjustment applied and the provider", det.adjustment === "raw" && det.provider === "Alpaca");

// cache keys: the URL (Next's data cache key) differs per adjustment, everything else identical
{
  const urls: string[] = [];
  for (const adjustment of ["raw", "split", "all"]) {
    install(() => barsBody());
    await alpaca.fetchDailyBars("AAPL", T0 - 5 * DAY, T0, 1800, { adjustment });
    urls.push(calls[0].url);
  }
  t("cache key (URL) is distinct per adjustment", new Set(urls).size === 3);
  const strip = (u: string) => {
    const x = new URL(u);
    x.searchParams.delete("adjustment");
    return x.toString();
  };
  t("only the adjustment differs between the three URLs", new Set(urls.map(strip)).size === 1);
}

// through market-data.ts
install(() => barsBody());
await md.fetchDailyBars("AAPL", T0 - 5 * DAY, T0, 1800);
t("market-data daily default is split", param(calls[0].url, "adjustment") === "split");
install(() => barsBody());
await md.fetchMinuteBars("AAPL", T0 - DAY, T0, 60, { adjustment: "raw" });
t("market-data minute passes raw through", param(calls[0].url, "adjustment") === "raw");
install(() => barsBody());
await md.fetchBarsForTimeframe("AAPL", "1Hour", T0 - DAY, T0, 60, { adjustment: "all" });
t("market-data timeframe passes all through", param(calls[0].url, "adjustment") === "all");

// chart-bars logic: default split, explicit raw, and the meta block
{
  install(() => barsBody());
  const r = await getChartBars("AAPL", "1yr");
  t("getChartBars default requests split", param(calls[0].url, "adjustment") === "split");
  t("getChartBars meta says Alpaca, iex, split", r.meta.provider === "Alpaca" && r.meta.feed === "iex" && r.meta.adjustment === "split", JSON.stringify(r.meta));
  install(() => barsBody());
  const raw = await getChartBars("AAPL", "1yr", undefined, "raw");
  t("getChartBars raw is labelled unadjusted", param(calls[0].url, "adjustment") === "raw" && raw.meta.adjustment === "raw");
}
// mock data: nothing real is claimed
{
  install(() => json({}));
  setFakeEnv({ MARKET_DATA_MOCK_MODE: "true" });
  const r = await getChartBars("AAPL", "1yr");
  t("mock data is marked synthetic in the meta and carries no adjustment claim", r.meta.synthetic === true && r.meta.adjustment === null && r.meta.feed === "mock");
  setFakeEnv();
}

// the paper-trading fill path and the live signal paths ask for raw (unadjusted) prices
{
  const engine = read("src/lib/agents/trading-agent/skills/paper-trading-engine.ts");
  t("paper-trading fills request raw bars", /fetchMinuteBars\(order\.symbol, startMs, endMs, 60, \{ adjustment: "raw" \}\)/.test(engine));
  t("watchlist live scan requests raw bars", /adjustment: "raw"/.test(read("src/lib/agents/trading-agent/skills/watchlist-scan.ts")));
  t("live VWAP signal scan requests raw bars", /adjustment: "raw"/.test(read("src/lib/agents/trading-agent/skills/vwap-signal-service.ts")));
}

// ---------------------------------------------------------------- 2. honest labelling helpers
{
  const iexBar = (dt: number, over = {}) => ({ datetime: dt, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, feed: "iex", ...over });
  t("describeFeed(iex) names one exchange and the consolidated tape", /one exchange/.test(describeFeed("iex").volumeNote) && /consolidated tape/.test(describeFeed("iex").volumeNote));
  t("describeFeed(unknown) says not stated", /not stated/i.test(describeFeed(null).short) && /not stated/i.test(describeFeed(undefined).volumeNote));
  t("describeFeed(oanda) says tick count, not traded volume", /tick count/.test(describeFeed("oanda-mid").volumeNote));
  t(
    "describeAdjustment labels the three modes and null",
    describeAdjustment("split") === "Split-adjusted" && describeAdjustment("raw") === "Unadjusted" && /dividend/.test(describeAdjustment("all")) && /not applicable/.test(describeAdjustment(null))
  );
  t("volume legend names the source and the unit", /IEX/.test(volumeLegendLabel("iex", "split")) && /split-adjusted/.test(volumeLegendLabel("iex", "split")) && !/split-adjusted/.test(volumeLegendLabel("iex", "raw")));
  t("barMsFromTimeframe parses Alpaca strings", barMsFromTimeframe("5Min") === 300000 && barMsFromTimeframe("4Hour") === 4 * 3600000 && barMsFromTimeframe("1Day") === DAY && barMsFromTimeframe("1Week") === 7 * DAY);

  // 15:00Z on a Wednesday in October is 11:00 ET (EDT): a live session. Saturday and 07:00 ET are not.
  const wed11et = Date.UTC(2026, 9, 14, 15, 0, 0);
  const sat = Date.UTC(2026, 9, 17, 15, 0, 0);
  t("isLikelyLiveEquitySession: Wed 11:00 ET yes, Sat no, Wed 07:00 ET no", isLikelyLiveEquitySession(wed11et) && !isLikelyLiveEquitySession(sat) && !isLikelyLiveEquitySession(Date.UTC(2026, 9, 14, 11, 0, 0)));

  const live = deriveChartMeta([iexBar(wed11et - 5 * 60000)], { provider: "Alpaca", adjustment: "split", timeframe: "5Min", assetKind: "equity", nowMs: wed11et });
  t("fresh intraday equity bar: not delayed (derived)", live.delayed === false && live.delayedSource === "derived");
  const stale = deriveChartMeta([iexBar(wed11et - 60 * 60000)], { provider: "Alpaca", adjustment: "split", timeframe: "5Min", assetKind: "equity", nowMs: wed11et });
  t("hour-old intraday equity bar in session: derived delayed", stale.delayed === true && stale.delayedSource === "derived");
  const weekend = deriveChartMeta([iexBar(sat - 20 * 3600000)], { provider: "Alpaca", adjustment: "split", timeframe: "5Min", assetKind: "equity", nowMs: sat });
  t("old bar on a closed market is NOT called delayed (unknown)", weekend.delayed === null && weekend.delayedSource === null);
  const daily = deriveChartMeta([iexBar(wed11et - 3 * DAY)], { provider: "Alpaca", adjustment: "split", timeframe: "1Day", assetKind: "equity", nowMs: wed11et });
  t("daily bars never get a derived delay flag", daily.delayed === null);
  const flagged = deriveChartMeta([iexBar(wed11et - 60000, { delayed: true })], { timeframe: "1Min", assetKind: "forex", nowMs: wed11et });
  t("a provider delayed flag is used as given (source provider)", flagged.delayed === true && flagged.delayedSource === "provider");
  const forex = deriveChartMeta([iexBar(wed11et - 3600000, { feed: "oanda-mid" })], { timeframe: "5Min", assetKind: "forex", nowMs: wed11et });
  t("forex without a provider flag stays unknown", forex.delayed === null);
  const crypto = deriveChartMeta([iexBar(wed11et - 3 * 3600000, { feed: "coinbase" })], { timeframe: "5Min", assetKind: "crypto", nowMs: wed11et });
  t("crypto (24/7) with a 3 h old 5-minute bar is derived delayed", crypto.delayed === true);
  const none = deriveChartMeta([], { timeframe: "1Day", nowMs: wed11et });
  t("no bars: asOf null, feed null, nothing invented", none.asOf === null && none.feed === null && none.delayed === null);
  t("asOf is the bar END (open + bar length)", live.asOf === wed11et - 5 * 60000 + 300000);
  t("formatAge", formatAge(10_000) === "just now" && formatAge(5 * 60000) === "5 min ago" && formatAge(3 * 3600000) === "3 h ago" && formatAge(2 * DAY) === "2 d ago" && formatAge(NaN) === "just now");
}

// ---------------------------------------------------------------- 3. time zone labels and the indicator catalogue
{
  const sec = Date.UTC(2026, 9, 14, 13, 35, 0) / 1000; // 09:35 ET
  t("formatBarLabel intraday names the zone and shows ET clock time", formatBarLabel(sec, "America/New_York", true) === "2026-10-14 09:35 ET", formatBarLabel(sec, "America/New_York", true));
  t("formatBarLabel in UTC", formatBarLabel(sec, "UTC", true) === "2026-10-14 13:35 UTC");
  t("formatBarLabel daily is the date only", formatBarLabel(sec, "UTC", false) === "2026-10-14");
  t("zoneForProvider: Alpaca is Eastern, everything else UTC", zoneForProvider("Alpaca") === "America/New_York" && zoneForProvider("OANDA") === "UTC" && zoneForProvider(null) === "UTC");
  t("formatTick time type is HH:MM in the zone", formatTick(sec, 3, "America/New_York") === "09:35" && formatTick(sec, 3, "UTC") === "13:35");

  const candles = Array.from({ length: 120 }, (_, i) => {
    const c = 100 + Math.sin(i / 7) * 5 + i * 0.1;
    return { datetime: Date.UTC(2026, 0, 1) + i * 86_400_000, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1000 + i };
  });
  const lengths = INDICATORS.map((d) => ({ id: d.id, out: computeIndicator(d.id, candles) }));
  t("every catalogue indicator computes", lengths.every((x) => x.out.series.length > 0 || x.out.levels.length > 0));
  t(
    "every series spec has one value per bar (alignment)",
    lengths.every((x) => x.out.series.every((s) => s.values.length === candles.length)),
    lengths.filter((x) => x.out.series.some((s) => s.values.length !== candles.length)).map((x) => x.id).join(",")
  );
  t("estimated overlays carry an estimate reason: volume profile and VWAP", Boolean(indicatorDef("volumeProfile")?.estimate) && Boolean(indicatorDef("vwap")?.estimate));
  t("volume profile levels are titled as estimates", computeIndicator("volumeProfile", candles).levels.every((l) => /est\./.test(l.title)));
  t("plain price averages are not tagged as estimates", !indicatorDef("ema20")?.estimate && !indicatorDef("rsi")?.estimate);
  t("unknown indicator id gives an empty output", computeIndicator("nope", candles).series.length === 0);
  t("ids are unique", new Set(INDICATORS.map((d) => d.id)).size === INDICATORS.length);
}

summary();
