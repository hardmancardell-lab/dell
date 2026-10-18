/**
 * Turns a study id (plus optional asset class and ticker) into the navigation state that opens it, and guesses an asset
 * class from a bare symbol. Pure functions, no React: used by the provider, the library, the palette and the tests.
 */
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import { ASSET_CLASSES, getStudy } from "./study-registry";
import { GROUP_STUDIES_TAB, groupForAssetClass, STUDIES_SECTION } from "./trading-structure";
import type { NavState } from "./nav-state";

const BONDS = new Set(["TLT", "IEF", "SHY", "AGG", "BND", "LQD", "HYG", "JNK", "TIP", "IEI", "TLH", "SHV", "BIL", "GOVT", "MUB", "EDV", "ZROZ", "VGSH", "VGIT", "VGLT"]);
const COMMODITY_ETFS = new Set(["GLD", "SLV", "USO", "UNG", "DBC", "DBA", "PDBC", "GDX", "CPER", "IAU", "WEAT", "CORN", "SOYB", "UGA", "BNO"]);
const FX_CODES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "MXN", "CNH", "CNY", "SGD", "HKD", "ZAR", "TRY"]);

/** Best-effort asset class for a typed symbol. Watchlist entries carry their own class and should win over this. */
export function inferAssetClass(symbol: string): AssetClass {
  const s = symbol.trim().toUpperCase();
  if (/^[A-Z0-9]{2,10}-USD$/.test(s)) return "crypto";
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(s)) return "forex";
  if (/^[A-Z]{6}$/.test(s) && FX_CODES.has(s.slice(0, 3)) && FX_CODES.has(s.slice(3))) return "forex";
  if (/=F$/.test(s)) return "future";
  if (BONDS.has(s)) return "bond";
  if (COMMODITY_ETFS.has(s)) return "commodity";
  return "equity";
}

export function isAssetClass(value: unknown): value is AssetClass {
  return typeof value === "string" && (ASSET_CLASSES as readonly string[]).includes(value);
}

/**
 * Where a study opens. Trading-wide tools open their own Trading Agent tab. Everything else opens in the asset-class
 * group that matches `assetClass` (or the study's first applicable class): as a direct tab when the group shows it
 * directly, otherwise inside the group's Studies tab. The class is implied by the group and is not stored separately.
 * Returns undefined for an unknown study id.
 */
export function resolveStudyRoute(studyId: string, assetClass?: string | null, ticker?: string | null): NavState | undefined {
  const study = getStudy(studyId);
  if (!study) return undefined;
  const tickerPart = ticker?.trim() ? { ticker: ticker.trim().toUpperCase() } : {};
  if (study.location) return study.status === "planned" ? undefined : { ...study.location };
  if (study.assetClasses.length === 0) return { primaryId: "trading", secondaryId: study.id };
  const cls: AssetClass = isAssetClass(assetClass) && study.assetClasses.includes(assetClass) ? assetClass : study.assetClasses[0];
  const group = groupForAssetClass(cls);
  if (!group) return undefined;
  const direct = group.directTabs.some((d) => d.studyId === study.id);
  if (direct) return { primaryId: "trading", secondaryId: group.id, tab: study.id, ...tickerPart };
  return { primaryId: "trading", secondaryId: group.id, tab: GROUP_STUDIES_TAB, studyId: study.id, ...tickerPart };
}

/** The Charts view for a ticker in its asset class's group. */
export function resolveTickerRoute(symbol: string, assetClass?: string | null): NavState | undefined {
  const cls: AssetClass = isAssetClass(assetClass) ? assetClass : inferAssetClass(symbol);
  const group = groupForAssetClass(cls);
  if (!group) return undefined;
  const charts = group.directTabs.find((d) => d.studyId === "charts") ?? group.directTabs[0];
  return { primaryId: "trading", secondaryId: group.id, tab: charts.studyId, ticker: symbol.trim().toUpperCase() };
}

/** The same study opened from the first-class Studies tab (no group). */
export function resolveGlobalStudyRoute(studyId: string, assetClass?: string | null, ticker?: string | null): NavState | undefined {
  const study = getStudy(studyId);
  if (!study || study.location) return undefined;
  const cls = isAssetClass(assetClass) && study.assetClasses.includes(assetClass) ? assetClass : study.assetClasses[0];
  return {
    primaryId: "trading",
    secondaryId: STUDIES_SECTION.id,
    studyId: study.id,
    ...(cls ? { assetClass: cls } : {}),
    ...(ticker?.trim() ? { ticker: ticker.trim().toUpperCase() } : {}),
  };
}
