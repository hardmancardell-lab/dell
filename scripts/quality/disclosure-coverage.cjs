/*
 * Dellegate disclosure-coverage matrix and RATCHET (ported from the CPO audit scratch script, 2026-10-15).
 *
 *   node scripts/quality/disclosure-coverage.cjs [repoRoot] [--md out.md] [--json out.json]
 *        [--check]            exit 1 if coverage regressed against scripts/quality/disclosure-coverage.baseline.json
 *        [--update-baseline]  record the current coverage as the new baseline (only ever run after coverage went UP)
 *
 * Parses src/app/page.tsx with the TypeScript compiler API (from the repo own node_modules), builds the tab tree,
 * resolves each leaf to its component files (plus transitive imports, depth <= 3), extracts only user-visible strings
 * and tests each disclosure criterion with regexes. A leaf counts as having the shared notice when any file in its
 * closure imports src/components/ResearchNotice.
 *
 * Ratchet (--check) is limited to the tabs this batch owns (OWNED below): fails when a tab that had the ResearchNotice
 * loses it, when the number of owned tabs with the notice drops, or when an owned study/signal tab gains missing
 * criteria. It always prints the tabs still missing the notice, owned and not owned (the latter need a follow-up by
 * whoever owns those files).
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const args = process.argv.slice(2);
const positional = args.filter((x, i) => !x.startsWith("--") && !["--md", "--json"].includes(args[i - 1]));
const repo = path.resolve(positional[0] || path.join(__dirname, "..", ".."));
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const rq = createRequire(path.join(repo, "package.json"));
const ts = rq("typescript");

const read = (p) => fs.readFileSync(p, "utf8");
const pagePath = path.join(repo, "src/app/page.tsx");
const compDir = path.join(repo, "src/components");

// ---------- kind map (manual, reviewed): what sort of output does the leaf produce ----------
const KIND = {};
const set = (kind, names) => names.forEach((n) => (KIND[n] = kind));
set("study", ["HistoricalBacktestTab","CalendarEffectsTab","VwapReversionBacktestTab","VwapBandStudyTab","AnchoredVolumeProfileTab",
  "PremarketGapHodLodTab","GapCalendarStudyTab","OrbStrategyTab","QuadWitchingStudyTab","WitchingRangeContainmentTab",
  "WeekStartMomentumTab","OvernightIntradayPatternTab","PostBigDayStudyTab","LowOfDayTimingTab","BuybackAnomalyTab",
  "CorporateBuybackOfferingTab","FomcReactionStudyTab","FomcWeekVarianceTab","RollingMoveStatsTab","SessionAnalysisTab",
  "BacktestSuiteTab","YieldAlertThresholdTab","SupplyDemandShockScanTab","PaperBacktestLogTab","CurrencyPegsTab",
  "StrategyLedgerTab","CorrelationFinderTab","ScenarioSimulationTab","ModernPortfolioTab","RebalancingTab","RetirementPlanTab","OptionFlowTab"]);
set("signal", ["GuidedTradeSignalsTab","OptionsDashboardTab","GammaHeatMapTab","CryptoRegimeTab","SectorRecommendationsTab",
  "SectorStockAnalysisTab","ScreenerTab","SecurityAnalystTab","BusinessPhaseTab","TradingDashboardTab","CryptoWatchlistTab",
  "ResearchWatchlistTab","TraditionalPortfolioTab","CatalystCalendarTab","MacroDashboardTab","IndustryImpactTab","EconomicOutlookTab"]);
set("data", ["BondDashboardTab","CurrencyDashboardTab","FuturesDashboardTab","CommoditiesDashboardTab","YieldCurveTab",
  "EquityChartsTab","AssetChartsTab","CryptoChartsTab","GlobalFinancialNewsTab","InternationalEconomicsTab","CurrencyDriversTab",
  "InternationalCentralBanksView","PortfolioDashboardTab","SectorFundamentalsTab","__inline_macro","__inline_sector"]);
set("tool", ["OptionsCalculatorTab","OptionsChainTradeTab","PaperTradingTab","TradeJournalTab","AlertsSubscribeTab"]);
set("reference", ["GlossaryTab","ResearchSourcesTab","FxResearchSourcesTab","FuturesCommoditiesResearchSourcesTab",
  "PortfolioMethodologyTab","OptionsStrategiesTab","FinancialLiteracyTab","AssistantChatTab"]);

// ---------- criteria ----------
const RX = {
  source: /\b(FRED|St\.? Louis Fed|Alpaca|Tradier|Yahoo|FMP|Financial Modeling Prep|Polygon|Finnhub|Coinbase|CoinGecko|OANDA|BLS|BEA|Treasury|Federal Reserve|FOMC|SEC\b|EDGAR|GDELT|Webull|Schwab|Databento|Stooq|Binance|CFTC|source[s]?\b|data (from|via|provider)|provider)\b/i,
  asOfText: /\bas[- ]of\b|updated|refreshed|fetched|generated|snapshot|latest (bar|close|reading|print)|last (bar|reading|update|run)|\bET\b|\bUTC\b|\bdelayed\b|live quote/i,
  asOfIdent: /asOf|fetchedAt|generatedAt|updatedAt|timestamp|lastUpdated|capturedAt|snapshotAt|latestDate|currentDate|marketCapDate|\.date\b|asOfNote|createdAt/,
  hypoStrict: /past performance|not (a )?guarantee|no guarantee|does not guarantee|not guaranteed|may not (hold|persist|repeat|continue)|not (a )?predict|hypothetical (performance|results|returns)|future (results|returns|performance)|no assurance|not a forecast|not (a )?market forecast/i,
  hypoLoose: /simulated|back-?tested|in-sample|look-?ahead|survivorship|illustrative|projection|hypothetical/i,
  hypoCost: /slippage|commission|fees?\b|assumption|assumes|before (costs|fees)|transaction cost|spread\b/i,
  sampleText: /\bn\s*[=:]|\bN\s*[=:]|sample|observations?|occurrences|number of (trades|days|events|bars|signals|obs)|times before|trades\b|events\b|trading days|data points/i,
  sampleIdent: /sampleSize|nTrades|numTrades|occurrences|observations|\bn\b|\bN\b|trades\.length|sampleN|\.count\b|nObs|nDays|nEvents/,
  uncertainText: /confidence|\bCI\b|bootstrap|p-?value|\bFDR\b|significan|standard (error|deviation)|±|uncertain|margin of error|out-of-sample|\bOOS\b|noise|too (few|small)|low sample|thin sample|unreliable/i,
  uncertainIdent: /ci(Lower|Upper)|bootstrap|pValue|fdr|stderr|confidence|significan|oos|outOfSample/i,
  advice: /\b(buy|sell|entry|target|stop[- ]loss|recommend\w*|suggest\w*|should|best|top pick|strong|bullish|bearish|bargain|undervalued|take it|trade idea|opportunit\w+|favor\w*|attractive|overweight|underweight)\b/i,
  adviceHard: /not (an? )?(investment |financial |personalized |trade )?(advice|recommendation)|not advice|educational|education,? not|for (education|information)|not (an? )?(buy|sell|trade) (signal|recommendation)/i,
  adviceSoft: /research read|screening candidates|not verdicts|starting framework|describes what|not a prediction|not a guarantee|a (statistical )?deviation, not|maps where|does not (say|tell|predict)/i,
  automatedLabel: /auto-?derived|automated|computed|generated|rule-based|heuristic|model output|screen output|algorithm|this app's own|swept automatically|statistically validated|derived from/i,
  paperLabel: /paper|simulat|virtual|not real money/i,
  citation: /Markowitz|Sharpe|Efron|Benjamini|Hochberg|Fama|French|Black[- ]Scholes|Merton|Graham|Dodd|Shiller|Buffett|Kelly|Treynor|Jensen|Sortino|Roll\b|Bollinger|Wilder|Lo\b|Andrews|Politis|Newey|Cleveland|Ledoit|Hamilton|Hodrick|Prescott|Stambaugh|Jegadeesh|Titman|Carhart|Engle|Bollerslev|Corsi|HAR\b|Garman|Klass|Parkinson|Yang-Zhang|Brown|Thorp/,
};

// ---------- tab tree from page.tsx ----------
const src = read(pagePath);
const sf = ts.createSourceFile(pagePath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const importMap = {}; // localName -> module
sf.statements.filter(ts.isImportDeclaration).forEach((d) => {
  const mod = d.moduleSpecifier.text;
  const nb = d.importClause && d.importClause.namedBindings;
  if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => (importMap[e.name.text] = mod));
});
const lineOf = (node, file) => file.getLineAndCharacterOfPosition(node.getStart()).line + 1;

function tagName(el) { return el.tagName.getText(); }
function strAttr(el, name) {
  const a = el.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.text === name);
  if (!a || !a.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  return a.initializer.getText();
}
function collectComponents(node, out) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const n = tagName(node);
    if (/^[A-Z]/.test(n) && n !== "Tabs") out.push({ name: n, attrs: node.attributes.getText().slice(0, 160), line: lineOf(node, sf) });
  }
  if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression)) {
    out.push({ name: "__ident:" + node.expression.text, attrs: "", line: lineOf(node, sf) });
  }
  ts.forEachChild(node, (c) => {
    // do not descend into nested Tabs `tabs` prop; handled by walkTabs
    collectComponents(c, out);
  });
}
const leaves = [];
function walkTabsElement(el, trail, level) {
  const tabsAttr = el.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.text === "tabs");
  const arr = tabsAttr.initializer.expression;
  arr.elements.forEach((obj) => {
    const props = {};
    obj.properties.forEach((p) => (props[p.name.text] = p.initializer));
    const id = props.id.text, label = props.label.text;
    const here = trail.concat([{ id, label }]);
    const nested = [];
    const findNested = (n) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && tagName(n) === "Tabs") { nested.push(n); return; }
      ts.forEachChild(n, findNested);
    };
    findNested(props.content);
    if (ts.isIdentifier(props.content)) { /* content is a pre-built variable (page.tsx inline JSX) */ }
    if (nested.length) {
      // components that live OUTSIDE the nested Tabs (headers etc.) are ignored; nested tabs carry the content
      nested.forEach((n) => walkTabsElement(n, here, level + 1));
    } else {
      const comps = [];
      collectComponents(props.content, comps);
      if (ts.isIdentifier(props.content)) comps.push({ name: "__ident:" + props.content.text, attrs: "", line: lineOf(props.content, sf) });
      const gated = comps.some((c) => c.name === "RequiresPlacementTier");
      leaves.push({ trail: here, line: lineOf(obj, sf), comps: comps.filter((c) => c.name !== "RequiresPlacementTier"), gated,
        gateAttrs: gated ? comps.find((c) => c.name === "RequiresPlacementTier").attrs : null });
    }
  });
}
function findTopTabs(n) {
  if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && tagName(n) === "Tabs") {
    walkTabsElement(n, [], 0); return true;
  }
  let hit = false;
  ts.forEachChild(n, (c) => { if (!hit) hit = findTopTabs(c); });
  return hit;
}
findTopTabs(sf);

