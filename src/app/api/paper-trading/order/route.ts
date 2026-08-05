import { NextResponse } from "next/server";
import { placeOrder } from "@/lib/agents/trading-agent/skills/paper-trading-engine";
import { isPaperTradingDbConfigured } from "@/lib/data/paper-trading-db";
import type { PaperOrderInput } from "@/lib/agents/trading-agent/types";

export async function POST(request: Request) {
  if (!isPaperTradingDbConfigured()) {
    return NextResponse.json({ error: "Paper trading is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as { sessionId?: string; order?: PaperOrderInput };
    if (!body.sessionId || !body.order) {
      return NextResponse.json({ error: "Request body must include 'sessionId' and 'order'." }, { status: 400 });
    }
    const result = await placeOrder(body.sessionId, body.order);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
