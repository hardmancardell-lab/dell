import { NextResponse } from "next/server";
import { cancelUserOrder } from "@/lib/agents/trading-agent/skills/paper-trading-engine";
import { isPaperTradingDbConfigured } from "@/lib/data/paper-trading-db";

export async function POST(request: Request) {
  if (!isPaperTradingDbConfigured()) {
    return NextResponse.json({ error: "Paper trading is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as { sessionId?: string; orderId?: string };
    if (!body.sessionId || !body.orderId) {
      return NextResponse.json({ error: "Request body must include 'sessionId' and 'orderId'." }, { status: 400 });
    }
    await cancelUserOrder(body.orderId, body.sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
