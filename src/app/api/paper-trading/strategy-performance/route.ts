import { NextResponse } from "next/server";
import { getAccountBySessionId, getTradeLog, isPaperTradingDbConfigured } from "@/lib/data/paper-trading-db";
import { summarizeStrategies } from "@/lib/agents/trading-agent/skills/paper-strategy-performance";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing required 'sessionId' query param." }, { status: 400 });
  }
  if (!isPaperTradingDbConfigured()) {
    return NextResponse.json({ error: "Paper trading is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const account = await getAccountBySessionId(sessionId);
    if (!account) return NextResponse.json(summarizeStrategies([]));
    const rows = await getTradeLog(account.id);
    return NextResponse.json(summarizeStrategies(rows));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // The trade log table is created by db/migrations/2026-10-05_paper_trade_log.sql.
    if (/paper_trade_log/.test(message)) {
      return NextResponse.json({ error: "Trade log is not set up yet. Apply db/migrations/2026-10-05_paper_trade_log.sql in Supabase." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
