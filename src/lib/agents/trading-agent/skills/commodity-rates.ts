import { fetchQuote } from "@/lib/data/market-data";
import { TOP_TRADED_COMMODITIES } from "./top-traded-commodities";
import type { AssetRatesSummary } from "../types";

export async function getTopCommodityRates(): Promise<AssetRatesSummary> {
  const rates = await Promise.all(
    TOP_TRADED_COMMODITIES.map(async (symbol) => {
      try {
        const quote = await fetchQuote(symbol);
        return { symbol, price: quote.lastPrice, error: null };
      } catch (error) {
        return { symbol, price: null, error: error instanceof Error ? error.message : "Unknown error" };
      }
    })
  );

  return {
    rates,
    asOf: new Date().toISOString(),
    dataLimitations: [
      "These are ETF proxies (GLD, SLV, USO, etc.), not literal commodity futures contracts — real, live prices via Alpaca, but ETF share prices don't replicate a futures contract's margin, expiration, or contango/backwardation dynamics.",
      "Client-side polling (see CommoditiesDashboardTab.tsx), not a real push/websocket stream — this app is request-driven, no background server process.",
    ],
  };
}
