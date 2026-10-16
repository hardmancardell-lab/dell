// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/anchored-volume-profile.test.mts
// Offline, hand-checkable checks of the anchored intraday volume profile (no network, no randomness).
import * as P from "../src/lib/agents/trading-agent/skills/anchored-volume-profile.ts";
import { isCryptoSymbol } from "../src/lib/data/coinbase.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

let clock = Date.UTC(2026, 5, 1, 14, 0);
const bar = (low: number, high: number, volume: number, close = (low + high) / 2, datetime = (clock += 300_000)) => ({ datetime, open: low, high, low, close, volume });
/** A zero-range bar: its whole volume lands in the bin holding `price`. */
const flat = (price: number, volume: number) => bar(price, price, volume, price);

// ---------------------------------------------------------------- one bar spreads evenly
{
  const p = P.buildProfile([bar(100, 102, 1000)], { binCount: 4 });
  t("single bar: 4 bins of 0.5, 250 each", p.bins.length === 4 && p.binWidth === 0.5 && p.bins.every((b) => near(b.volume, 250)), JSON.stringify(p.bins));
  t("single bar: volumes sum to the bar volume", near(sum(p.bins.map((b) => b.volume)), 1000) && p.totalVolume === 1000);
  t("single bar: bin edges tile the range exactly", p.bins[0].priceLow === 100 && p.bins[3].priceHigh === 102 && p.bins.every((b, i) => i === 0 || b.priceLow === p.bins[i - 1].priceHigh));
}
{
  // a bar that straddles bins unevenly: 100.25..101.25 across width-0.5 bins -> 0.25/1, 0.5/1, 0.25/1 of the volume
  const p = P.buildProfile([bar(100.25, 101.25, 400)], { binWidth: 0.5 });
  t("uneven straddle: 100/400 in the first bin, 200 in the middle", p.bins.length === 3 && near(p.bins[0].volume, 100) && near(p.bins[1].volume, 200) && near(p.bins[2].volume, 100), JSON.stringify(p.bins.map((b) => b.volume)));
}
{
  const p = P.buildProfile([bar(100, 101, 1000, 100.9)], { binCount: 10, volumeAllocation: "close-weighted", closeWeight: 0.5 });
  const top = p.bins[p.bins.length - 1].volume;
  t("close-weighted: half on the close bin, rest even (500 + 50)", near(top, 550) && near(p.bins[0].volume, 50) && near(p.totalVolume, 1000), `${top} ${p.bins[0].volume}`);
}
{
  const p = P.buildProfile([bar(100, 100.05, 600)], { binCount: 60 });
  t("tick-aware: width never drops below one tick even when range/N is smaller", p.binWidth === 0.01 && p.bins.length === 5, `${p.binWidth} ${p.bins.length}`);
  const q = P.buildProfile([bar(100, 106, 600)], { binCount: 60 });
  t("tick-aware: width is a whole number of ticks (range/N = 0.1)", near(q.binWidth, 0.1) && q.bins.length === 60, `${q.binWidth} ${q.bins.length}`);
}

