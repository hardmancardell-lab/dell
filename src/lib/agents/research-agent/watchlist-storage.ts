"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResearchWatchlistEntry } from "./types";

const STORAGE_KEY = "research-agent-watchlist";

function readStoredWatchlist(): ResearchWatchlistEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Client-side-only persistence, same pattern as
 * trading-agent/watchlist-storage.ts — this app has no backend database or
 * auth. Simpler than the trading-agent version: Research Agent is
 * equity-only, so entries are just a ticker symbol, no asset class.
 */
export function useResearchWatchlist() {
  const [symbols, setSymbolsState] = useState<ResearchWatchlistEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSymbolsState(readStoredWatchlist());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: ResearchWatchlistEntry[]) => {
    setSymbolsState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const addSymbol = useCallback((symbol: string) => {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed) return;
    setSymbolsState((current) => {
      if (current.some((e) => e.symbol === trimmed)) return current;
      const next = [...current, { symbol: trimmed }];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeSymbol = useCallback((symbol: string) => {
    setSymbolsState((current) => {
      const next = current.filter((e) => e.symbol !== symbol);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { symbols, hydrated, addSymbol, removeSymbol, setSymbols: persist };
}
