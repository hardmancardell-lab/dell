// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/navigation-state.test.mts
// URL state, deep links, the reducer behind Back/Forward, fuzzy search and pinned/recent storage (all pure code).
import { buildNavQuery, parseNavQuery, navReducer, sameNav } from "../../src/lib/navigation/nav-state.ts";
import { resolveStudyRoute, resolveTickerRoute, resolveGlobalStudyRoute, inferAssetClass } from "../../src/lib/navigation/study-routes.ts";
import { STUDIES, getStudy, resolveStudyRender } from "../../src/lib/navigation/study-registry.ts";
import { fuzzyScore, fuzzyRank } from "../../src/lib/navigation/fuzzy.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HELP_VIDEOS } from "../../src/lib/agents/help-videos.ts";
import { PRIMARY_TABS, SECONDARY_TABS } from "../../src/lib/navigation/trading-structure.ts";
import { buildPaletteItems, searchPalette, itemsForKeys, typedTickerItem } from "../../src/lib/navigation/palette-items.ts";
import { EMPTY_PREFS, parsePrefs, pushRecent, togglePin, serializePrefs, MAX_RECENTS, MAX_PINS } from "../../src/lib/navigation/study-prefs.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "\n  " + detail); };
const q = (s: string) => JSON.stringify(parseNavQuery(s));

// ---------------------------------------------------------------- URL parsing and building
t("empty URL is the default state", q("") === "{}", q(""));
t("agent only", q("?agent=trading") === '{"primaryId":"trading"}', q("?agent=trading"));
t("existing wizard/Assistant target survives a round trip", buildNavQuery(parseNavQuery("?agent=trading&section=paper-trading")) === "agent=trading&section=paper-trading", "");
t("research agent secondary tab is addressable", q("?agent=top-down&section=security") === '{"primaryId":"top-down","secondaryId":"security"}', q("?agent=top-down&section=security"));
t("portfolio secondary tab is addressable", q("?agent=portfolio&section=rebalancing") === '{"primaryId":"portfolio","secondaryId":"rebalancing"}', "");
t("short form: study + ticker routes to the Equities Studies tab", q("?agent=trading&study=backtest&ticker=aapl") === '{"primaryId":"trading","secondaryId":"equities","tab":"studies","studyId":"backtest","ticker":"AAPL"}', q("?agent=trading&study=backtest&ticker=aapl"));
t("short form: study with a class routes to that class's group", /"secondaryId":"currency"/.test(q("?agent=trading&study=backtest&class=forex&ticker=EUR/USD")), q("?agent=trading&study=backtest&class=forex&ticker=EUR/USD"));
t("short form: a study that is a direct tab opens that tab", q("?agent=trading&study=dashboard&class=bond") === '{"primaryId":"trading","secondaryId":"bonds","tab":"dashboard"}', q("?agent=trading&study=dashboard&class=bond"));
t("short form: ticker alone opens its chart (crypto inferred)", q("?agent=trading&ticker=BTC-USD") === '{"primaryId":"trading","secondaryId":"crypto","tab":"charts","ticker":"BTC-USD"}', q("?agent=trading&ticker=BTC-USD"));
t("trading-wide tool opens its own tab", q("?agent=trading&study=paper-trading") === '{"primaryId":"trading","secondaryId":"paper-trading"}', q("?agent=trading&study=paper-trading"));
t("global Studies section keeps study and class", q("?agent=trading&section=studies&study=orb&class=forex") === '{"primaryId":"trading","secondaryId":"studies","studyId":"orb","assetClass":"forex"}', q("?agent=trading&section=studies&study=orb&class=forex"));
t("unknown agent falls back to the default state", q("?agent=nope&section=x") === "{}", "");
t("unknown section is dropped", q("?agent=trading&section=nope") === '{"primaryId":"trading"}', q("?agent=trading&section=nope"));
t("unknown study is dropped, group kept", q("?agent=trading&section=equities&tab=studies&study=nope") === '{"primaryId":"trading","secondaryId":"equities","tab":"studies"}', q("?agent=trading&section=equities&tab=studies&study=nope"));
t("a study that does not apply to the group is dropped", q("?agent=trading&section=bonds&study=quad-witching") === '{"primaryId":"trading","secondaryId":"bonds"}', q("?agent=trading&section=bonds&study=quad-witching"));
t("script and odd characters in parameters are rejected", q("?agent=trading&ticker=%3Cscript%3E") === '{"primaryId":"trading"}' && q("?agent=trading&section=equities&tab=../../x") === '{"primaryId":"trading","secondaryId":"equities"}', q("?agent=trading&ticker=%3Cscript%3E"));
t("over-long ticker is rejected", q("?agent=trading&ticker=" + "A".repeat(40)) === '{"primaryId":"trading"}', "");

