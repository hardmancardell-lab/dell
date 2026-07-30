"use client";

import { useCallback, useEffect, useRef } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import type { ResearchWatchlistEntry } from "./types";

const LEGACY_STORAGE_KEY = "research-agent-watchlist";

/**
 * Research Agent has no watchlist store of its own — it reads/writes the
 * same shared, multi-list watchlist Trading Agent's Dashboard tab uses
 * (WatchlistProvider, mounted once at the app root in page.tsx), filtered to
 * equities since Research Agent is equity-only. A ticker added from either
 * agent shows up in both, in whichever watchlist is currently active.
 */
export function useResearchWatchlist() {
  const { entries, hydrated, addEntry, removeEntry } = useWatchlist();
  const migrated = useRef(false);

  // One-time migration for anyone with data under the old, Research-only
  // watchlist key: fold it into the shared watchlist, then clear the old key.
  useEffect(() => {
    if (!hydrated || migrated.current) return;
    migrated.current = true;
    try {
      const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const legacy = JSON.parse(raw) as ResearchWatchlistEntry[];
        if (Array.isArray(legacy)) {
          for (const e of legacy) {
            if (e?.symbol) addEntry(e.symbol, "equity");
          }
        }
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {
      // Malformed legacy data — nothing to migrate.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const symbols: ResearchWatchlistEntry[] = entries
    .filter((e) => e.assetClass === "equity")
    .map((e) => ({ symbol: e.symbol }));

  const addSymbol = useCallback((symbol: string) => addEntry(symbol, "equity"), [addEntry]);
  const removeSymbol = useCallback((symbol: string) => removeEntry(symbol, "equity"), [removeEntry]);

  return { symbols, hydrated, addSymbol, removeSymbol };
}