// ---------------------------------------------------------------- POC, value area (hand-checked)
{
  // bins of width 1 starting at 100: volumes 5,10,40,25,10,5,5 (total 100)
  const vols = [5, 10, 40, 25, 10, 5, 5];
  const p = P.buildProfile(vols.map((v, i) => flat(100.5 + i, v)), { binWidth: 1 });
  t("hand profile: seven bins with the planned volumes", p.bins.length === 7 && p.bins.every((b, i) => near(b.volume, vols[i])), JSON.stringify(p.bins.map((b) => b.volume)));
  t("POC is the maximum bin (101.5 .. 102.5, mid 102.5)", p.poc.binIndex === 2 && p.poc.price === 102.5 && p.poc.volume === 40, JSON.stringify(p.poc));
  // from the POC (40): up pair 25+10=35 beats down pair 10+5=15 -> add bins 3,4 -> 75 >= 70
  const va = p.valueArea;
  t("value area: expands up by the larger pair, bins 2..4, 75% of volume", va.lowBinIndex === 2 && va.highBinIndex === 4 && near(va.coverage, 0.75), JSON.stringify(va));
  t("value area: VAL = lower edge of bin 2, VAH = upper edge of bin 4", va.val === 102 && va.vah === 105, `${va.val} ${va.vah}`);
}
{
  // a deterministic pseudo-random profile: value area still covers >= 70%, is contiguous, contains the POC
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const bars = Array.from({ length: 200 }, () => {
    const c = 100 + rnd() * 10;
    return bar(c - rnd(), c + rnd(), 1000 + Math.floor(rnd() * 9000));
  });
  const p = P.buildProfile(bars);
  const va = p.valueArea;
  const covered = sum(p.bins.slice(va.lowBinIndex, va.highBinIndex + 1).map((b) => b.volume));
  t("value area covers >= 70% of total volume", covered / p.totalVolume >= 0.7 - 1e-9 && near(covered, va.volume, 1e-6), String(covered / p.totalVolume));
  t("value area is a contiguous run of bins that includes the POC", va.lowBinIndex <= p.poc.binIndex && p.poc.binIndex <= va.highBinIndex && near(va.val, p.bins[va.lowBinIndex].priceLow) && near(va.vah, p.bins[va.highBinIndex].priceHigh));
  t("POC volume equals the largest bin", p.poc.volume === Math.max(...p.bins.map((b) => b.volume)));
  t("volumes sum to total volume", near(sum(p.bins.map((b) => b.volume)), sum(bars.map((b) => b.volume)), 1e-6));
  t("deterministic: identical input, identical output", JSON.stringify(P.buildProfile(bars)) === JSON.stringify(p));
  const p80 = P.buildProfile(bars, { valueAreaFraction: 0.8 });
  t("a larger value-area fraction never gives a smaller area", p80.valueArea.vah - p80.valueArea.val >= va.vah - va.val);
}

// ---------------------------------------------------------------- nodes
{
  // two volume clusters with a thin gap: ~5 bars at 100-101 (1000 each), ~5 bars at 110-111 (600 each)
  const bars = [];
  for (let i = 0; i < 5; i++) bars.push(bar(100, 101, 1000), bar(110, 111, 600));
  bars.push(bar(101, 110, 90)); // a little volume in the gap
  const p = P.buildProfile(bars);
  t("two clusters: two prominent peaks", p.peaks.length === 2, `peaks ${p.peaks.map((n) => n.price)}`);
  t("two clusters: POC sits in the bigger (lower) cluster and is left out of hvns", p.poc.price >= 100 && p.poc.price <= 101 && p.hvns.length === 1 && p.hvns[0].price >= 110 && p.hvns[0].price <= 111, JSON.stringify(p.hvns.map((n) => n.price)));
  t("two clusters: exactly one LVN, in the gap between them", p.lvns.length === 1 && p.lvns[0].price > 101 && p.lvns[0].price < 110, JSON.stringify(p.lvns.map((n) => n.price)));
  t("LVN has far less volume than either peak", p.lvns[0].smoothedVolume < 0.25 * Math.min(...p.peaks.map((n) => n.smoothedVolume)));
  t("node bands bracket their price", [...p.peaks, ...p.lvns].every((n) => n.bandLow <= n.price && n.price <= n.bandHigh));
  const levels = P.listLevels(p);
  t("level list: POC, VAH, VAL, 1 HVN, 1 LVN, sorted high to low", levels.length === 5 && ["POC", "VAH", "VAL", "HVN", "LVN"].every((k) => levels.some((l) => l.type === k)) && levels.every((l, i) => i === 0 || levels[i - 1].price >= l.price));
}
{
  // sigma 0 so the smoothed curve is the raw one: big hill (20 at index 3), small bump (3 at index 7, prominence 2 = 10% of 20)
  const vols = [1, 4, 10, 20, 10, 4, 1, 3, 1, 0.5];
  const bars = vols.map((v, i) => flat(100.5 + i, v));
  const strict = P.buildProfile(bars, { binWidth: 1, smoothingSigmaBins: 0 });
  t("prominence 15%: the small bump is not a node", strict.peaks.length === 1 && strict.hvns.length === 0 && strict.lvns.length === 0, JSON.stringify(strict.peaks.map((n) => n.binIndex)));
  const loose = P.buildProfile(bars, { binWidth: 1, smoothingSigmaBins: 0, prominenceFraction: 0.05 });
  t("prominence 5%: the same bump now counts, with an LVN between", loose.peaks.length === 2 && loose.hvns.length === 1 && loose.hvns[0].binIndex === 7 && loose.lvns.length === 1 && loose.lvns[0].binIndex === 6 && near(loose.hvns[0].prominence, 2), JSON.stringify(loose.peaks.map((n) => [n.binIndex, n.prominence])));
}
{
  const flatProfile = P.buildProfile([flat(100.5, 10), flat(101.5, 10), flat(102.5, 10), flat(103.5, 10)], { binWidth: 1 });
  t("a flat profile has no nodes and a tie-broken POC", flatProfile.peaks.length === 0 && flatProfile.lvns.length === 0 && flatProfile.poc !== null && flatProfile.poc.binIndex >= 1 && flatProfile.poc.binIndex <= 2);
  const one = P.buildProfile([flat(100, 50)]);
  t("one price only: one bin, POC and value area on it", one.bins.length === 1 && one.poc.price > 99.99 && one.valueArea.coverage === 1);
}

