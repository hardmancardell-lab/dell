/**
 * What the command palette (Ctrl+K / Cmd+K) lists and how it searches. Pure, so it is tested under plain Node.
 *
 * Items: every live study, every tab (agents, their sections, and the direct tabs of each Trading Agent group) and the
 * user's watchlist tickers. A typed symbol that is not on the watchlist is offered as "Open chart". Keys are stable
 * ("study:backtest", "tab:trading/equities", "ticker:AAPL") and are what pinned favourites and recents store.
 */
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import type { NavState } from "./nav-state";
import { fuzzyRank } from "./fuzzy";
import { ASSET_CLASS_LABEL, STUDIES } from "./study-registry";
import { ASSET_GROUPS, PRIMARY_TABS, SECONDARY_TABS } from "./trading-structure";
import { inferAssetClass, resolveStudyRoute, resolveTickerRoute } from "./study-routes";

export interface PaletteItem {
  key: string;
  kind: "study" | "tab" | "ticker";
  title: string;
  subtitle: string;
  target: NavState;
  /** Extra words the search matches on. */
  words: string;
}

export interface WatchlistTicker {
  symbol: string;
  assetClass: AssetClass;
}

const TYPED_TICKER_RE = /^[A-Za-z][A-Za-z0-9.=/^-]{0,11}$/;

export function buildPaletteItems(opts: { lastAssetClass?: AssetClass | null; watchlist?: WatchlistTicker[] }): PaletteItem[] {
  const items: PaletteItem[] = [];

  for (const s of STUDIES) {
    if (s.status === "planned") continue;
    const target = resolveStudyRoute(s.id, opts.lastAssetClass ?? undefined) ?? (s.location ? { ...s.location } : undefined);
    if (!target) continue;
    items.push({
      key: `study:${s.id}`,
      kind: "study",
      title: s.title,
      subtitle: `${s.category} · ${s.assetClasses.length ? s.assetClasses.map((c) => ASSET_CLASS_LABEL[c]).join(", ") : "Any market"}`,
      target,
      words: `${s.question} ${s.keywords ?? ""} study`,
    });
  }

  for (const p of PRIMARY_TABS) {
    items.push({ key: `tab:${p.id}`, kind: "tab", title: p.label, subtitle: "Agent", target: { primaryId: p.id }, words: "tab agent go to" });
    for (const sec of SECONDARY_TABS[p.id] ?? []) {
      items.push({
        key: `tab:${p.id}/${sec.id}`,
        kind: "tab",
        title: `${p.label} › ${sec.label}`,
        subtitle: "Tab",
        target: { primaryId: p.id, secondaryId: sec.id },
        words: "tab section go to",
      });
    }
  }
  for (const g of ASSET_GROUPS) {
    for (const d of [...g.directTabs, { studyId: "studies", label: "Studies" }]) {
      items.push({
        key: `tab:trading/${g.id}/${d.studyId}`,
        kind: "tab",
        title: `${g.label} › ${d.label}`,
        subtitle: "Tab",
        target: { primaryId: "trading", secondaryId: g.id, tab: d.studyId },
        words: "tab go to",
      });
    }
  }

  const seen = new Set<string>();
  for (const w of opts.watchlist ?? []) {
    const sym = w.symbol.trim().toUpperCase();
    const key = `ticker:${sym}`;
    if (!sym || seen.has(key)) continue;
    seen.add(key);
    const target = resolveTickerRoute(sym, w.assetClass);
    if (!target) continue;
    items.push({ key, kind: "ticker", title: sym, subtitle: `Watchlist · ${ASSET_CLASS_LABEL[w.assetClass]} chart`, target, words: "ticker symbol watchlist chart" });
  }
  return items;
}

/** "Open chart for XYZ" for a symbol the user typed that is not already listed. */
export function typedTickerItem(query: string, existing: PaletteItem[]): PaletteItem | null {
  const q = query.trim();
  if (!TYPED_TICKER_RE.test(q)) return null;
  const sym = q.toUpperCase();
  if (existing.some((i) => i.key === `ticker:${sym}`)) return null;
  const target = resolveTickerRoute(sym, inferAssetClass(sym));
  if (!target) return null;
  return { key: `ticker:${sym}`, kind: "ticker", title: `Open chart: ${sym}`, subtitle: `${ASSET_CLASS_LABEL[inferAssetClass(sym)]} chart`, target, words: sym };
}

export function searchPalette(items: PaletteItem[], query: string, limit = 40): PaletteItem[] {
  const ranked = fuzzyRank(query, items, (i) => [i.title, i.subtitle, i.words]).slice(0, limit);
  const typed = query.trim() ? typedTickerItem(query, items) : null;
  return typed ? [...ranked, typed] : ranked;
}

/** Pinned and recent keys resolved to items (unknown keys, for example a removed ticker, are dropped). */
export function itemsForKeys(items: PaletteItem[], keys: string[]): PaletteItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const out: PaletteItem[] = [];
  for (const k of keys) {
    let item = byKey.get(k);
    if (!item && k.startsWith("ticker:")) item = typedTickerItem(k.slice(7), items) ?? undefined; // a recent typed ticker
    if (item) out.push(item);
  }
  return out;
}
