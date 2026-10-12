// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/crypto-regime.test.mts
// Tests the crypto regime score, its input helpers, the Farside parser, the keyless adapters (fake fetch) and the
// acceptance check against the Crypto Research Desk dashboard's own data files from 11 Oct 2026.
import { readFileSync } from "node:fs";
import * as R from "../src/lib/agents/trading-agent/skills/crypto-regime.ts";
import { createCryptoPublic } from "../src/lib/data/crypto-public.ts";
import { getCryptoRegime } from "../src/lib/agents/trading-agent/skills/crypto-regime-service.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const fx = (f: string) => readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8");
const json = (f: string) => JSON.parse(fx(f));

// every condition met
const ALL_MET = { stablecoinChange30d: 0.03, etfFlowsMtdMusd: 500, btcDominance: 0.5, btcClose: 100, btcSma200: 90, us10yPct: 4.2, fearGreed: 60 };
const keys = (r) => r.checks.map((c) => c.key + ":" + c.status).join(" ");

// ---------------------------------------------------------------- scoring
const all = R.scoreCryptoRegime(ALL_MET);
t("all six met scores 6 and calls a breakout", all.met === 6 && all.total === 6 && all.label === "breakout" && all.unavailable === 0, keys(all));
t("the six conditions are in the dashboard's order", all.checks.map((c) => c.key).join(",") === "stablecoin-supply,etf-flows,btc-dominance,btc-200d,us10y,fear-greed");
// strict thresholds: a reading exactly on the line is not met
const edge = R.scoreCryptoRegime({ stablecoinChange30d: 0.02, etfFlowsMtdMusd: 0, btcDominance: 0.55, btcClose: 90, btcSma200: 90, us10yPct: 5.0, fearGreed: 80 });
t("readings exactly on every threshold are all 'not met' (the dashboard uses strict comparisons)", edge.met === 0 && edge.notMet === 6, keys(edge));
const justInside = R.scoreCryptoRegime({ stablecoinChange30d: 0.0201, etfFlowsMtdMusd: 0.1, btcDominance: 0.5499, btcClose: 90.01, btcSma200: 90, us10yPct: 4.99, fearGreed: 79 });
t("readings just inside every threshold are all 'met'", justInside.met === 6, keys(justInside));
// labels
const withMet = (n: number) => R.scoreCryptoRegime({ ...ALL_MET, ...[{ stablecoinChange30d: 0 }, { etfFlowsMtdMusd: -1 }, { btcDominance: 0.6 }, { btcClose: 80 }, { us10yPct: 5.5 }, { fearGreed: 90 }].slice(0, 6 - n).reduce((a, b) => ({ ...a, ...b }), {}) });
t("4 met = breakout, 3 = mixed, 2 = range-bound, 0 = range-bound", withMet(4).label === "breakout" && withMet(3).label === "mixed" && withMet(2).label === "range-bound" && withMet(0).label === "range-bound" && withMet(5).label === "breakout" && withMet(4).met === 4 && withMet(3).met === 3);
t("the verdict text matches the dashboard's wording", /^Conditions favor a breakout: 4 of 6/.test(withMet(4).verdict) && /^Mixed: the range is under pressure: 3 of 6/.test(withMet(3).verdict) && /^Range-bound regime holds: 2 of 6/.test(withMet(2).verdict), withMet(3).verdict);
// missing data
const miss1 = R.scoreCryptoRegime({ ...ALL_MET, etfFlowsMtdMusd: null });
t("a missing input is 'unavailable' and never counts as met", miss1.checks[1].status === "unavailable" && miss1.met === 5 && miss1.unavailable === 1 && miss1.label === "breakout");
const miss2 = R.scoreCryptoRegime({ ...ALL_MET, stablecoinChange30d: 0, etfFlowsMtdMusd: null, btcDominance: null, btcClose: 80 });
t("when the label depends on what is missing the read says 'undetermined' with the possible range", miss2.met === 2 && miss2.unavailable === 2 && miss2.label === "undetermined" && miss2.labelRange.lowest === "range-bound" && miss2.labelRange.highest === "breakout" && /Undetermined/.test(miss2.verdict), JSON.stringify(miss2.labelRange));
const miss3 = R.scoreCryptoRegime({ stablecoinChange30d: 0, etfFlowsMtdMusd: -5, btcDominance: 0.6, btcClose: 80, btcSma200: 90, us10yPct: null, fearGreed: null });
t("0 met with 2 unavailable is still range-bound (even both missing would only make 2)", miss3.label === "range-bound" && miss3.unavailable === 2);
t("with no data at all the read is undetermined, not 'range-bound'", R.scoreCryptoRegime({ stablecoinChange30d: null, etfFlowsMtdMusd: null, btcDominance: null, btcClose: null, btcSma200: null, us10yPct: null, fearGreed: null }).label === "undetermined");
t("BTC vs its average is reported as a ratio", near(all.checks[3].reading, 100 / 90 - 1, 1e-12) && all.checks[3].unit === "ratio-to-average");
t("non-finite readings are unavailable", R.scoreCryptoRegime({ ...ALL_MET, fearGreed: NaN }).checks[5].status === "unavailable");

