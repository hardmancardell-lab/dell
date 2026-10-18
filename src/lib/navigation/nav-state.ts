/**
 * The app's navigation state and its URL form. Pure (no React, no window) so it can be tested under plain Node.
 *
 *   ?agent=trading&section=equities&tab=studies&study=backtest&ticker=AAPL
 *
 *   agent    primary tab id          (top-down | trading | portfolio | literacy | assistant)
 *   section  secondary tab id        (Trading Agent: guided-signals, studies, equities, bonds, ...)
 *   tab      tab inside an asset-class group (charts | dashboard | studies | ...)
 *   study    registry study id       (see study-registry.ts)
 *   class    asset class             (only used by the first-class Studies section; a group implies its own class)
 *   ticker   symbol to open the study or chart with
 *
 * Short forms are accepted and normalised: ?agent=trading&study=backtest&ticker=AAPL opens the Equities group's Studies
 * tab on Signal Backtest; ?agent=trading&ticker=NVDA opens NVDA's chart. Unknown ids are dropped, so a stale or
 * hand-edited link falls back to the nearest valid view instead of an empty screen.
 */
import { getStudy } from "./study-registry";
import { PRIMARY_TABS, SECONDARY_TABS, STUDIES_SECTION, groupById } from "./trading-structure";
import { isAssetClass, resolveStudyRoute, resolveTickerRoute } from "./study-routes";

export interface NavState {
  primaryId?: string;
  secondaryId?: string;
  tab?: string;
  studyId?: string;
  assetClass?: string;
  ticker?: string;
}

export type NavAction =
  | { type: "hydrate"; state: NavState }
  | { type: "navigate"; state: NavState }
  | { type: "select"; level: "primary"; id: string }
  | { type: "select"; level: "secondary"; id: string; parentId: string }
  | { type: "select"; level: "tertiary"; id: string; parentId: string }
  | { type: "patch"; patch: Partial<NavState> };

const FIELD_ORDER: Array<[keyof NavState, string]> = [
  ["primaryId", "agent"],
  ["secondaryId", "section"],
  ["tab", "tab"],
  ["studyId", "study"],
  ["assetClass", "class"],
  ["ticker", "ticker"],
];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TICKER_RE = /^[A-Za-z0-9^][A-Za-z0-9.=/_^-]{0,19}$/;

export function buildNavQuery(state: NavState): string {
  const params = new URLSearchParams();
  for (const [key, param] of FIELD_ORDER) {
    const v = state[key];
    if (v) params.set(param, v);
  }
  return params.toString();
}

function clean(v: string | null, re: RegExp): string | undefined {
  return v && re.test(v) ? v : undefined;
}

/** Parses and validates a query string into a canonical state. */
export function parseNavQuery(search: string): NavState {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const agent = clean(p.get("agent"), ID_RE);
  const section = clean(p.get("section"), ID_RE);
  const tab = clean(p.get("tab"), ID_RE);
  const studyId = clean(p.get("study"), ID_RE);
  const clsRaw = p.get("class");
  const ticker = clean(p.get("ticker"), TICKER_RE)?.toUpperCase();
  const assetClass = isAssetClass(clsRaw) ? clsRaw : undefined;
  const study = getStudy(studyId);

  if (!agent || !PRIMARY_TABS.some((t) => t.id === agent)) return {};
  const base: NavState = { primaryId: agent };

  if (agent !== "trading") {
    const sections = SECONDARY_TABS[agent];
    if (section && sections?.some((s) => s.id === section)) base.secondaryId = section;
    return base;
  }

  // Trading Agent, no section: a study or a ticker is routed to its home.
  if (!section) {
    if (study) return resolveStudyRoute(study.id, assetClass, ticker) ?? base;
    if (ticker) return resolveTickerRoute(ticker, assetClass) ?? base;
    return base;
  }
  if (!SECONDARY_TABS.trading.some((s) => s.id === section)) return base;
  base.secondaryId = section;

  const group = groupById(section);
  if (group) {
    const directIds = group.directTabs.map((d) => d.studyId);
    let nextTab = tab && (directIds.includes(tab) || tab === "studies") ? tab : undefined;
    let nextStudy = study && study.assetClasses.includes(group.assetClass) ? study.id : undefined;
    if (nextStudy && directIds.includes(nextStudy)) {
      nextTab = nextStudy; // a direct tab is itself a study
      nextStudy = undefined;
    } else if (nextStudy) {
      nextTab = "studies";
    }
    if (!nextTab && ticker && directIds.includes("charts")) nextTab = "charts";
    if (nextTab) base.tab = nextTab;
    if (nextStudy) base.studyId = nextStudy;
    if (ticker && (nextStudy || (nextTab && nextTab !== "studies"))) base.ticker = ticker;
    return base;
  }

  if (section === STUDIES_SECTION.id) {
    if (study) {
      base.studyId = study.id;
      const cls = assetClass && study.assetClasses.includes(assetClass) ? assetClass : study.assetClasses[0];
      if (cls) base.assetClass = cls;
      if (ticker) base.ticker = ticker;
    } else if (assetClass) {
      base.assetClass = assetClass; // the library's asset-class filter
    }
  }
  return base;
}

export function sameNav(a: NavState, b: NavState): boolean {
  return buildNavQuery(a) === buildNavQuery(b);
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "hydrate":
    case "navigate":
      return sameNav(state, action.state) ? state : { ...action.state };
    case "select": {
      if (action.level === "primary") {
        return state.primaryId === action.id ? state : { primaryId: action.id };
      }
      if (action.level === "secondary") {
        if (state.primaryId === action.parentId && state.secondaryId === action.id) return state;
        return { primaryId: action.parentId, secondaryId: action.id };
      }
      if (state.secondaryId === action.parentId && state.tab === action.id) return state;
      return { primaryId: "trading", secondaryId: action.parentId, tab: action.id };
    }
    case "patch": {
      const next: NavState = { ...state, ...action.patch };
      for (const k of Object.keys(next) as Array<keyof NavState>) if (next[k] === undefined || next[k] === "") delete next[k];
      return sameNav(state, next) ? state : next;
    }
  }
}
