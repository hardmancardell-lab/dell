import { fetchQuote } from "@/lib/data/market-data";
import { TOP_TRADED_FUTURES_PROXIES } from "./top-traded-futures-proxies";
import type { AssetRatesSummary } from "../types";

export async function getTopFuturesRates(): Promise<AssetRatesSummary> {
  const rates = await Promise.all(
    TOP_TRADED_FUTURES_PROXIES.map(async (symbol) => {
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
      "No free source exists for literal futures-contract data anywhere (CME's API is pay-per-use; Databento/Massive/dxFeed all require a paid plan). These are real, live ETF proxies for the underlying exposure (SPY for /ES, GLD for /GC, etc.) — not the futures contracts themselves, so leverage, margin, expiration, and contango/backwardation don't carry over.",
      "Client-side polling (see FuturesDashboardTab.tsx), not a real push/websocket stream — this app is request-driven, no background server process.",
    ],
  };
}