// ---------------------------------------------------------------- empty and bad input
{
  let ok = true;
  const cases = [[], null, undefined, [{ datetime: 1, open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN }], [bar(100, 101, 0)], [{ datetime: 1, open: 1, high: 1, low: 2, close: 1, volume: 5 }]];
  for (const c of cases) {
    try {
      const p = P.buildProfile(c);
      if (p.poc !== null && p.totalVolume === 0) ok = false;
      P.listLevels(p);
    } catch {
      ok = false;
    }
  }
  t("empty, null, NaN, zero-volume and inverted-range input never throw and give no POC", ok);
  const e = P.buildProfile([]);
  t("empty profile shape", e.bins.length === 0 && e.totalVolume === 0 && e.poc === null && e.valueArea === null && e.hvns.length === 0 && P.listLevels(e).length === 0);
  const sel = P.selectAnchoredCandles([], { kind: "session" });
  t("anchoring empty data gives no bars and an explanatory label", sel.candles.length === 0 && sel.anchor.label.length > 0 && P.buildAnchoredProfile([], { kind: "multiDay", sessions: 3 }).poc === null);
}

// ---------------------------------------------------------------- session anchors respect ET open/close across DST
/** 5-minute bars every five minutes between two UTC instants, price drifting so ranges differ per day. */
function bars5(fromMs: number, toMs: number, base: number) {
  const out = [];
  for (let ms = fromMs; ms < toMs; ms += 300_000) out.push({ datetime: ms, open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 100 });
  return out;
}
{
  // US DST began Sunday 2026-03-08. Fri 03-06 is EST (UTC-5), Mon 03-09 is EDT (UTC-4). Bars 08:00Z-23:55Z cover pre/post market.
  const fri = bars5(Date.UTC(2026, 2, 6, 8), Date.UTC(2026, 2, 7, 0), 100);
  const mon = bars5(Date.UTC(2026, 2, 9, 8), Date.UTC(2026, 2, 10, 0), 110);
  const all = [...mon, ...fri]; // deliberately out of order
  const sMon = P.selectAnchoredCandles(all, { kind: "session" });
  t("latest session is Mon 03-09 with 78 regular-hours bars", sMon.anchor.sessions[0] === "2026-03-09" && sMon.candles.length === 78, `${sMon.anchor.sessions} ${sMon.candles.length}`);
  t("Mon (EDT) opens 13:30Z and its last bar starts 19:55Z", sMon.candles[0].datetime === Date.UTC(2026, 2, 9, 13, 30) && sMon.candles[77].datetime === Date.UTC(2026, 2, 9, 19, 55), `${new Date(sMon.candles[0].datetime).toISOString()}`);
  const sFri = P.selectAnchoredCandles(all, { kind: "session", date: "2026-03-06" });
  t("Fri (EST) opens 14:30Z and its last bar starts 20:55Z", sFri.candles.length === 78 && sFri.candles[0].datetime === Date.UTC(2026, 2, 6, 14, 30) && sFri.candles[77].datetime === Date.UTC(2026, 2, 6, 20, 55), `${new Date(sFri.candles[0].datetime).toISOString()}`);
  const prev = P.selectAnchoredCandles(all, { kind: "previousSession" });
  t("previousSession from Mon is Fri (the weekend has no data)", prev.anchor.sessions[0] === "2026-03-06" && prev.candles.length === 78);
  t("previousSession with only one session is empty", P.selectAnchoredCandles(fri, { kind: "previousSession" }).candles.length === 0);
  const multi = P.selectAnchoredCandles(all, { kind: "multiDay", sessions: 2 });
  t("multiDay 2 covers both sessions, oldest first, 156 bars", multi.anchor.sessions.join() === "2026-03-06,2026-03-09" && multi.candles.length === 156 && multi.candles[0].datetime < multi.candles[155].datetime);
  t("multiDay 1 is just the latest session", P.selectAnchoredCandles(all, { kind: "multiDay", sessions: 1 }).candles.length === 78);
  const fromDate = P.selectAnchoredCandles(all, { kind: "fromDate", date: "2026-03-07" });
  t("fromDate on a weekend starts at the next session's open", fromDate.anchor.sessions[0] === "2026-03-09" && fromDate.candles[0].datetime === Date.UTC(2026, 2, 9, 13, 30));
  const fromTs = P.selectAnchoredCandles(all, { kind: "fromTimestamp", timestampMs: Date.UTC(2026, 2, 9, 15, 0) });
  t("fromTimestamp keeps regular-hours bars from that instant to the end", fromTs.candles[0].datetime === Date.UTC(2026, 2, 9, 15, 0) && fromTs.candles.length === 60, String(fromTs.candles.length));
  const ext = P.selectAnchoredCandles(all, { kind: "session" }, { includeExtendedHours: true });
  t("includeExtendedHours keeps pre/post-market bars of the ET date", ext.candles.length > 78);
  // the profile is built from the anchored bars only (Mon ranges 109.5-110.5; Fri 99.5-100.5)
  const prof = P.buildAnchoredProfile(all, { kind: "previousSession" });
  t("profile uses only the anchored session's bars (no look-ahead into Monday)", prof.high <= 100.5 + 1e-9 && prof.low >= 99.5 - 1e-9 && prof.barCount === 78 && near(prof.totalVolume, 7800));
  // fall back: Sunday 2026-11-01. Fri 10-30 is EDT, Mon 11-02 is EST.
  const fallA = bars5(Date.UTC(2026, 9, 30, 8), Date.UTC(2026, 9, 31, 0), 100);
  const fallB = bars5(Date.UTC(2026, 10, 2, 8), Date.UTC(2026, 10, 3, 0), 100);
  const fa = P.selectAnchoredCandles([...fallA, ...fallB], { kind: "session", date: "2026-10-30" });
  const fb = P.selectAnchoredCandles([...fallA, ...fallB], { kind: "session", date: "2026-11-02" });
  t("fall-back: EDT Fri opens 13:30Z, EST Mon opens 14:30Z", fa.candles[0].datetime === Date.UTC(2026, 9, 30, 13, 30) && fb.candles[0].datetime === Date.UTC(2026, 10, 2, 14, 30) && fa.candles.length === 78 && fb.candles.length === 78);
}

