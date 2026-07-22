"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssetClass, PortfolioHolding } from "./types";

const STORAGE_KEY = "trading-agent-portfolio";

function readStoredPortfolio(): PortfolioHolding[] {
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
 * Client-side-only persistence, same pattern as watchlist-storage.ts — this
 * app has no backend database or auth, so holdings live in the browser's
 * localStorage. Known limitation: per-browser, not synced across devices.
 * Unlike the watchlist (dedup by symbol), multiple lots of the same symbol
 * are allowed as separate entries (realistic for dollar-cost-averaged
 * positions), so each holding gets its own id rather than being keyed by
 * symbol.
 */
export function usePortfolio() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHoldings(readStoredPortfolio());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: PortfolioHolding[]) => {
    setHoldings(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const addHolding = useCallback(
    (
      symbol: string,
      assetClass: AssetClass,
      shares: number,
      costBasisPerShare: number,
      acquiredDate: string
    ) => {
      const trimmed = symbol.trim().toUpperCase();
      if (!trimmed || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(costBasisPerShare)) return;
      const holding: PortfolioHolding = {
        id: crypto.randomUUID(),
        symbol: trimmed,
        assetClass,
        shares,
        costBasisPerShare,
        acquiredDate,
      };
      setHoldings((current) => {
        const next = [...current, holding];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const removeHolding = useCallback((id: string) => {
    setHoldings((current) => {
      const next = current.filter((h) => h.id !== id);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { holdings, hydrated, addHolding, removeHolding, setHoldings: persist };
}
