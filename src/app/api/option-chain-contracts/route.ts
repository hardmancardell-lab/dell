import { NextResponse } from "next/server";
import { fetchOptionsChain } from "@/lib/data/market-data";

/**
 * Returns the raw per-contract MarketOptionsChain (bid/ask/last/OI/volume/
 * greeks per strike, both sides) — distinct from /api/options-chain, which
 * wraps getOptionsChainSummary and only returns aggregated strike totals.
 * This is the real "order chain" for options paper trading: every row here
 * is a specific tradeable contract, not a rollup.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const expiration = searchParams.get("expiration") ?? undefined;
  try {
    const chain = await fetchOptionsChain(ticker.trim().toUpperCase(), expiration);
    return NextResponse.json(chain);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