// The Trading Agent's asset-class groups and its Studies tab render the study registry instead of listing each study as a
// page.tsx tab (src/lib/navigation/study-registry.ts). Expand them back into one leaf per study and asset class, with the same
// component, props and placement-tier gate the old tab had, so every study is still checked. Trading-wide tools stay direct
// page.tsx tabs and are walked above.
{
  const loadTs = (rel) => {
    const js = ts.transpileModule(read(path.join(repo, rel)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const m = { exports: {} };
    new Function("module", "exports", "require", js)(m, m.exports, () => ({}));
    return m.exports;
  };
  const registryPath = "src/lib/navigation/study-registry.ts";
  const structurePath = "src/lib/navigation/trading-structure.ts";
  const HOSTS = new Set(["AssetGroupWorkspace", "StudiesTab"]);
  if (fs.existsSync(path.join(repo, registryPath)) && fs.existsSync(path.join(repo, structurePath)) && leaves.some((l) => l.comps.some((c) => HOSTS.has(c.name)))) {
    const { STUDIES } = loadTs(registryPath);
    const { ASSET_GROUPS } = loadTs(structurePath);
    for (let i = leaves.length - 1; i >= 0; i--) if (leaves[i].comps.some((c) => HOSTS.has(c.name))) leaves.splice(i, 1);
    for (const g of ASSET_GROUPS) {
      for (const s of STUDIES) {
        const v = s.variants[g.assetClass];
        if (!v || s.assetClasses.length === 0) continue;
        const name = v.component || s.component;
        leaves.push({
          trail: [{ id: "trading", label: "Trading Agent" }, { id: g.id, label: g.label }, { id: s.id, label: s.title }],
          line: 0,
          comps: [{ name, attrs: JSON.stringify(v.props).slice(0, 160), line: 0 }],
          gated: s.tier === "intermediate",
          gateAttrs: s.tier ? 'minTier="' + s.tier + '"' : null,
        });
        if (!importMap[name]) importMap[name] = "./page-tabs";
      }
    }
  }
}

// ---------- visible-text extraction ----------
const SKIP_ATTR = new Set(["className","style","key","id","type","href","src","value","name","htmlFor","d","viewBox","fill","stroke","role","target","rel","size","theme","navLevel","navParentId","defaultTicker","assetClass","filterAssetClass","minTier","term","agentId","defaultAssetClass","tone","mobileDropdown","crypto","assetLabel","label"]);
const fileCache = {};
function analyseFile(file) {
  if (fileCache[file]) return fileCache[file];
  const text = read(file);
  const f = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strings = []; const idents = []; const flags = { inputs: false, buttons: false, form: false, verdictPanel: false };
  const imports = [];
  const inSkippedAttr = (n) => { for (let p = n.parent; p; p = p.parent) { if (ts.isJsxAttribute(p) && SKIP_ATTR.has(p.name.text)) return true; if (ts.isImportDeclaration(p)) return true; } return false; };
  (function walk(n) {
    if (ts.isImportDeclaration(n)) { imports.push(n.moduleSpecifier.text); return; }
    if (ts.isJsxText(n)) { const t = n.getText().replace(/\s+/g, " ").trim(); if (t) strings.push({ line: lineOf(n, f), text: t }); }
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !inSkippedAttr(n)) { const t = n.text.replace(/\s+/g, " ").trim(); if (t.length > 3 && /[a-z]/i.test(t)) strings.push({ line: lineOf(n, f), text: t }); }
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) { const t = n.text.replace(/\s+/g, " ").trim(); if (t.length > 3) strings.push({ line: lineOf(n, f), text: t }); }
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) { /* collect only inside JSX expressions */ }
    if (ts.isJsxExpression(n)) { const t = n.getText(); if (t.length < 400) idents.push({ line: lineOf(n, f), text: t }); }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tn = tagName(n);
      if (tn === "input" || tn === "select" || tn === "textarea") flags.inputs = true;
      if (tn === "button") flags.buttons = true;
      if (tn === "form") flags.form = true;
      const cn = strAttr(n, "className") || "";
      if (/jv-verdict-panel/.test(cn)) flags.verdictPanel = true;
      if (/jv-input|jv-btn/.test(cn)) { flags.inputs = flags.inputs || /jv-input/.test(cn); flags.buttons = flags.buttons || /jv-btn/.test(cn); }
    }
    ts.forEachChild(n, walk);
  })(f);
  return (fileCache[file] = { file, strings, idents, flags, imports });
}
var GENERIC = new Set(["Tabs","StatCard","GlossaryTerm","ResearchGlossaryTerm","HelpMenu","RequiresPlacementTier","PriceChart","IndicatorChart"]);
function resolveImport(from, mod) {
  let p = null;
  if (mod.startsWith("@/components/")) p = path.join(compDir, mod.slice(13));
  else if (mod.startsWith("./")) p = path.join(path.dirname(from), mod);
  if (!p) return null;
  for (const ext of [".tsx", ".ts"]) if (fs.existsSync(p + ext)) return p + ext;
  return null;
}
function closure(file, depth, seen) {
  if (seen.has(file) || depth > 3) return [];
  seen.add(file);
  const a = analyseFile(file); const out = [a];
  for (const m of a.imports) {
    const r = resolveImport(file, m);
    if (r && !GENERIC.has(path.basename(r, path.extname(r)))) out.push(...closure(r, depth + 1, seen));
  }
  return out;
}

