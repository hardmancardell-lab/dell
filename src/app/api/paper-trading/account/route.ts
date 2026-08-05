import { NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/agents/trading-agent/skills/paper-trading-engine";
import { isPaperTradingDbConfigured } from "@/lib/data/paper-trading-db";

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
    const summary = await getAccountSummary(sessionId);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
