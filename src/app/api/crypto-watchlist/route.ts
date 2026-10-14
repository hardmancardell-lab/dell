import { NextResponse } from "next/server";
import { getCryptoWatchlistSnapshot } from "@/lib/agents/trading-agent/skills/crypto-watchlist";

export const maxDuration = 30;

/**
 * Last price and 24h / 7d change for a list of Coinbase USD pairs, from Coinbase's public market data (no key).
 *
 *   GET /api/crypto-watchlist?symbols=BTC-USD,ETH-USD
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({ error: "Missing required 'symbols' query param, for example BTC-USD,ETH-USD." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getCryptoWatchlistSnapshot(symbols));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