// Every study round-trips through its own URL in every class it applies to.
let roundTrip = 0; const rtBad: string[] = [];
for (const s of STUDIES.filter((x) => !x.location)) for (const c of (s.assetClasses.length ? s.assetClasses : [undefined])) for (const ticker of [undefined, "AAPL"]) {
  const route = resolveStudyRoute(s.id, c, ticker); if (!route) { rtBad.push(s.id); continue; }
  const url = buildNavQuery(route); const back = parseNavQuery(url);
  // A ticker on a study that has no ticker input is carried but harmless; the state must still be stable.
  if (buildNavQuery(back) !== url) rtBad.push(`${s.id}/${c}/${ticker}: ${url} -> ${buildNavQuery(back)}`); else roundTrip++;
  const shortUrl = `agent=trading&study=${s.id}${c ? `&class=${c}` : ""}${ticker ? `&ticker=${ticker}` : ""}`;
  if (buildNavQuery(parseNavQuery(shortUrl)) !== url) rtBad.push(`short ${shortUrl} -> ${buildNavQuery(parseNavQuery(shortUrl))} (want ${url})`);
}
t(`every study is addressable: canonical and short URLs agree and round-trip (${roundTrip} routes)`, rtBad.length === 0, rtBad.slice(0, 8).join("\n  "));

t("planned hook (client-research) has no route yet and a study= link to it degrades to the Trading Agent", resolveStudyRoute("client-research") === undefined && q("?agent=trading&study=client-research") === '{"primaryId":"trading"}', q("?agent=trading&study=client-research"));
t("News hub deep link opens the News tab", q("?agent=trading&study=news-hub") === '{"primaryId":"trading","secondaryId":"news-hub"}' && q("?agent=trading&section=news-hub") === '{"primaryId":"trading","secondaryId":"news-hub"}', q("?agent=trading&study=news-hub"));

// ---------------------------------------------------------------- reducer: clicks, programmatic navigation, history
let s0 = {};
s0 = navReducer(s0, { type: "select", level: "primary", id: "trading" });
t("select primary", sameNav(s0, { primaryId: "trading" }), JSON.stringify(s0));
s0 = navReducer(s0, { type: "select", level: "secondary", id: "equities", parentId: "trading" });
s0 = navReducer(s0, { type: "select", level: "tertiary", id: "studies", parentId: "equities" });
s0 = navReducer(s0, { type: "patch", patch: { studyId: "orb" } });
t("open a study inside a group", buildNavQuery(s0) === "agent=trading&section=equities&tab=studies&study=orb", buildNavQuery(s0));
const afterClose = navReducer(s0, { type: "patch", patch: { studyId: undefined, ticker: undefined } });
t("closing the study keeps the tab", buildNavQuery(afterClose) === "agent=trading&section=equities&tab=studies", buildNavQuery(afterClose));
t("switching secondary tab clears the group state", buildNavQuery(navReducer(s0, { type: "select", level: "secondary", id: "bonds", parentId: "trading" })) === "agent=trading&section=bonds", "");
t("switching primary tab clears everything below", buildNavQuery(navReducer(s0, { type: "select", level: "primary", id: "portfolio" })) === "agent=portfolio", "");
t("re-selecting the active tab is a no-op (same object, no history entry)", navReducer(s0, { type: "select", level: "secondary", id: "equities", parentId: "trading" }) === s0, "");
t("navigateTo-style target (Assistant: trading, paper-trading)", buildNavQuery(navReducer({}, { type: "navigate", state: { primaryId: "trading", secondaryId: "paper-trading" } })) === "agent=trading&section=paper-trading", "");
t("hydrate (Back/Forward) replaces the state", sameNav(navReducer(s0, { type: "hydrate", state: {} }), {}), "");
const forward = parseNavQuery("agent=trading&section=equities&tab=studies&study=orb");
t("Back then Forward restores the same state", sameNav(navReducer(navReducer(s0, { type: "hydrate", state: {} }), { type: "hydrate", state: forward }), s0), "");