// ---------------------------------------------------------------- crypto uses UTC days
{
  const d1 = bars5(Date.UTC(2026, 9, 1, 0), Date.UTC(2026, 9, 2, 0), 60000);
  const d2 = bars5(Date.UTC(2026, 9, 2, 0), Date.UTC(2026, 9, 3, 0), 61000);
  const all = [...d1, ...d2];
  const utc = P.selectAnchoredCandles(all, { kind: "previousSession" }, { calendar: "utc" });
  t("crypto: the previous 'session' is the whole previous UTC day (288 five-minute bars)", utc.anchor.sessions[0] === "2026-10-01" && utc.candles.length === 288 && utc.candles[0].datetime === Date.UTC(2026, 9, 1, 0, 0) && utc.candles[287].datetime === Date.UTC(2026, 9, 1, 23, 55) && utc.anchor.calendar === "utc");
  const et = P.selectAnchoredCandles(all, { kind: "previousSession" }, { calendar: "et" });
  t("the same bars under the ET calendar are regular hours only (78)", et.candles.length === 78 || et.candles.length === 0);
  t("calendarForSymbol agrees with coinbase isCryptoSymbol", ["BTC-USD", "eth-usd", "SPY", "EUR/USD", "BRK.B", "SOL-USD", "AAPL"].every((s) => (P.calendarForSymbol(s) === "utc") === isCryptoSymbol(s)));
  t("date keys validate", P.isDateKey("2026-03-09") && !P.isDateKey("2026-3-9") && !P.isDateKey("2026-13-40") && !P.isDateKey("abc"));
}

console.log(bad === 0 ? "\nALL PASS" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
