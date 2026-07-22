import { fetchQuote } from "@/lib/data/market-data";
import { TOP_TRADED_PAIRS } from "./top-traded-pairs";
import type { ForexRatesSummary } from "../types";

export async function getTopForexRates(): Promise<ForexRatesSummary> {
  const rates = await Promise.all(
    TOP_TRADED_PAIRS.map(async (pair) => {
      try {
        const quote = await fetchQuote(pair);
        return { pair, price: quote.lastPrice, error: null };
      } catch (error) {
        return { pair, price: null, error: error instanceof Error ? error.message : "Unknown error" };
      }
    })
  );

  return {
    rates,
    asOf: new Date().toISOString(),
    dataLimitations: [
      "OANDA's volume field is a tick count (number of price updates), not traded volume — forex is OTC/decentralized with no consolidated tape, so there's no equivalent to an equity's share volume.",
      "Client-side polling (see CurrencyDashboardTab.tsx), not a real push/websocket stream — this app is request-driven, no background server process.",
    ],
  };
}
