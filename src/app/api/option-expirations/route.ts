import { NextResponse } from "next/server";
import * as tradier from "@/lib/data/tradier";
import { fetchOptionsChain } from "@/lib/data/market-data";

function isMockMode(): boolean {
  return process.env.MARKET_DATA_MOCK_MODE === "true" || process.env.SCHWAB_MOCK_MODE === "true";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const symbol = ticker.trim().toUpperCase();

  if (!isMockMode() && !process.env.TRADIER_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "Real option expirations require Tradier — TRADIER_ACCESS_TOKEN is not set." },
      { status: 503 }
    );
  }

  try {
    if (isMockMode()) {
      // Mock mode's synthetic chain (schwab-mock.ts) has exactly one fixed
      // expiration and ignores the expirationDate param — derived from the
      // chain's own contracts instead of calling Tradier.
      const chain = await fetchOptionsChain(symbol);
      const expiration = chain.calls[0]?.expirationDate ?? chain.puts[0]?.expirationDate;
      return NextResponse.json({ ticker: symbol, expirations: expiration ? [expiration] : [] });
    }
    const expirations = await tradier.getExpirations(symbol);
    return NextResponse.json({ ticker: symbol, expirations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
