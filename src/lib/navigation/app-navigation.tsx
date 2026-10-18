"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { buildNavQuery, navReducer, parseNavQuery, type NavState } from "./nav-state";
import { resolveStudyRoute, resolveTickerRoute } from "./study-routes";
import { groupById } from "./trading-structure";
import { formatAlertPrefill } from "./alert-prefill";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

// Kept for existing imports: the Assistant and the onboarding wizard describe a target as a primary id plus an optional secondary id.
export interface NavTarget {
  primaryId: string;
  secondaryId?: string;
}

interface AppNavigationContextValue {
  /** What is on screen, in the same shape as the URL (see nav-state.ts). Tabs with a `navLevel` read their active tab from here. */
  state: NavState;
  /** The asset class of the Trading Agent group the user was last in, so the Study Library can default to the current context. */
  lastAssetClass: AssetClass | null;
  /** Existing API (Assistant, onboarding wizard): go to a primary tab and optionally one of its secondary tabs. */
  navigateTo: (primaryId: string, secondaryId?: string) => void;
  /** Replace the whole state, for example with the result of resolveStudyRoute. */
  navigate: (next: NavState) => void;
  /** Change part of the current state (open or close a study, set a ticker) without leaving the current tab. */
  patch: (patch: Partial<NavState>) => void;
  select: (level: "primary" | "secondary" | "tertiary", id: string, parentId?: string) => void;
  /** Open a study by registry id in its asset-class group (or the given class). Returns false when the id is unknown. */
  openStudy: (studyId: string, opts?: { assetClass?: AssetClass; ticker?: string }) => boolean;
  /** Open a ticker's chart in its asset-class group. */
  openTicker: (symbol: string, assetClass?: AssetClass) => boolean;
  /** Chart-to-alert: open the Alerts tab with a Price Threshold row pre-filled from a line drawn on a chart. Returns false for a bad price. */
  createAlert: (a: { symbol: string; price: number; direction: "above" | "below" }) => boolean;
  /** Build a shareable same-page link (path plus query) for a state. */
  hrefFor: (next: NavState) => string;
}

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

const EMPTY: NavState = {};

export function AppNavigationProvider({ children, syncUrl = true }: { children: ReactNode; syncUrl?: boolean }) {
  const [state, dispatch] = useReducer(navReducer, EMPTY);
  const [lastAssetClass, setLastAssetClass] = useState<AssetClass | null>(null);
  // False until the URL has been read on the client. The server and the first client render both show the default tabs
  // (so hydration matches); the URL is applied right after, and nothing is written back to it until then.
  const [ready, setReady] = useState(!syncUrl);
  const pathRef = useRef("");

  // Read the URL once, then follow Back and Forward.
  useEffect(() => {
    if (!syncUrl) return;
    pathRef.current = window.location.pathname;
    dispatch({ type: "hydrate", state: parseNavQuery(window.location.search) });
    setReady(true);
    const onPop = () => dispatch({ type: "hydrate", state: parseNavQuery(window.location.search) });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncUrl]);

  // Write state changes to the URL (a history entry each, so Back works). Skipped when the URL already says the same thing.
  useEffect(() => {
    if (!syncUrl || !ready) return;
    const wanted = buildNavQuery(state);
    const current = buildNavQuery(parseNavQuery(window.location.search));
    if (wanted === current) return;
    try {
      window.history.pushState(null, "", wanted ? `${pathRef.current || window.location.pathname}?${wanted}` : pathRef.current || window.location.pathname);
    } catch {
      // History API blocked (sandboxed frame): navigation still works, it just is not addressable.
    }
  }, [state, ready, syncUrl]);

  useEffect(() => {
    const group = state.primaryId === "trading" ? groupById(state.secondaryId) : undefined;
    if (group) setLastAssetClass(group.assetClass);
    else if (state.assetClass && state.secondaryId === "studies") setLastAssetClass(state.assetClass as AssetClass);
  }, [state]);

  const navigateTo = useCallback((primaryId: string, secondaryId?: string) => {
    dispatch({ type: "navigate", state: secondaryId ? { primaryId, secondaryId } : { primaryId } });
  }, []);
  const navigate = useCallback((next: NavState) => dispatch({ type: "navigate", state: next }), []);
  const patch = useCallback((p: Partial<NavState>) => dispatch({ type: "patch", patch: p }), []);
  const select = useCallback((level: "primary" | "secondary" | "tertiary", id: string, parentId?: string) => {
    if (level === "primary") dispatch({ type: "select", level, id });
    else dispatch({ type: "select", level, id, parentId: parentId ?? "" });
  }, []);
  const openStudy = useCallback((studyId: string, opts?: { assetClass?: AssetClass; ticker?: string }) => {
    const route = resolveStudyRoute(studyId, opts?.assetClass, opts?.ticker);
    if (!route) return false;
    dispatch({ type: "navigate", state: route });
    return true;
  }, []);
  const openTicker = useCallback((symbol: string, assetClass?: AssetClass) => {
    const route = resolveTickerRoute(symbol, assetClass);
    if (!route) return false;
    dispatch({ type: "navigate", state: route });
    return true;
  }, []);
  const createAlert = useCallback((a: { symbol: string; price: number; direction: "above" | "below" }) => {
    const alert = formatAlertPrefill(a);
    if (!alert) return false;
    dispatch({ type: "navigate", state: { primaryId: "trading", secondaryId: "alerts", alert } });
    return true;
  }, []);
  const hrefFor = useCallback((next: NavState) => {
    const q = buildNavQuery(next);
    return q ? `?${q}` : "?";
  }, []);

  const value = useMemo<AppNavigationContextValue>(
    () => ({ state, lastAssetClass, navigateTo, navigate, patch, select, openStudy, openTicker, createAlert, hrefFor }),
    [state, lastAssetClass, navigateTo, navigate, patch, select, openStudy, openTicker, createAlert, hrefFor]
  );

  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

// Throws outside a Provider — use this from code that only ever renders
// inside AppNavigationProvider (e.g. the Assistant's routing button).
export function useAppNavigation() {
  const ctx = useContext(AppNavigationContext);
  if (!ctx) {
    throw new Error("useAppNavigation must be used within an AppNavigationProvider");
  }
  return ctx;
}

// Returns null outside a Provider — used by Tabs.tsx, which renders in many
// places that aren't wrapped in AppNavigationProvider and must keep working
// unchanged there.
export function useAppNavigationOptional() {
  return useContext(AppNavigationContext);
}
