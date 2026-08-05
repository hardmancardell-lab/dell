import { NextResponse } from "next/server";
import { evaluateAccountOrders } from "@/lib/agents/trading-agent/skills/paper-trading-engine";
import { getOrCreateAccount, isPaperTradingDbConfigured } from "@/lib/data/paper-trading-db";

// User-triggered "Check Orders" — evaluates this account's pending orders
// against real minute-bar price action since each order was placed. This
// exists because Vercel's Hobby plan allows only one cron job (already
// spoken for by /api/cron/check-alerts, extended to also sweep every
// account's pending orders once a day as a backstop) — there is no
// continuous background matching, so a manual check is the only way to see
// a fill land sooner than the next cron tick.
export async function POST(request: Request) {
  if (!isPaperTradingDbConfigured()) {
    return NextResponse.json({ error: "Paper trading is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json({ error: "Request body must include 'sessionId'." }, { status: 400 });
    }
    const account = await getOrCreateAccount(body.sessionId);
    const result = await evaluateAccountOrders(account.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
