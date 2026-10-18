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
import { defaultScaleMode, effectiveScaleMode, parseScaleMode, loadScaleChoice, saveScaleChoice, SCALE_MODES, SCALE_LABELS, SCALE_DESCRIPTIONS } from "../../src/lib/chart/scale.ts";
import { equitySessionOf, filterExtendedHours, hasExtendedBars, extendedShadeRanges, countSessions } from "../../src/lib/chart/sessions.ts";
import { finiteNumbers, niceStep, niceTicks, median, histogram, fmtPct, fmtPctCompact, fmtMoneyCompact, barPercent, zeroBasedY } from "../../src/lib/chart/svg-math.ts";
import { withCashSlice } from "../../src/components/AllocationPieChart.tsx";
import { withAlpha } from "../../src/lib/chart/colors.ts";
import { TIMEFRAME_PRESETS } from "../../src/lib/agents/trading-agent/skills/timeframe-presets.ts";
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

// ---------------------------------------------------------------- 4. scale mode and sessions (WP1 item 3)
{
  const DAYMS = 86_400_000;
  t("defaultScaleMode: 5yr is log, 1yr is linear, exactly 2 years is log", defaultScaleMode(5 * 365 * DAYMS) === "log" && defaultScaleMode(365 * DAYMS) === "linear" && defaultScaleMode(2 * 365 * DAYMS) === "log" && defaultScaleMode(0) === "linear");
  t("every shipped timeframe preset maps to a sensible default (only 5yr is log)", TIMEFRAME_PRESETS.filter((p) => defaultScaleMode(p.lookbackMs) === "log").map((p) => p.id).join() === "5yr");
  t("effectiveScaleMode: user choice wins over the default", effectiveScaleMode("linear", 5 * 365 * DAYMS, 10) === "linear" && effectiveScaleMode("percent", 30 * DAYMS, 10) === "percent" && effectiveScaleMode(null, 5 * 365 * DAYMS, 10) === "log");
  t("effectiveScaleMode: log falls back to linear when a price is not above zero or unknown", effectiveScaleMode("log", DAYMS, 0) === "linear" && effectiveScaleMode("log", DAYMS, -1) === "linear" && effectiveScaleMode(null, 5 * 365 * DAYMS, null) === "linear");
  t("parseScaleMode rejects junk", parseScaleMode("log") === "log" && parseScaleMode("LOG") === null && parseScaleMode(undefined) === null && parseScaleMode(3) === null);
  const mem: Record<string, string> = {};
  const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) };
  saveScaleChoice("percent", store);
  t("scale choice round-trips through session storage", loadScaleChoice(store) === "percent");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  t("blocked storage never throws", loadScaleChoice(broken as any) === null && (saveScaleChoice("log", broken as any), true));
  t("scale labels exist for every mode and say what the axis is", SCALE_MODES.every((m) => SCALE_LABELS[m] && SCALE_DESCRIPTIONS[m].length > 10) && /percent/i.test(SCALE_DESCRIPTIONS.log));

  // 2026-10-14 (Wednesday, EDT = UTC-4): 04:00 pre, 09:30 regular, 16:00 post, 20:00 closed
  const at = (h: number, m: number) => Date.UTC(2026, 9, 14, h + 4, m, 0);
  t("equitySessionOf boundaries", equitySessionOf(at(3, 59)) === "closed" && equitySessionOf(at(4, 0)) === "pre" && equitySessionOf(at(9, 29)) === "pre" && equitySessionOf(at(9, 30)) === "regular" && equitySessionOf(at(15, 59)) === "regular" && equitySessionOf(at(16, 0)) === "post" && equitySessionOf(at(19, 59)) === "post" && equitySessionOf(at(20, 0)) === "closed");
  t("equitySessionOf: Saturday is closed all day", equitySessionOf(Date.UTC(2026, 9, 17, 15, 0, 0)) === "closed");
  // DST: Tuesday 2026-11-03 is EST (UTC-5): 14:30Z is 09:30 ET
  t("equitySessionOf follows daylight saving (EST in November)", equitySessionOf(Date.UTC(2026, 10, 3, 14, 30, 0)) === "regular" && equitySessionOf(Date.UTC(2026, 10, 3, 14, 29, 0)) === "pre");
  const day = [at(4, 0), at(8, 0), at(9, 25), at(9, 30), at(12, 0), at(15, 55), at(16, 0), at(19, 55)].map((datetime) => ({ datetime, v: 1 }));
  t("filterExtendedHours(false) keeps only regular bars and preserves order", filterExtendedHours(day, false).map((b) => b.datetime).join() === [at(9, 30), at(12, 0), at(15, 55)].join());
  t("filterExtendedHours(true) keeps everything (copy)", filterExtendedHours(day, true).length === 8 && filterExtendedHours(day, true) !== day);
  t("filterExtendedHours on empty input", filterExtendedHours([], false).length === 0);
  t("hasExtendedBars", hasExtendedBars(day.map((b) => b.datetime)) && !hasExtendedBars([at(10, 0), at(11, 0)]) && !hasExtendedBars([]));
  const runs = extendedShadeRanges(day);
  t("extendedShadeRanges: pre-market run and after-hours run", runs.length === 2 && runs[0].fromMs === at(4, 0) && runs[0].toMs === at(9, 25) && runs[1].fromMs === at(16, 0) && runs[1].toMs === at(19, 55), JSON.stringify(runs));
  const joined = extendedShadeRanges([at(18, 0), at(19, 55), Date.UTC(2026, 9, 15, 8, 5, 0)].map((datetime) => ({ datetime })));
  t("a post-market run continues into the next pre-market when no regular bar sits between", joined.length === 1);
  const counts = countSessions(day.map((b) => b.datetime));
  t("countSessions", counts.pre === 3 && counts.regular === 3 && counts.post === 2 && counts.closed === 0, JSON.stringify(counts));
  t("withAlpha builds rgba and rejects bad input", withAlpha("#4fe8d0", 0.5) === "rgba(79, 232, 208, 0.5)" && withAlpha("nope", 0.5) === "nope" && withAlpha("#000000", 5) === "rgba(0, 0, 0, 1)");
}

