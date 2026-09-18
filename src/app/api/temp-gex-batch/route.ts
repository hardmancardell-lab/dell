import { NextResponse } from "next/server";
import { computeGexSignal } from "@/lib/agents/trading-agent/skills/gex-signal";

// TEMP: read-only batch wrapper around the real GEX signal (live open
// interest, no historical/fabricated data) to check pin levels across
// several tickers at once on today's quad witching day. Delete after use.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers") ?? "";
  const tickers = [...new Set(tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))];

  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const signal = await computeGexSignal(ticker);
        return { ticker, signal };
      } catch (err) {
        return { ticker, error: err instanceof Error ? err.message : "unknown error" };
      }
    })
  );

  return NextResponse.json({ results });
}
