import { NextResponse } from "next/server";
import { getDailyBars } from "@/lib/agents/trading-agent/skills/daily-bars";

// TEMP: read-only diagnostic to answer "which watchlist ticker has had
// rising volume N days in a row" using real daily bars. Delete after use.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get("tickers") ?? "";
  const tickers = [...new Set(tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))];

  const results = await Promise.all(
    tickers.map(async (symbol) => {
      try {
        const bars = await getDailyBars(symbol, 20);
        if (bars.length < 4) {
          return { symbol, error: "Not enough bars.", streak: null, lastVolumes: null };
        }
        const recent = bars.slice(-6); // last 6 real trading days
        let streak = 0;
        for (let i = recent.length - 1; i > 0; i--) {
          if (recent[i].volume > recent[i - 1].volume) streak++;
          else break;
        }
        return {
          symbol,
          error: null,
          streak,
          lastVolumes: recent.map((b) => ({ date: b.dateKey, volume: b.volume })),
        };
      } catch (err) {
        return { symbol, error: err instanceof Error ? err.message : "unknown error", streak: null, lastVolumes: null };
      }
    })
  );

  return NextResponse.json({ results });
}
