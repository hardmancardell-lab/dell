"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssetClass, PortfolioHolding, RealizedSale } from "./types";

const STORAGE_KEY = "trading-agent-portfolio";
const REALIZED_PNL_STORAGE_KEY = "trading-agent-realized-pnl";
// usePortfolio()/useRealizedPnl() are called independently by multiple
// components at once (the Dashboard, the Faye chat widget, etc.) -- each
// call creates its own React state, so a write from one instance doesn't
// otherwise reach the others until they remount. This event is how every
// instance learns a write happened anywhere, in this same tab, and re-reads.
const PORTFOLIO_CHANGED_EVENT = "portfolio-storage-changed";

function announcePortfolioChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PORTFOLIO_CHANGED_EVENT));
}

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

function readStoredRealizedPnl(): RealizedSale[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REALIZED_PNL_STORAGE_KEY);
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
    const onChanged = () => setHoldings(readStoredPortfolio());
    window.addEventListener(PORTFOLIO_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PORTFOLIO_CHANGED_EVENT, onChanged);
  }, []);

  // Every writer below writes to localStorage synchronously with plain reads
  // (readStoredPortfolio()), then calls the plain setHoldings(value) form,
  // then announces -- deliberately NOT the setHoldings(current => ...)
  // functional-updater form. That form's callback runs on React's own
  // schedule, not necessarily before the next line executes, so announcing
  // right after it is a real race: another instance's listener can re-read
  // localStorage before this write has actually landed. Reading fresh from
  // localStorage directly sidesteps that entirely.
  const persist = useCallback((next: PortfolioHolding[]) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setHoldings(next);
    announcePortfolioChanged();
  }, []);

  const addHolding = useCallback(
    (
      symbol: string,
      assetClass: AssetClass,
      shares: number,
      costBasisPerShare: number,
      acquiredDate: string,
      extra?: Pick<PortfolioHolding, "optionRight" | "strikePrice" | "expirationDate" | "underlyingSymbol" | "contractMultiplier">
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
        ...extra,
      };
      const next = [...readStoredPortfolio(), holding];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setHoldings(next);
      announcePortfolioChanged();
    },
    []
  );

  const removeHolding = useCallback((id: string) => {
    const next = readStoredPortfolio().filter((h) => h.id !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setHoldings(next);
    announcePortfolioChanged();
  }, []);

  /**
   * Local equivalent of sellClientHolding() in advisor-clients-db.ts — same
   * per-lot cost basis math, same "reduce or fully remove the lot" behavior,
   * same rule that only a real sale (not a plain removeHolding, e.g. deleting
   * a position entered in error) ever writes a realized-pnl row. Kept local
   * to this hook (rather than a shared helper) since the two sides read/write
   * different stores (Supabase vs. localStorage) with no code in common
   * beyond the arithmetic itself.
   */
  const sellHolding = useCallback(
    (holdingId: string, sharesSold: number, salePricePerShare: number, fee: number, saleDate: string): RealizedSale | null => {
      if (sharesSold <= 0) return null;
      const holding = readStoredPortfolio().find((h) => h.id === holdingId);
      if (!holding || sharesSold > holding.shares) return null;

      const realizedPnl = (salePricePerShare - holding.costBasisPerShare) * sharesSold - fee;
      const sale: RealizedSale = {
        id: crypto.randomUUID(),
        symbol: holding.symbol,
        sharesSold,
        salePricePerShare,
        fee,
        costBasisPerShare: holding.costBasisPerShare,
        realizedPnl,
        saleDate,
        createdAt: new Date().toISOString(),
      };
      const nextSales = [sale, ...readStoredRealizedPnl()];
      window.localStorage.setItem(REALIZED_PNL_STORAGE_KEY, JSON.stringify(nextSales));

      const remaining = holding.shares - sharesSold;
      const next =
        remaining === 0
          ? readStoredPortfolio().filter((h) => h.id !== holdingId)
          : readStoredPortfolio().map((h) => (h.id === holdingId ? { ...h, shares: remaining } : h));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setHoldings(next);
      announcePortfolioChanged();

      return sale;
    },
    []
  );

  return { holdings, hydrated, addHolding, removeHolding, sellHolding, setHoldings: persist };
}

/** Read-only view of the local realized-P&L ledger (see sellHolding above for the only writer). */
export function useRealizedPnl() {
  const [sales, setSales] = useState<RealizedSale[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSales(readStoredRealizedPnl());
    setHydrated(true);
    const onChanged = () => setSales(readStoredRealizedPnl());
    window.addEventListener(PORTFOLIO_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PORTFOLIO_CHANGED_EVENT, onChanged);
  }, []);

  const refresh = useCallback(() => setSales(readStoredRealizedPnl()), []);

  return { sales, hydrated, refresh };
}