// ---------- evaluate each leaf ----------
function firstHit(files, key, rx, which = "strings") {
  for (const a of files) for (const s of a[which]) if (rx.test(s.text)) return `${path.relative(repo, a.file).replace(/\\/g, "/")}:${s.line}`;
  return null;
}
// Tabs owned by fix batch B (components under src/components). Everything else is reported but not enforced.
const OWNED = new Set(["PaperOrderForm","PaperTradingTab","GuidedTradeSignalsTab","ClientDashboardView","PortfolioDashboardTab","HistoricalBacktestTab","BacktestSuiteTab","CalendarEffectsTab","VwapReversionBacktestTab","VwapBandStudyTab","GapCalendarStudyTab","OrbStrategyTab","PostBigDayStudyTab","OptionsDashboardTab","GammaHeatMapTab","ModernPortfolioTab","ScenarioSimulationTab","CorrelationFinderTab","RebalancingTab","TraditionalPortfolioTab","PremarketGapHodLodTab","QuadWitchingStudyTab","WitchingRangeContainmentTab","WeekStartMomentumTab","OvernightIntradayPatternTab","LowOfDayTimingTab","BuybackAnomalyTab","CorporateBuybackOfferingTab","FomcReactionStudyTab","FomcWeekVarianceTab","RollingMoveStatsTab","SessionAnalysisTab","YieldAlertThresholdTab","SupplyDemandShockScanTab","PaperBacktestLogTab","CurrencyPegsTab","StrategyLedgerTab","AnchoredVolumeProfileTab","BusinessPhaseTab","CatalystCalendarTab","CryptoRegimeTab","CryptoWatchlistTab","EconomicOutlookTab","IndustryImpactTab","MacroDashboardTab","OptionFlowTab","ResearchWatchlistTab","RetirementPlanTab","ScreenerTab","SectorRecommendationsTab","SectorStockAnalysisTab","SecurityAnalystTab","TradingDashboardTab"]);
// page.tsx now imports the tab bodies from ./page-tabs, where each is a lazy dynamic(() => import("@/components/File")).
// Map each exported name to its component file so the closure is still resolved.
const dynMap = {};
// The navigation folder has its own lazy wrappers (for example NewsHubTab), same pattern.
for (const rel of ["src/app/page-tabs.tsx", "src/components/navigation/lazy.tsx"]) {
  const lazyPath = path.join(repo, rel);
  if (!fs.existsSync(lazyPath)) continue;
  const re = /export const (\w+) = dynamic\(\(\) => import\("@\/components\/(\w+)"\)/g;
  const txt = read(lazyPath);
  let m;
  while ((m = re.exec(txt))) {
    const f = path.join(compDir, m[2] + ".tsx");
    if (fs.existsSync(f)) dynMap[m[1]] = f;
  }
}
// NewsHubTab (and any other page.tsx tab imported from the navigation lazy module) resolves through dynMap too.
for (const name of Object.keys(dynMap)) if (!importMap[name]) importMap[name] = "./page-tabs";
const rows = [];
for (const lf of leaves) {
  const names = lf.comps.map((c) => c.name);
  const real = lf.comps.filter((c) => importMap[c.name] && (importMap[c.name].startsWith("@/components/") || dynMap[c.name]) && !GENERIC.has(c.name));
  const inline = lf.comps.filter((c) => c.name.startsWith("__ident:")).map((c) => c.name.slice(8));
  const primary = real[0] ? real[0].name : (inline[0] ? "__inline_" + (inline[0].includes("macro") ? "macro" : "sector") : "(none)");
  let files = [];
  if (real.length) {
    for (const c of real) {
      const fp = dynMap[c.name] || resolveImport(pagePath, importMap[c.name]);
      if (fp) files.push(...closure(fp, 0, new Set()));
    }
  } else if (inline.length) {
    // inline content in page.tsx
    { const a = analyseFile(pagePath); const rng = inline[0].includes("macro") ? [118, 314] : [316, 401]; files.push({ ...a, strings: a.strings.filter((x) => x.line >= rng[0] && x.line <= rng[1]), idents: a.idents.filter((x) => x.line >= rng[0] && x.line <= rng[1]) }); }
  }
  const kind = KIND[primary] || (primary === "(none)" ? "unknown" : "data");
  const c = {};
  c.source = firstHit(files, "source", RX.source);
  c.asOf = firstHit(files, "asOf", RX.asOfText) || firstHit(files, "asOf", RX.asOfIdent, "idents");
  c.hypoStrict = firstHit(files, "hypo", RX.hypoStrict);
  c.hypoLoose = firstHit(files, "hypoL", RX.hypoLoose);
  c.hypoCost = firstHit(files, "hypoCost", RX.hypoCost);
  c.sample = firstHit(files, "sample", RX.sampleText) || firstHit(files, "sample", RX.sampleIdent, "idents");
  c.uncertainty = firstHit(files, "unc", RX.uncertainText) || firstHit(files, "unc", RX.uncertainIdent, "idents");
  c.adviceWording = firstHit(files, "adv", RX.advice);
  c.adviceHard = firstHit(files, "advh", RX.adviceHard);
  c.adviceSoft = firstHit(files, "advs", RX.adviceSoft);
  c.automatedLabel = firstHit(files, "auto", RX.automatedLabel);
  c.paperLabel = firstHit(files, "paper", RX.paperLabel);
  c.citation = firstHit(files, "cite", RX.citation);
  c.hasInputs = files.some((a) => a.flags.inputs || a.flags.form);
  c.hasButtons = files.some((a) => a.flags.buttons);
  c.verdictPanel = files.some((a) => a.flags.verdictPanel);
  const adviceUnguarded = !!c.adviceWording && !c.adviceHard;
  c.notice = files.some((a) => a.imports.some((m) => /(^|\/)ResearchNotice$/.test(m)));
  rows.push({
    path: lf.trail.map((t) => t.label).join(" > "), ids: lf.trail.map((t) => t.id).join("/"), pageLine: lf.line,
    component: primary, kind, gated: lf.gated, files: files.map((a) => path.relative(repo, a.file).replace(/\\/g, "/")),
    ...c, adviceUnguarded, owned: OWNED.has(primary),
  });
}

// ---------- required criteria per kind (the CI ratchet) ----------
const REQUIRED = { study: 1, signal: 1 };
let failures = [];
rows.forEach((r) => {
  r.missing = [];
  if (r.kind === "study" || r.kind === "signal") {
    ["source", "asOf", "hypoStrict"].forEach((k) => { if (!r[k]) r.missing.push(k); });
    if (r.kind === "study") ["sample", "uncertainty"].forEach((k) => { if (!r[k]) r.missing.push(k); });
    if (r.adviceWording && !r.adviceHard) r.missing.push("adviceHard(advice words present)");
  }
  if (r.missing.length) failures.push(r);
});

// ---------- output ----------
const mark = (v) => (v ? "Y" : "-");
const md = [];
md.push("| Tab path | Component | Kind | owned | notice | src | as-of | past-perf | n | uncertainty | advice words | advice HARD | missing |");
md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
rows.forEach((r) => md.push(`| ${r.path}${r.gated ? " [tier]" : ""} | ${r.component} | ${r.kind} | ${mark(r.owned)} | ${mark(r.notice)} | ${mark(r.source)} | ${mark(r.asOf)} | ${mark(r.hypoStrict)} | ${mark(r.sample)} | ${mark(r.uncertainty)} | ${mark(r.adviceWording)} | ${mark(r.adviceHard)} | ${r.missing.join(",")} |`));
const out = md.join("\n");
if (arg("--md")) fs.writeFileSync(arg("--md"), out);
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(rows, null, 1));

