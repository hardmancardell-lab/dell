import { listAdvisorClients, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { getGuidedTradeSignals } from "./guided-trade-signals";
import type { GuidedTradeSignal } from "../types";

export interface BookRiskClientExposure {
  clientName: string;
  clientSlug: string;
  shares: number;
}

export interface BookRiskSymbolRow {
  symbol: string;
  totalShares: number;
  clientCount: number;
  clients: BookRiskClientExposure[];
  liveSignal: Pick<GuidedTradeSignal, "strategyType" | "headline" | "historicalWinRatePct" | "sampleSize"> | null;
}

export interface BookRiskSummary {
  generatedAt: string;
  clientsScanned: number;
  symbolsHeld: number;
  symbolsWithLiveSignal: number;
  bySymbol: BookRiskSymbolRow[];
}

/**
 * Admin-side aggregate across every real advisor client's holdings,
 * cross-referenced against today's live+validated Guided Trade Signals —
 * "which of the symbols our actual clients hold have a real signal
 * triggering right now," using data that already exists in both systems.
 * With one client today this is a small table; the value compounds as the
 * client count grows without any new data collection required.
 */
export async function getBookRiskSummary(): Promise<BookRiskSummary> {
  const clients = await listAdvisorClients();
  const perClientHoldings = await Promise.all(
    clients.map(async (c) => ({ client: c, holdings: await listClientHoldings(c.id) }))
  );

  const liveSignals = await getGuidedTradeSignals();
  const signalBySymbol = new Map<string, GuidedTradeSignal>();
  for (const s of liveSignals) signalBySymbol.set(s.ticker.toUpperCase(), s);

  const bySymbolMap = new Map<string, BookRiskSymbolRow>();
  for (const { client, holdings } of perClientHoldings) {
    for (const h of holdings) {
      const symbol = h.symbol.toUpperCase();
      let row = bySymbolMap.get(symbol);
      if (!row) {
        const signal = signalBySymbol.get(symbol) ?? null;
        row = {
          symbol,
          totalShares: 0,
          clientCount: 0,
          clients: [],
          liveSignal: signal
            ? { strategyType: signal.strategyType, headline: signal.headline, historicalWinRatePct: signal.historicalWinRatePct, sampleSize: signal.sampleSize }
            : null,
        };
        bySymbolMap.set(symbol, row);
      }
      row.totalShares += h.shares;
      row.clientCount += 1;
      row.clients.push({ clientName: client.name, clientSlug: client.slug, shares: h.shares });
    }
  }

  const bySymbol = [...bySymbolMap.values()].sort((a, b) => {
    // Symbols with a live signal float to the top — that's the actionable subset.
    if (Boolean(a.liveSignal) !== Boolean(b.liveSignal)) return a.liveSignal ? -1 : 1;
    return b.totalShares - a.totalShares;
  });

  return {
    generatedAt: new Date().toISOString(),
    clientsScanned: clients.length,
    symbolsHeld: bySymbol.length,
    symbolsWithLiveSignal: bySymbol.filter((r) => r.liveSignal !== null).length,
    bySymbol,
  };
}
