import { NextResponse } from "next/server";
import { getOptionsChainSummary } from "@/lib/agents/trading-agent/skills/options-chain";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const expiration = searchParams.get("expiration") ?? undefined;
  try {
    const summary = await getOptionsChainSummary(ticker, expiration);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
