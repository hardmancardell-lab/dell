import { NextResponse } from "next/server";
import { fetchOptionsChain, fetchQuote } from "@/lib/data/market-data";

/**
 * Returns the raw per-contract MarketOptionsChain (bid/ask/last/OI/volume/
 * greeks per strike, both sides) plus the underlying's real current price —
 * distinct from /api/options-chain, which wraps getOptionsChainSummary and
 * only returns aggregated strike totals. This is the real "order chain" for
 * options paper trading: every row here is a specific tradeable contract,
 * not a rollup. underlyingPrice is a real quote (not inferred from the
 * chain), used client-side to shade ITM strikes and mark the ATM row.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const symbol = ticker.trim().toUpperCase();
  const expiration = searchParams.get("expiration") ?? undefined;
  try {
    const [chain, quote] = await Promise.all([fetchOptionsChain(symbol, expiration), fetchQuote(symbol)]);
    return NextResponse.json({ ...chain, underlyingPrice: quote.lastPrice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