// ---------------------------------------------------------------- input helpers
t("sma averages the last n values and is null with fewer than n", R.sma([1, 2, 3, 4, 5], 3) === 4 && R.sma([1, 2], 3) === null && R.sma([1, 2, 3], 0) === null);
t("seriesChange uses the entry 'lookback' places before the last (31st from the end for 30 days)", near(R.seriesChange([...Array(40).keys()].map((i) => 100 + i), 30), 139 / 109 - 1) && R.seriesChange([1, 2, 3], 30) === null && R.seriesChange([0, ...Array(30).fill(5)], 30) === null);

// ---------------------------------------------------------------- Farside parser, on the real table saved 12 Oct 2026
const rows = R.parseFarsideTotals(fx("farside_btc_table_2026-10-12.html"));
t("the Farside table parses to dated daily totals, oldest first", rows.length >= 10 && rows[0].day < rows[rows.length - 1].day && rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day)), `${rows.length} rows`);
const byDay = Object.fromEntries(rows.map((r) => [r.day, r.flowMusd]));
t("bracketed numbers are negative, others positive: 7 Oct -484.9, 2 Oct +189.9, 30 Sep -148.7", byDay["2026-10-07"] === -484.9 && byDay["2026-10-02"] === 189.9 && byDay["2026-09-30"] === -148.7, JSON.stringify([byDay["2026-10-07"], byDay["2026-10-02"], byDay["2026-09-30"]]));
t("summary rows (Total, Average, Maximum, Minimum) and the fee row are not read as days", !rows.some((r) => r.flowMusd === 57178 || r.flowMusd === 83.0));
const mtd = R.monthToDateFlows(rows, "2026-10");
t("October 2026 month to date is -386.3 over 7 trading days, through 9 Oct", mtd && near(mtd.totalMusd, -386.3, 1e-6) && mtd.days === 7 && mtd.lastDay === "2026-10-09", JSON.stringify(mtd));
t("the dashboard's hand-fed ETF file sums to the same number", near(json("crypto_desk_2026-10-11/etf_flows.json").reduce((s, r) => s + r.flow_musd, 0), mtd.totalMusd, 1e-6));
t("a month with no posted days gives null, not zero", R.monthToDateFlows(rows, "2026-11") === null);
t("an unrecognised page gives no rows", R.parseFarsideTotals("<html><body>Just a moment...</body></html>").length === 0 && R.parseFarsideTotals("").length === 0);

// ---------------------------------------------------------------- acceptance: the dashboard's own data from 11 Oct 2026 (handoff: 2 of 6)
{
  const regime = json("crypto_desk_2026-10-11/regime.json"), macro = json("crypto_desk_2026-10-11/macro.json");
  const btc = json("crypto_desk_2026-10-11/btc_daily.json").map((r) => r.close), stables = json("crypto_desk_2026-10-11/stables_daily.json").map((r) => r.supply);
  const get = (k) => regime.find((x) => x.key === k);
  const inputs = {
    stablecoinChange30d: R.seriesChange(stables, 30),
    etfFlowsMtdMusd: json("crypto_desk_2026-10-11/etf_flows.json").reduce((s, r) => s + r.flow_musd, 0),
    btcDominance: get("btc_dominance").value,
    btcClose: btc[btc.length - 1],
    btcSma200: R.sma(btc, 200),
    us10yPct: macro.find((x) => x.key === "us10y").value,
    fearGreed: get("fear_greed").value,
  };
  const res = R.scoreCryptoRegime(inputs);
  t("acceptance: my stablecoin 30-day change equals the dashboard's own figure (to its 4 decimals)", near(inputs.stablecoinChange30d, get("stablecoin_supply").change, 6e-5), `${inputs.stablecoinChange30d} vs ${get("stablecoin_supply").change}`);
  t("acceptance: 11 Oct 2026 scores 2 of 6", res.met === 2 && res.label === "range-bound", keys(res));
  t("acceptance: the two met are BTC above its 200-day average and Fear & Greed below 80; the other four are not met", res.checks.filter((c) => c.status === "met").map((c) => c.key).sort().join() === "btc-200d,fear-greed" && res.checks.filter((c) => c.status === "not-met").length === 4, keys(res));
  t("acceptance: BTC 83,595 against a 200-day average of about 71,914 (+16%)", inputs.btcClose === 83595 && near(inputs.btcSma200, 71913.63, 0.01) && near(res.checks[3].reading, 83595 / 71913.63 - 1, 1e-6));
}

