import type { PortfolioHolding } from "@/lib/agents/trading-agent/types";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import type { ResearchHoldingRef } from "./types";

/** Most distinct stocks valued for one client. Each one can cost an SEC, a price and a rates call on a cold cache. */
export const MAX_RESEARCH_HOLDINGS = 12;

/** Same shape /api/company-lifecycle accepts. A symbol outside it is never sent upstream. */
export const RESEARCH_SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;

export interface ResearchTargets {
  refs: ResearchHoldingRef[];
  /** Stocks the Research section may value, upper case, de-duplicated, at most MAX_RESEARCH_HOLDINGS. */
  valuable: string[];
  holdsCrypto: boolean;
  /** Symbols per catalyst kind, used only to read the checked-in calendar (no outside call). */
  catalystSymbols: { equity: string[]; crypto: string[]; forex: string[] };
}

const NOT_COVERED: Record<string, string> = {
  option: "Options are not covered yet.",
  bond: "Bonds are not covered yet.",
  future: "Futures are not covered yet.",
  forex: "Currencies are not covered yet.",
  commodity: "Commodities are not covered yet.",
};

/**
 * Reduces a client's holdings to what the research may touch. This is the ONLY source of tickers for the client research
 * routes: a visitor never supplies one. No share counts, prices or cost basis leave this function.
 */
export function researchTargets(holdings: PortfolioHolding[]): ResearchTargets {
  const refs: ResearchHoldingRef[] = [];
  const seen = new Set<string>();
  const valuable: string[] = [];
  const equity = new Set<string>();
  const crypto = new Set<string>();
  const forex = new Set<string>();
  let holdsCrypto = false;

  for (const h of holdings) {
    const symbol = String(h.symbol ?? "").trim().toUpperCase();
    if (!symbol) continue;
    const key = `${h.assetClass}:${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (h.assetClass === "crypto") {
      holdsCrypto = true;
      crypto.add(symbol);
      refs.push({ symbol, assetClass: h.assetClass, assetClassLabel: assetClassLabel(h.assetClass), researchable: false, reason: "Crypto has no company filings. The market-wide crypto read is in the next section." });
      continue;
    }
    if (h.assetClass === "forex") forex.add(symbol);
    if (h.assetClass === "option") {
      const under = String(h.underlyingSymbol ?? "").trim().toUpperCase();
      if (RESEARCH_SYMBOL.test(under)) equity.add(under);
    }
    if (h.assetClass !== "equity") {
      refs.push({ symbol, assetClass: h.assetClass, assetClassLabel: assetClassLabel(h.assetClass), researchable: false, reason: NOT_COVERED[h.assetClass] ?? "Not covered yet." });
      continue;
    }
    if (!RESEARCH_SYMBOL.test(symbol)) {
      refs.push({ symbol, assetClass: h.assetClass, assetClassLabel: assetClassLabel(h.assetClass), researchable: false, reason: "This symbol is not in a form we can look up." });
      continue;
    }
    equity.add(symbol);
    if (valuable.length >= MAX_RESEARCH_HOLDINGS) {
      refs.push({ symbol, assetClass: h.assetClass, assetClassLabel: assetClassLabel(h.assetClass), researchable: false, reason: `Research is shown for up to ${MAX_RESEARCH_HOLDINGS} stocks at a time.` });
      continue;
    }
    valuable.push(symbol);
    refs.push({ symbol, assetClass: h.assetClass, assetClassLabel: assetClassLabel(h.assetClass), researchable: true, reason: null });
  }

  return { refs, valuable, holdsCrypto, catalystSymbols: { equity: [...equity], crypto: [...crypto], forex: [...forex] } };
}

/** True only when `symbol` is one of the stocks this client may have valued. Used to refuse any other ticker. */
export function isResearchableFor(targets: ResearchTargets, symbol: string): boolean {
  return targets.valuable.includes(symbol.trim().toUpperCase());
}
