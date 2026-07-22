"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AssetClass, WatchlistEntry, WatchlistMeta } from "./types";

const ENTRIES_KEY = "trading-agent-watchlist";
const META_KEY = "trading-agent-watchlist-meta";
const ACTIVE_KEY = "trading-agent-watchlist-active";
const DEFAULT_WATCHLIST_ID = "default";
const DEFAULT_WATCHLIST_NAME = "My Watchlist";

function readRaw<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface LegacyWatchlistEntry {
  symbol: string;
  assetClass: AssetClass;
}

/**
 * One-time migration from the pre-multi-watchlist flat-list schema: any
 * existing entries (no watchlistId field) get stamped into a "default"
 * watchlist so existing users lose nothing. The meta key's presence marks
 * migration as already done — a brand-new user with no data in either key
 * still ends up with one default WatchlistMeta, so the UI never needs a
 * "zero watchlists" state.
 */
function migrateIfNeeded(): { entries: WatchlistEntry[]; meta: WatchlistMeta[] } {
  const existingMeta = readRaw<WatchlistMeta[]>(META_KEY);
  if (existingMeta !== null) {
    const entries = readRaw<WatchlistEntry[]>(ENTRIES_KEY) ?? [];
    return { entries, meta: existingMeta };
  }
  const legacy = readRaw<LegacyWatchlistEntry[]>(ENTRIES_KEY) ?? [];
  const entries: WatchlistEntry[] = legacy.map((e) => ({ ...e, watchlistId: DEFAULT_WATCHLIST_ID }));
  const meta: WatchlistMeta[] = [{ id: DEFAULT_WATCHLIST_ID, name: DEFAULT_WATCHLIST_NAME }];
  window.localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  return { entries, meta };
}

interface WatchlistContextValue {
  watchlists: WatchlistMeta[];
  activeWatchlistId: string;
  setActiveWatchlistId: (id: string) => void;
  createWatchlist: (name: string) => string;
  deleteWatchlist: (id: string) => void;
  entries: WatchlistEntry[]; // pre-filtered to activeWatchlistId
  hydrated: boolean;
  addEntry: (symbol: string, assetClass: AssetClass) => void;
  removeEntry: (symbol: string, assetClass: AssetClass) => void;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

/**
 * Client-side-only persistence — this app has no backend database or auth,
 * so watchlists live in the browser's localStorage. Known limitation:
 * per-browser, not synced across devices. Backed by a Context (not
 * per-instance useState) so every simultaneously-mounted consumer shares one
 * source of truth: OptionsDashboardTab reads this directly for its own
 * GEX/skew sections AND embeds TradingDashboardTab as a persistent child —
 * both need to see the same active watchlist without a full tab remount.
 */
export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [allEntries, setAllEntries] = useState<WatchlistEntry[]>([]);
  const [watchlists, setWatchlists] = useState<WatchlistMeta[]>([{ id: DEFAULT_WATCHLIST_ID, name: DEFAULT_WATCHLIST_NAME }]);
  const [activeWatchlistId, setActiveWatchlistIdState] = useState(DEFAULT_WATCHLIST_ID);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const { entries, meta } = migrateIfNeeded();
    setAllEntries(entries);
    setWatchlists(meta);
    const storedActive = readRaw<string>(ACTIVE_KEY);
    const activeId = storedActive && meta.some((w) => w.id === storedActive) ? storedActive : (meta[0]?.id ?? DEFAULT_WATCHLIST_ID);
    setActiveWatchlistIdState(activeId);
    setHydrated(true);
  }, []);

  const setActiveWatchlistId = useCallback((id: string) => {
    setActiveWatchlistIdState(id);
    window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(id));
  }, []);

  // If the active watchlist was deleted, fall back to whatever's first — kept
  // as a separate effect rather than nested inside deleteWatchlist's setState
  // updaters, which should stay pure.
  useEffect(() => {
    if (hydrated && watchlists.length > 0 && !watchlists.some((w) => w.id === activeWatchlistId)) {
      setActiveWatchlistId(watchlists[0].id);
    }
  }, [hydrated, watchlists, activeWatchlistId, setActiveWatchlistId]);

  const createWatchlist = useCallback(
    (name: string): string => {
      const trimmed = name.trim();
      if (!trimmed) return activeWatchlistId;
      const id = crypto.randomUUID();
      setWatchlists((current) => {
        const next = [...current, { id, name: trimmed }];
        window.localStorage.setItem(META_KEY, JSON.stringify(next));
        return next;
      });
      setActiveWatchlistId(id);
      return id;
    },
    [activeWatchlistId, setActiveWatchlistId]
  );

  const deleteWatchlist = useCallback((id: string) => {
    setWatchlists((current) => {
      if (current.length <= 1) return current; // never delete the last remaining list
      const next = current.filter((w) => w.id !== id);
      window.localStorage.setItem(META_KEY, JSON.stringify(next));
      return next;
    });
    setAllEntries((current) => {
      const next = current.filter((e) => e.watchlistId !== id);
      window.localStorage.setItem(ENTRIES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const addEntry = useCallback(
    (symbol: string, assetClass: AssetClass) => {
      const trimmed = symbol.trim().toUpperCase();
      if (!trimmed) return;
      setAllEntries((current) => {
        // Deduped by (watchlistId, symbol, assetClass) — not symbol alone.
        // The same symbol can legitimately sit in one list under two asset
        // classes at once (e.g. AMD as an equity signal AND as an options
        // underlying) since every tab already scopes its scan to one asset
        // class. Deduping by symbol alone silently dropped the add whenever
        // the symbol already existed under a different class, with no error
        // shown — that looked like "the indicators just don't work."
        if (current.some((e) => e.watchlistId === activeWatchlistId && e.symbol === trimmed && e.assetClass === assetClass)) {
          return current;
        }
        const next = [...current, { watchlistId: activeWatchlistId, symbol: trimmed, assetClass }];
        window.localStorage.setItem(ENTRIES_KEY, JSON.stringify(next));
        return next;
      });
    },
    [activeWatchlistId]
  );

  const removeEntry = useCallback(
    (symbol: string, assetClass: AssetClass) => {
      setAllEntries((current) => {
        const next = current.filter(
          (e) => !(e.watchlistId === activeWatchlistId && e.symbol === symbol && e.assetClass === assetClass)
        );
        window.localStorage.setItem(ENTRIES_KEY, JSON.stringify(next));
        return next;
      });
    },
    [activeWatchlistId]
  );

  const entries = allEntries.filter((e) => e.watchlistId === activeWatchlistId);

  const value: WatchlistContextValue = {
    watchlists,
    activeWatchlistId,
    setActiveWatchlistId,
    createWatchlist,
    deleteWatchlist,
    entries,
    hydrated,
    addEntry,
    removeEntry,
  };

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) {
    throw new Error("useWatchlist() must be used within a WatchlistProvider (see src/app/page.tsx).");
  }
  return ctx;
}