// ---------------------------------------------------------------- adapters against a fake fetch
const DAY = 86400000;
function fakeWorld(over: Record<string, any> = {}) {
  const calls: { url: string; at: number }[] = [];
  let clock = Date.UTC(2026, 9, 12, 12, 0);
  const prices = Array.from({ length: 366 }, (_, i) => [clock - (365 - i) * DAY, 60000 + i * 100]);
  const stable = Array.from({ length: 60 }, (_, i) => ({ date: String(Math.floor((clock - (59 - i) * DAY) / 1000)), totalCirculatingUSD: { peggedUSD: 300e9 + i * 0.05e9 } }));
  const table = fx("farside_btc_table_2026-10-12.html");
  const routes: Record<string, () => any> = {
    "coingecko.com/api/v3/global": () => ({ data: { market_cap_percentage: { btc: 59.5 }, updated_at: Math.floor(clock / 1000) } }),
    "market_chart": () => ({ prices }),
    "stablecoincharts": () => stable,
    "alternative.me/fng": () => ({ data: [{ value: "69", timestamp: String(Math.floor(clock / 1000)) }] }),
    "%5ETNX": () => ({ chart: { result: [{ meta: { regularMarketPrice: 5.244, regularMarketTime: Math.floor(clock / 1000) } }] } }),
    "farside.co.uk": () => table,
    ...over,
  };
  const fetchImpl = async (url: string) => {
    calls.push({ url, at: clock });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    const r = routes[key]();
    if (r && r.__status) return { ok: false, status: r.__status, json: async () => ({}), text: async () => "" };
    return { ok: true, status: 200, json: async () => r, text: async () => (typeof r === "string" ? r : JSON.stringify(r)) };
  };
  const sleep = async (ms: number) => { clock += ms; };
  return { calls, deps: { fetchImpl, sleep, now: () => clock }, advance: (ms: number) => { clock += ms; } };
}