// ---------------------------------------------------------------- routes
t("inferAssetClass", [["BTC-USD", "crypto"], ["EUR/USD", "forex"], ["EURUSD", "forex"], ["TLT", "bond"], ["GLD", "commodity"], ["ES=F", "future"], ["AAPL", "equity"], ["NVDA", "equity"]].every(([s, c]) => inferAssetClass(s) === c), "");
t("ticker route lands on that group's charts", JSON.stringify(resolveTickerRoute("tlt")) === '{"primaryId":"trading","secondaryId":"bonds","tab":"charts","ticker":"TLT"}', JSON.stringify(resolveTickerRoute("tlt")));
t("options ticker route lands on the Options default tab", resolveTickerRoute("SPY", "option")?.tab === "dashboard", JSON.stringify(resolveTickerRoute("SPY", "option")));
t("an unknown study has no route", resolveStudyRoute("nope") === undefined && resolveGlobalStudyRoute("nope") === undefined, "");
const bt = resolveStudyRender(getStudy("backtest"), "equity", "msft");
t("ticker override reaches the component's defaultTicker, other props untouched", bt.props.defaultTicker === "msft" && bt.props.assetClass === "equity" && bt.component === "HistoricalBacktestTab", JSON.stringify(bt));
const fx = resolveStudyRender(getStudy("backtest"), "forex");
t("currency backtest uses the suite component like the old tab", fx.component === "BacktestSuiteTab" && fx.props.defaultTicker === "EUR/USD", JSON.stringify(fx));
const gm = resolveStudyRender(getStudy("gamma-heat-map"), "option", "NVDA");
t("a study without a ticker prop ignores the override", !("defaultTicker" in gm.props), JSON.stringify(gm));
t("an asset class the study does not support falls back to its first", resolveStudyRender(getStudy("quad-witching"), "forex").assetClass === "equity", "");

// ---------------------------------------------------------------- fuzzy search
t("fuzzy: substring beats subsequence", fuzzyScore("vwap", "VWAP Band Study") > fuzzyScore("vwb", "VWAP Band Study"), "");
t("fuzzy: every word must match", fuzzyScore("gap weekday", "Gap and Calendar Study") === null, String(fuzzyScore("gap weekday", "Gap and Calendar Study")));
t("fuzzy: typo-tolerant subsequence", fuzzyScore("bcktst", "Signal Backtest") !== null, "");
t("fuzzy: short word needs a real substring", fuzzyScore("zq", "Signal Backtest") === null, "");
const rank = (query: string) => fuzzyRank(query, STUDIES, (x) => [x.title, x.question, x.keywords ?? ""]).map((x) => x.id);
t("search 'gap' finds both gap studies first", rank("gap").slice(0, 2).every((id) => ["premarket-gaps", "gap-calendar-study"].includes(id)), rank("gap").slice(0, 4).join());
t("search 'weekday' finds the calendar tools", rank("weekday").includes("calendar-effects") && rank("weekday").includes("gap-calendar-study"), rank("weekday").join());
t("search 'vwap' finds exactly the VWAP studies at the top", rank("vwap").slice(0, 2).sort().join() === "vwap-band-study,vwap-reversion-backtest", rank("vwap").slice(0, 3).join());
t("search 'nonsense words' finds nothing", rank("zzqx plorp").length === 0, rank("zzqx plorp").join());
t("empty query returns everything in registry order", rank("").length === STUDIES.length, "");

// ---------------------------------------------------------------- pinned and recents
let p = EMPTY_PREFS;
p = togglePin(p, "study:orb"); p = togglePin(p, "study:backtest");
t("pin adds newest first", p.pins.join() === "study:backtest,study:orb", p.pins.join());
t("pin again removes", togglePin(p, "study:orb").pins.join() === "study:backtest", "");
for (let i = 0; i < 20; i++) p = pushRecent(p, `study:s${i}`);
t(`recents are capped at ${MAX_RECENTS} and newest first`, p.recents.length === MAX_RECENTS && p.recents[0] === "study:s19", p.recents.join());
t("a repeated recent moves to the front without duplicating", pushRecent(p, "study:s15").recents[0] === "study:s15" && new Set(pushRecent(p, "study:s15").recents).size === MAX_RECENTS, "");
let many = EMPTY_PREFS; for (let i = 0; i < 30; i++) many = togglePin(many, `study:p${i}`);
t(`pins are capped at ${MAX_PINS}`, many.pins.length === MAX_PINS, String(many.pins.length));
t("garbage in storage is ignored, valid parts kept", parsePrefs("{nope").pins.length === 0 && parsePrefs(JSON.stringify({ pins: ["study:ok", "<script>", 5, "study:ok"], recents: "x" })).pins.join() === "study:ok", "");
t("storage round trip", parsePrefs(serializePrefs(p)).recents.join() === p.recents.join(), "");
t("invalid keys are not stored", togglePin(EMPTY_PREFS, "evil key").pins.length === 0 && pushRecent(EMPTY_PREFS, "x:y").recents.length === 0, "");