// Results-producing leaves are the ones that need the notice.
const needsNotice = rows.filter((r) => r.kind === "study" || r.kind === "signal");
const ownedRows = rows.filter((r) => r.owned);
const ownedWith = ownedRows.filter((r) => r.notice);
const state = {
  note: "Disclosure-coverage baseline for the tabs owned by fix batch B. Update only after coverage went up (--update-baseline).",
  ownedWithNotice: ownedWith.map((r) => r.component).sort(),
  ownedMissingCount: Object.fromEntries(ownedRows.map((r) => [r.component, r.missing.length])),
};
const baselinePath = path.join(repo, "scripts/quality/disclosure-coverage.baseline.json");

const missingOwned = needsNotice.filter((r) => r.owned && !r.notice);
const missingOther = needsNotice.filter((r) => !r.owned && !r.notice);
const uniq = (xs) => [...new Set(xs)].sort();
console.log(`leaves=${rows.length}; results-producing leaves=${needsNotice.length}; owned leaves=${ownedRows.length}, with ResearchNotice=${ownedWith.length}`);
console.log(`Owned tabs still missing the notice (${uniq(missingOwned.map((r) => r.component)).length}): ${uniq(missingOwned.map((r) => r.component)).join(", ") || "none"}`);
console.log(`Tabs in files not owned by this batch still missing the notice (${uniq(missingOther.map((r) => r.component)).length}): ${uniq(missingOther.map((r) => r.component)).join(", ") || "none"}`);