{
  const w = fakeWorld(); const api = createCryptoPublic(w.deps);
  const d = await api.btcDominance();
  t("adapter: CoinGecko dominance is returned as a fraction", d.ok && near(d.value, 0.595, 1e-9), JSON.stringify(d));
  const c = await api.btcDailyCloses();
  t("adapter: BTC daily closes are one per day, oldest first, with the last day named", c.ok && c.value.closes.length === 366 && c.value.closes[0] < c.value.closes[365] && c.value.lastDay === "2026-10-12", JSON.stringify(c.ok ? c.value.lastDay : c));
  const cg = w.calls.filter((x) => x.url.includes("coingecko.com"));
  t("adapter: the two CoinGecko calls are at least 3 seconds apart", cg.length === 2 && cg[1].at - cg[0].at >= 3000, JSON.stringify(cg.map((x) => x.at)));
  const s = await api.stablecoinSupply();
  t("adapter: DefiLlama returns the last 40 daily supply totals", s.ok && s.value.supply.length === 40 && s.value.supply[39] > s.value.supply[0]);
  const f = await api.fearGreed();
  t("adapter: Fear & Greed is a number", f.ok && f.value === 69);
  const y = await api.us10y();
  t("adapter: the 10-year yield is read in percent from ^TNX", y.ok && y.value === 5.244);
  const e = await api.etfFlowsMonthToDate();
  t("adapter: ETF flows month to date for October 2026 is -386.3 over 7 days", e.ok && near(e.value.totalMusd, -386.3, 1e-6) && e.value.days === 7, JSON.stringify(e));
  const before = w.calls.length; await api.fearGreed(); await api.us10y(); await api.btcDominance();
  t("adapter: repeat calls within 15 minutes come from the cache (no new requests)", w.calls.length === before);
  w.advance(16 * 60 * 1000); await api.fearGreed();
  t("adapter: after 15 minutes the cache is refreshed", w.calls.length === before + 1);
}
{
  // retry with backoff on 429, then success
  let n = 0; const w = fakeWorld({ "alternative.me/fng": () => (++n < 3 ? { __status: 429 } : { data: [{ value: "55", timestamp: "1791763200" }] }) });
  const f = await createCryptoPublic(w.deps).fearGreed();
  t("adapter: a 429 is retried with backoff and then succeeds", f.ok && f.value === 55 && n === 3, JSON.stringify(f));
  const w2 = fakeWorld({ "alternative.me/fng": () => ({ __status: 404 }) });
  const f2 = await createCryptoPublic(w2.deps).fearGreed();
  t("adapter: a 404 is reported as a failure without endless retries", !f2.ok && /404/.test(f2.error) && w2.calls.filter((c) => c.url.includes("fng")).length === 1, JSON.stringify(f2));
  const w3 = fakeWorld({ "farside.co.uk": () => "<html>Just a moment...</html>" });
  const f3 = await createCryptoPublic(w3.deps).etfFlowsMonthToDate();
  t("adapter: an unrecognised Farside page is a failure that says the layout changed", !f3.ok && /layout was not recognised/.test(f3.error), JSON.stringify(f3));
  const w4 = fakeWorld({ "%5ETNX": () => ({ chart: { result: [{ meta: { regularMarketPrice: 5244 } }] } }) });
  t("adapter: an implausible yield is rejected, not trusted", !(await createCryptoPublic(w4.deps).us10y()).ok);
}

// ---------------------------------------------------------------- the full read
{
  const w = fakeWorld(); const api = createCryptoPublic(w.deps);
  const res = await getCryptoRegime({ now: w.deps.now }, api);
  const c = Object.fromEntries(res.regime.checks.map((x) => [x.key, x.status]));
  t("service: all six sources read, the 12 Oct 2026 world scores 2 of 6 (BTC above its average and Fear & Greed 69 met)", res.regime.met === 2 && res.regime.unavailable === 0 && c["btc-200d"] === "met" && c["fear-greed"] === "met" && c["btc-dominance"] === "not-met" && c["etf-flows"] === "not-met" && c["us10y"] === "not-met", JSON.stringify(c));
  t("service: result carries the method version, a timestamp, the inputs and one status row per source", res.methodVersion === "crypto-regime-v1" && res.asOf === "2026-10-12T" + res.asOf.slice(11) && res.sources.length === 6 && res.sources.every((s) => s.status === "ok"), JSON.stringify(res.sources.map((s) => s.status)));
  t("service: states plainly that it is not advice and that the app has no crypto signals to gate", res.dataLimitations.some((x) => /not investment advice/.test(x)) && res.dataLimitations.some((x) => /no crypto trading signals/.test(x)));
}
{
  const w = fakeWorld({ "farside.co.uk": () => ({ __status: 403 }), "%5ETNX": () => ({ __status: 500 }) });
  const res = await getCryptoRegime({ now: w.deps.now }, createCryptoPublic(w.deps));
  t("service: two failed sources leave two conditions unavailable, the read still comes back, and the failures are listed", res.regime.unavailable === 2 && res.sources.filter((s) => s.status === "error").length === 2 && res.dataLimitations[0].startsWith("2 source(s) could not be read"), JSON.stringify(res.sources.map((s) => s.status)));
  t("service: an unavailable condition never counts as met", res.regime.checks.filter((c) => c.status === "unavailable").every((c) => c.reading === null));
  const typed = await getCryptoRegime({ now: w.deps.now, etfFlowsMtdMusd: 250 }, createCryptoPublic(fakeWorld({ "farside.co.uk": () => ({ __status: 403 }) }).deps));
  t("service: ETF flows typed in by the user are used instead of the scraped table and labelled as entered by the user", typed.inputs.etfFlowsMtdMusd === 250 && typed.regime.checks[1].status === "met" && typed.sources[1].status === "typed-in" && typed.sources[1].source === "Entered by you");
}

console.log(bad ? `\n${bad} FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
