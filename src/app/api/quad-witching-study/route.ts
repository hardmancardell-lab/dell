import { NextResponse } from "next/server";
import { runQuadWitchingStudy } from "@/lib/agents/trading-agent/skills/quad-witching-study";

export const maxDuration = 60;

const DEFAULT_TICKERS = ["SPY", "QQQ", "NVDA", "AAPL", "MSFT", "AMD", "TSLA"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers");
  const tickers = tickersParam
    ? tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_TICKERS;

  try {
    const result = await runQuadWitchingStudy(tickers);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