// ---------------------------------------------------------------- existing links keep working (wizard, Help menu, Assistant, Faye)
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const wizardSrc = readFileSync(ROOT + "src/components/OnboardingWizard.tsx", "utf8");
const wizardPrimaries = [...wizardSrc.matchAll(/primaryId: "([a-z-]+)"/g)].map((m) => m[1]);
t("onboarding wizard goals point at real primary tabs", wizardPrimaries.length >= 4 && wizardPrimaries.every((id) => PRIMARY_TABS.some((p) => p.id === id)), wizardPrimaries.join());
const wizardPairs = [...wizardSrc.matchAll(/primaryId: "([a-z-]+)",\s+secondaryId: "([a-z-]+)"/g)].map((m) => [m[1], m[2]]);
t("every wizard goal opens a real section (secondary tab id exists)", wizardPairs.length >= 3 && wizardPairs.every(([a, b2]) => (SECONDARY_TABS[a] ?? []).some((x) => x.id === b2)), JSON.stringify(wizardPairs));
t("every wizard target survives a URL round trip", wizardPrimaries.every((id) => buildNavQuery(parseNavQuery(buildNavQuery({ primaryId: id }))) === "agent=" + id), "");
t("every Help menu agent id is a primary tab", HELP_VIDEOS.every((v) => PRIMARY_TABS.some((p) => p.id === v.agentId)), HELP_VIDEOS.map((v) => v.agentId).join());
const toolsSrc = readFileSync(ROOT + "src/lib/agents/assistant/tools.ts", "utf8");
const assistantTargets = [...toolsSrc.matchAll(/target: \{ primaryId: "([a-z-]+)", secondaryId: "([a-z-]+)" \}/g)].map((m) => [m[1], m[2]]);
t("Assistant navigation targets are real tabs", assistantTargets.length >= 1 && assistantTargets.every(([a, b]) => (SECONDARY_TABS[a] ?? []).some((x) => x.id === b)), JSON.stringify(assistantTargets));
t("Assistant target (trading, paper-trading) is stable through the URL", assistantTargets.every(([a, b]) => buildNavQuery(parseNavQuery("agent=" + a + "&section=" + b)) === "agent=" + a + "&section=" + b), "");
const fayeSrc = readFileSync(ROOT + "src/components/FayeChatWidget.tsx", "utf8");
t("Faye only navigates to ids this registry knows", [...fayeSrc.matchAll(/navigateTo\("([a-z-]+)"/g)].every((m) => PRIMARY_TABS.some((p) => p.id === m[1])), "");

// ---------------------------------------------------------------- command palette items
const items = buildPaletteItems({ lastAssetClass: "forex", watchlist: [{ symbol: "aapl", assetClass: "equity" }, { symbol: "AAPL", assetClass: "equity" }, { symbol: "EUR/USD", assetClass: "forex" }] });
t("palette lists every live study exactly once", STUDIES.filter((x) => x.status !== "planned").every((x) => items.filter((i) => i.key === "study:" + x.id).length === 1), "");
t("palette lists the News hub but not the planned Client Research slot", items.some((i) => i.key === "study:news-hub") && !items.some((i) => i.key === "study:client-research"), "");
t("palette lists every agent tab and every section", PRIMARY_TABS.every((p) => items.some((i) => i.key === "tab:" + p.id)) && Object.entries(SECONDARY_TABS).every(([a, list]) => list.every((x) => items.some((i) => i.key === "tab:" + a + "/" + x.id))), "");
t("palette lists watchlist tickers once, upper-cased", items.filter((i) => i.key === "ticker:AAPL").length === 1 && items.some((i) => i.key === "ticker:EUR/USD"), "");
t("palette study target uses the current asset-class context", items.find((i) => i.key === "study:backtest").target.secondaryId === "currency" && items.find((i) => i.key === "study:quad-witching").target.secondaryId === "equities", JSON.stringify(items.find((i) => i.key === "study:backtest").target));
const badTargets = items.filter((i) => buildNavQuery(parseNavQuery(buildNavQuery(i.target))) !== buildNavQuery(i.target)).map((i) => i.key);
t("every palette target is a valid, stable URL state", badTargets.length === 0, badTargets.join());
t("palette search: 'backtest' puts Signal Backtest first", searchPalette(items, "backtest")[0].key === "study:backtest", searchPalette(items, "backtest").slice(0, 3).map((i) => i.key).join());
const msft = searchPalette(items, "msft").at(-1);
t("palette search: a typed unknown ticker is offered as Open chart", msft.key === "ticker:MSFT" && msft.target.secondaryId === "equities", JSON.stringify(msft));
t("palette: a watchlist ticker is not offered twice", typedTickerItem("aapl", items) === null, "");
const resolved = itemsForKeys(items, ["study:orb", "tab:trading", "study:nope", "ticker:GONE"]).map((i) => i.key);
t("palette: pinned/recent keys resolve and unknown studies are dropped", resolved.includes("study:orb") && resolved.includes("tab:trading") && !resolved.includes("study:nope"), resolved.join());
t("palette: a script-like query is not offered as a ticker", typedTickerItem("<img src=x>", items) === null, "");

console.log(`\n${passed} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