// ---------------------------------------------------------------- 5. misleading-chart rules on the hand-built charts (WP1 item 4)
{
  const OWNED = ["BacktestCharts.tsx", "RetirementCharts.tsx", "PhaseCharts.tsx", "IndicatorChart.tsx", "AllocationPieChart.tsx", "PriceChart.tsx"];
  const src = Object.fromEntries(OWNED.map((f) => [f, read(`src/components/${f}`)]));
  const code = (f: string) => src[f].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // R1: every bar rectangle is drawn from the zero baseline (height = y(0) - y(count)).
  const bt = code("BacktestCharts.tsx");
  const barRects = bt.match(/<rect[^>]*\by=\{y\([^}]*\}[^>]*>/g) ?? [];
  t("R1 histogram bars exist and every one is anchored at y(0)", barRects.length >= 1 && barRects.every((r) => /height=\{y\(0\) - y\(/.test(r)), barRects.join(" | "));
  t("R1 cost bars scale from zero through barPercent (no minimum sliver)", /barPercent\(r\.pct, max\)/.test(code("RetirementCharts.tsx")) && !/Math\.max\(1\.5/.test(code("RetirementCharts.tsx")));
  t("R1 no owned recharts <Bar> chart sets a non-zero y domain", OWNED.every((f) => !/<Bar\b/.test(code(f))));

  // R2: never two y axes.
  t("R2 no dual y-axes: no yAxisId, no right-hand YAxis, at most one YAxis per file", OWNED.every((f) => !/yAxisId|orientation="right"/.test(code(f)) && (code(f).match(/<YAxis\b/g) ?? []).length <= 1));
  t("R2 the stacked equity and drawdown panels are labelled as separate scales", /its own scale, separate panel/.test(bt));

  // R3: no smoothed lines or spline paths.
  t("R3 no smoothed recharts lines or areas", OWNED.every((f) => !/type="(monotone|natural|basis|cardinal|bump)/.test(code(f))));
  t("R3 no spline commands in hand-built SVG paths", ["BacktestCharts.tsx", "RetirementCharts.tsx", "PhaseCharts.tsx"].every((f) => !/[ "`](C|S|Q|T)\$\{/.test(code(f))));

  // R4: text alternative and sample size.
  t("R4 every hand-built svg has role=img and an aria-label", ["BacktestCharts.tsx", "RetirementCharts.tsx", "PhaseCharts.tsx"].every((f) => [...code(f).matchAll(/<svg\b/g)].map((m) => code(f).slice(m.index, m.index + 700)).filter((tag) => /^<svg[\s\S]{0,400}?viewBox/.test(tag)).every((tag) => /^<svg[\s\S]{0,700}?role="img"/.test(tag) && /^<svg[\s\S]{0,700}?aria-label/.test(tag))));
  t("R4 sample size is printed where a statistic is (forest n=, dumbbell n=, histogram n=, equity n=, reversion n=)", /n=\{h\.n\}/.test(bt) && /n=\{h\.n\} total/.test(bt) && /n=\{data\.length\}/.test(bt) && /n=\{series\.length\}/.test(bt) && /n=\{total\}/.test(bt));
  t("R4 IndicatorChart states n, the unit and that its axis does not start at zero", /n=\{pts\.length\}/.test(code("IndicatorChart.tsx")) && /does not start at zero/.test(code("IndicatorChart.tsx")));
  t("R4 empty charts say so instead of drawing an empty frame", /EmptyChart what=/.test(bt) && /role="status"/.test(code("IndicatorChart.tsx")));
  t("R5 log axes are labelled: the price chart prints LOG SCALE / PERCENT SCALE", /LOG SCALE/.test(code("PriceChart.tsx")) && /PERCENT SCALE/.test(code("PriceChart.tsx")));
}

// pure helpers: finite, terminating, honest for empty / single / equal / NaN input
{
  t("niceTicks terminates and returns [] for NaN / Infinity / reversed ranges", niceTicks(NaN, 5).length === 0 && niceTicks(-Infinity, 5).length === 0 && niceTicks(0, Infinity).length === 0 && niceTicks(5, 1).length === 0);
  t("niceTicks of a normal range has round values and covers it", (() => { const ts = niceTicks(-3.2, 8.7, 5); return ts.length >= 3 && ts[0] >= -3.2 && ts[ts.length - 1] <= 8.7 + 1e-6; })());
  t("niceTicks of a zero-width range is finite", niceTicks(2, 2).every(Number.isFinite));
  t("niceStep never returns 0 / NaN", [0, -4, NaN, Infinity].every((r) => { const s = niceStep(r, 5); return Number.isFinite(s) && s > 0; }));
  t("finiteNumbers drops null, NaN, Infinity", finiteNumbers([1, null, NaN, Infinity, -Infinity, undefined, 2]).join() === "1,2");
  t("median of empty is NaN, of odd and even sets correct", Number.isNaN(median([])) && median([3, 1, 2]) === 2 && median([4, 1, 2, 3]) === 2.5);

  t("histogram: fewer than 5 finite values gives null (message path)", histogram([1, 2, 3, 4]) === null && histogram([]) === null && histogram([NaN, NaN, NaN, NaN, NaN, 1]) === null);
  const vals = Array.from({ length: 200 }, (_, i) => Math.sin(i) * 7 + (i % 5));
  const h = histogram(vals)!;
  t("histogram: counts are non-negative integers that sum to n (every value in exactly one bucket)", h.counts.every((c) => Number.isInteger(c) && c >= 0) && h.counts.reduce((a, b) => a + b, 0) === 200 && h.n === 200);
  t("histogram: buckets cover the data range", h.e0 <= Math.min(...vals) + 1e-9 && h.e1 >= Math.max(...vals) - 1e-9 && h.e1 > h.e0);
  const same = histogram([2, 2, 2, 2, 2, 2])!;
  t("histogram: all values equal still has a positive-width range and finite buckets", same.e1 > same.e0 && Number.isFinite(same.w) && same.counts.reduce((a, b) => a + b, 0) === 6);
  const dirty = histogram([1, 2, 3, 4, 5, NaN, Infinity, null as any])!;
  t("histogram: NaN and Infinity are dropped, not bucketed", dirty.n === 5 && dirty.counts.reduce((a, b) => a + b, 0) === 5);
  t("histogram: the max value lands in the last bucket, not past it", histogram([0, 1, 2, 3, 4, 10])!.counts.at(-1)! >= 1);

  t("fmtPct signs and N/A", fmtPct(1.234) === "+1.23%" && fmtPct(-0.5, 1) === "-0.5%" && fmtPct(null) === "N/A" && fmtPct(NaN) === "N/A");
  t("fmtPctCompact keeps huge numbers inside a narrow margin (no clipping)", fmtPctCompact(1000000) === "+1.0M%" && fmtPctCompact(-12345) === "-12.3k%" && fmtPctCompact(5.5) === "+5.50%" && fmtPctCompact(1e12).length <= 12 && fmtPctCompact(Infinity) === "N/A");
  t("fmtMoneyCompact: small amounts keep their size, negatives signed", fmtMoneyCompact(400_000) === "$400K" && fmtMoneyCompact(2_500_000) === "$2.5M" && fmtMoneyCompact(1.5e9) === "$1.5B" && fmtMoneyCompact(-3.2e9) === "-$3.2B" && fmtMoneyCompact(0) === "$0" && fmtMoneyCompact(950) === "$950" && fmtMoneyCompact(NaN) === "N/A");
  t("barPercent: zero is zero, largest is 100, junk is 0", barPercent(0, 5) === 0 && barPercent(5, 5) === 100 && barPercent(2.5, 5) === 50 && barPercent(NaN, 5) === 0 && barPercent(-1, 5) === 0 && barPercent(1, 0) === 0 && barPercent(9, 5) === 100);
  t("zeroBasedY puts zero at the bottom and max at the top", zeroBasedY(0, 10, 20, 120) === 120 && zeroBasedY(10, 10, 20, 120) === 20 && zeroBasedY(5, 10, 20, 120) === 70 && zeroBasedY(-3, 10, 20, 120) === 120 && zeroBasedY(NaN, 10, 20, 120) === 120);

  // pie: the cash slice and percentages
  const slices = withCashSlice([{ label: "A", value: 600, percent: 0 }, { label: "B", value: 300, percent: 0 }] as any, 100, 1000);
  t("pie: slices with cash sum to 100%", Math.abs(slices.reduce((a: number, x: any) => a + x.percent, 0) - 100) < 1e-9 && slices.length === 3);
  t("pie: zero grand total gives 0% not NaN", withCashSlice([{ label: "A", value: 0, percent: 0 }] as any, 0, 0).every((x: any) => x.percent === 0));
}

summary();
