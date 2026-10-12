// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/catalyst-calendar.test.mts
// Tests the catalyst calendar: data integrity, the rule-based dates, symbol relevance and the window queries.
import * as C from "../src/lib/agents/trading-agent/skills/catalyst-calendar.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const ev = C.catalystEvents();
const byId = (id: string) => ev.find((e) => e.id === id);
const names = (r: any) => r.events.map((e: any) => e.name);
const ids = (r: any) => r.events.map((e: any) => e.id);

// ---------------------------------------------------------------- integrity
t("event ids are unique", new Set(ev.map((e) => e.id)).size === ev.length);
t("events are sorted by date", ev.every((e, i) => i === 0 || ev[i - 1].date <= e.date));
t("every date is a real YYYY-MM-DD weekday", ev.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !Number.isNaN(Date.parse(e.date)) && C.isWeekday(e.date)), JSON.stringify(ev.filter((e) => !C.isWeekday(e.date)).map((e) => e.id)));
t("every official-schedule event carries an https source link", ev.filter((e) => e.basis === "official-schedule").every((e) => /^https:\/\//.test(e.sourceUrl ?? "")));
t("rule-based events say how the date was worked out", ev.filter((e) => e.basis === "rule").every((e) => !!e.note));
t("no event name or note recommends a trade", !ev.some((e) => /\b(buy|sell short|you should|we recommend|go long|go short)\b/i.test(e.name + " " + (e.note ?? ""))));

// ---------------------------------------------------------------- the official dates read on 12 Oct 2026
const count = (cat: string, region?: string) => ev.filter((e) => e.category === cat && (!region || e.region === region) && e.basis === "official-schedule").length;
t("16 FOMC decisions across 2026 and 2027, 8 each year", ev.filter((e) => e.id.startsWith("fomc-")).length === 16 && ev.filter((e) => e.id.startsWith("fomc-2026")).length === 8);
t("FOMC decision day is the second day of the meeting (28 Oct 2026, not 27)", !!byId("fomc-2026-10-28") && !byId("fomc-2026-10-27"));
t("FOMC meetings with projections are flagged (Mar, Jun, Sep, Dec 2026)", ["2026-03-18", "2026-06-17", "2026-09-16", "2026-12-09"].every((d) => /projections/.test(byId("fomc-" + d).name)) && !/projections/.test(byId("fomc-2026-10-28").name));
t("Bank of England: 8 decisions a year, 5 Nov 2026 and 17 Dec 2026 present", ev.filter((e) => e.id.startsWith("boe-2026")).length === 8 && !!byId("boe-2026-11-05") && !!byId("boe-2026-12-17"));
t("Bank of Japan: 30 Oct 2026 comes with the Outlook Report, 18 Dec 2026 does not", /Outlook Report/.test(byId("boj-2026-10-30").name) && !/Outlook Report/.test(byId("boj-2026-12-18").name));
t("ECB: 29 Oct and 17 Dec 2026 listed, earlier 2026 meetings are not", !!byId("ecb-2026-10-29") && !!byId("ecb-2026-12-17") && ev.filter((e) => e.id.startsWith("ecb-2026")).length === 2);
t("US CPI: 14 Oct 2026 is a Wednesday at 08:30 ET, and 15 releases run to Dec 2027", byId("cpi-2026-10-14")?.time === "08:30 ET" && new Date("2026-10-14T00:00:00Z").getUTCDay() === 3 && ev.filter((e) => e.id.startsWith("cpi-")).length === 15);
t("US jobs reports: first listed 6 Nov 2026, 14 in all", !!byId("jobs-2026-11-06") && ev.filter((e) => e.id.startsWith("jobs-")).length === 14);
t("PPI: 15 Oct, 13 Nov and 15 Dec 2026", ["2026-10-15", "2026-11-13", "2026-12-15"].every((d) => !!byId("ppi-" + d)));
t("US inflation, jobs and FOMC are tagged high impact; BoE, BoJ and ECB medium", byId("cpi-2026-10-14").impact === "high" && byId("jobs-2026-11-06").impact === "high" && byId("fomc-2026-10-28").impact === "high" && byId("boe-2026-11-05").impact === "medium" && byId("boj-2026-10-30").impact === "medium" && byId("ecb-2026-10-29").impact === "medium");
t("NYSE closures: 10 a year, and the two 2026 early closes", ev.filter((e) => e.id.startsWith("nyse-closed-2026")).length === 10 && !!byId("nyse-early-2026-11-27") && !!byId("nyse-early-2026-12-24"));

// ---------------------------------------------------------------- rule-based dates
t("monthly expiration is the third Friday: Oct 2026 = 16th, Sep 2026 = 18th, Dec 2026 = 18th, Mar 2027 = 19th", C.monthlyExpiration(2026, 10) === "2026-10-16" && C.monthlyExpiration(2026, 9) === "2026-09-18" && C.monthlyExpiration(2026, 12) === "2026-12-18" && C.monthlyExpiration(2027, 3) === "2027-03-19");
t("when the third Friday is a market holiday the expiration moves back: Juneteenth 2026 (Fri 19 Jun) -> Thu 18 Jun; observed Juneteenth 2027 (Fri 18 Jun) -> Thu 17 Jun", C.monthlyExpiration(2026, 6) === "2026-06-18" && C.monthlyExpiration(2027, 6) === "2027-06-17");
t("quarter-end months are named quad witching and tagged medium; other months are monthly and low", /quad witching/.test(byId("opex-2026-12-18").name) && byId("opex-2026-12-18").impact === "medium" && /Monthly/.test(byId("opex-2026-10-16").name) && byId("opex-2026-10-16").impact === "low");
t("one expiration per month for 24 months", ev.filter((e) => e.category === "options-expiry").length === 24);
t("US election day: 3 Nov 2026 and 7 Nov 2028, and the 2026 midterms are in the list as high impact", C.electionDay(2026) === "2026-11-03" && C.electionDay(2028) === "2028-11-07" && byId("us-midterm-2026-11-03")?.impact === "high");
t("last weekday of the month: Oct 2026 = Fri 30 (31st is a Saturday), May 2026 = 29th, Jan 2027 = 29th (31st is a Sunday)", C.lastWeekdayOfMonth(2026, 10) === "2026-10-30" && C.lastWeekdayOfMonth(2026, 5) === "2026-05-29" && C.lastWeekdayOfMonth(2027, 1) === "2027-01-29");
t("the month-end entry states the measured effect and that it is not a direction", /20\.5 bps/.test(byId("month-end-2026-10-30").note) && /no reliable direction/.test(byId("month-end-2026-10-30").note) && byId("month-end-2026-10-30").impact === "low");
t("date helpers: days between across a month and a leap day", C.daysBetween("2026-10-12", "2026-11-03") === 22 && C.daysBetween("2028-02-28", "2028-03-01") === 2);

// ---------------------------------------------------------------- symbols
const k = (s: string) => C.classifySymbol(s);
t("symbols are classified: SPY equity, GBP/JPY and gbpjpy forex, BTC-USD and BTC/USD crypto", k("SPY").kind === "us-equity" && k("GBP/JPY").kind === "fx" && JSON.stringify(k("gbpjpy").currencies) === '["GBP","JPY"]' && k("BTC-USD").kind === "crypto" && k("BTC/USD").kind === "crypto");
t("a blank symbol is no symbol, and non-currency pairs are not forex", k("") === null && k("  ") === null && k("ABC/XYZ").kind === "us-equity" && k("USD/USD").kind === "us-equity");

// ---------------------------------------------------------------- windows
const TODAY = "2026-10-12";
const w7 = C.upcomingCatalysts({ days: 7 }, TODAY);
t("a 7-day window from 12 Oct contains CPI (14th), PPI (15th) and the monthly expiration (16th) and nothing later", ids(w7).includes("cpi-2026-10-14") && ids(w7).includes("ppi-2026-10-15") && ids(w7).includes("opex-2026-10-16") && w7.events.every((e) => e.date <= "2026-10-18"), JSON.stringify(ids(w7)));
t("the window reports its own start and end", w7.from === "2026-10-12" && w7.to === "2026-10-18");
t("events carry days away, and CPI is 2 days from 12 Oct", w7.events.find((e) => e.id === "cpi-2026-10-14").daysAway === 2);
t("the last day of the window is included and the next day is not (days=3 reaches the 14th; days=2 stops at the 13th)", ids(C.upcomingCatalysts({ days: 3 }, TODAY)).includes("cpi-2026-10-14") && !ids(C.upcomingCatalysts({ days: 2 }, TODAY)).includes("cpi-2026-10-14"));
t("days is clamped to 1 to 366", C.upcomingCatalysts({ days: 0 }, TODAY).to === "2026-10-12" && C.upcomingCatalysts({ days: 1000 }, TODAY).to === "2027-10-12");
t("an explicit start date overrides today", C.upcomingCatalysts({ from: "2026-11-01", days: 5 }, TODAY).events.some((e) => e.id === "us-midterm-2026-11-03"));
t("minimum impact high keeps only high events", C.upcomingCatalysts({ days: 40, minImpact: "high" }, TODAY).events.every((e) => e.impactForSymbol === "high") && C.upcomingCatalysts({ days: 40, minImpact: "high" }, TODAY).events.length > 3);
t("category filter keeps only that category", C.upcomingCatalysts({ days: 60, categories: ["central-bank"] }, TODAY).events.every((e) => e.category === "central-bank"));

const gj = C.upcomingCatalysts({ symbol: "GBP/JPY", from: "2026-10-26", days: 12 }, TODAY);
t("GBP/JPY shows FOMC, BoJ, BoE and month-end, and no ECB and no options expiration", ["fomc-2026-10-28", "boj-2026-10-30", "boe-2026-11-05", "month-end-2026-10-30"].every((i) => ids(gj).includes(i)) && !ids(gj).includes("ecb-2026-10-29") && !gj.events.some((e) => e.category === "options-expiry"), JSON.stringify(ids(gj)));
t("for GBP/JPY the BoJ and BoE decisions are raised to high impact while the base tag stays medium", gj.events.find((e) => e.id === "boj-2026-10-30").impactForSymbol === "high" && gj.events.find((e) => e.id === "boj-2026-10-30").impact === "medium" && gj.events.find((e) => e.id === "boe-2026-11-05").impactForSymbol === "high");
t("the symbol is echoed back upper-cased", gj.symbol === "GBP/JPY" && C.upcomingCatalysts({ symbol: "gbp/jpy", days: 3 }, TODAY).symbol === "GBP/JPY");
const spy = C.upcomingCatalysts({ symbol: "SPY", from: "2026-10-26", days: 12 }, TODAY);
t("SPY shows FOMC, jobs and the election, and no foreign central banks or month-end flow", ["fomc-2026-10-28", "jobs-2026-11-06", "us-midterm-2026-11-03"].every((i) => ids(spy).includes(i)) && !spy.events.some((e) => ["UK", "JP", "EU"].includes(e.region)), JSON.stringify(ids(spy)));
const btc = C.upcomingCatalysts({ symbol: "BTC-USD", from: "2026-10-12", days: 30 }, TODAY);
t("crypto shows FOMC, CPI, jobs and the election, and no option expirations or market closures", ["fomc-2026-10-28", "cpi-2026-10-14", "jobs-2026-11-06", "us-midterm-2026-11-03"].every((i) => ids(btc).includes(i)) && btc.events.every((e) => ["central-bank", "inflation", "jobs", "election"].includes(e.category)));
t("a EUR/USD pair gets the ECB as high impact and US data", ids(C.upcomingCatalysts({ symbol: "EUR/USD", from: "2026-10-26", days: 6 }, TODAY)).includes("ecb-2026-10-29") && C.upcomingCatalysts({ symbol: "EUR/USD", from: "2026-10-26", days: 6 }, TODAY).events.find((e) => e.id === "ecb-2026-10-29").impactForSymbol === "high");

// ---------------------------------------------------------------- notes and next-event helper
const notes12 = C.upcomingCatalysts({ days: 30 }, TODAY).notes.join(" | ");
t("a window starting 12 Oct warns about the partial ECB, CPI and jobs lists and states the verification date", /ECB meetings before 28 Oct/.test(notes12) && /CPI and PPI releases are listed from 14 Oct/.test(notes12) && /jobs reports are listed from 6 Nov/.test(notes12) && notes12.includes("2026-10-12"), notes12);
t("a window starting in December has no partial-coverage warnings", !/listed from|before 28 Oct/.test(C.upcomingCatalysts({ from: "2026-12-01", days: 30 }, TODAY).notes.join(" ")));
t("running past the end of the list says so", /calendar ends on/.test(C.upcomingCatalysts({ from: "2027-12-20", days: 30 }, TODAY).notes.join(" ")));
t("near the end of the schedules the notes ask for the 2028 releases", /2028/.test(C.upcomingCatalysts({ from: "2027-12-01", days: 5 }, TODAY).notes.join(" ")));
t("next central-bank event after 12 Oct is the FOMC on 28 Oct, next election the midterms, none when nothing is left", C.nextCatalyst("central-bank", TODAY).id === "fomc-2026-10-28" && C.nextCatalyst("central-bank", TODAY).daysAway === 16 && C.nextCatalyst("election", TODAY).id === "us-midterm-2026-11-03" && C.nextCatalyst("election", "2027-01-01") === null);

console.log(bad ? `\n${bad} FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