if (args.includes("--update-baseline")) {
  fs.writeFileSync(baselinePath, JSON.stringify(state, null, 1) + "\n");
  console.log(`baseline written: ${path.relative(repo, baselinePath)}`);
}
if (args.includes("--check")) {
  if (!fs.existsSync(baselinePath)) { console.log("no baseline file: run with --update-baseline first"); process.exit(1); }
  const base = JSON.parse(read(baselinePath));
  const problems = [];
  for (const comp of base.ownedWithNotice) if (!state.ownedWithNotice.includes(comp)) problems.push(`${comp} lost its ResearchNotice`);
  if (state.ownedWithNotice.length < base.ownedWithNotice.length) problems.push(`owned tabs with the notice fell from ${base.ownedWithNotice.length} to ${state.ownedWithNotice.length}`);
  for (const [comp, n] of Object.entries(state.ownedMissingCount)) {
    const was = base.ownedMissingCount[comp];
    if (was !== undefined && n > was) problems.push(`${comp} now misses ${n} disclosure criteria (baseline ${was})`);
  }
  if (problems.length) { console.log("COVERAGE REGRESSED:\n - " + problems.join("\n - ")); process.exit(1); }
  console.log(`coverage ok against baseline (${base.ownedWithNotice.length} owned tabs with the notice)`);
}
