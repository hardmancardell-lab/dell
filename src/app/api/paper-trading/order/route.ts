import { NextResponse } from "next/server";
import { isValidSessionId } from "@/lib/data/postgrest-safe";
import { PaperOrderValidationError, placeOrder, validatePaperOrderInput } from "@/lib/agents/trading-agent/skills/paper-trading-engine";
import { isPaperTradingDbConfigured } from "@/lib/data/paper-trading-db";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";

const MAX_BODY_BYTES = 32 * 1024;
// Best-effort, per-instance: 60 order submissions per 10 minutes per IP.
const limiter = new SlidingWindowLimiter(60, 10 * 60_000);

export async function POST(request: Request) {
  if (!isPaperTradingDbConfigured()) {
    return NextResponse.json({ error: "Paper trading is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const decision = limiter.hit(clientIp(request));
  if (!decision.allowed) return tooManyRequests(decision, "Too many orders. Please slow down.");
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }
    const body = (await request.json().catch(() => null)) as { sessionId?: unknown; order?: unknown } | null;
    if (!body || !isValidSessionId(body.sessionId) || !body.order || typeof body.order !== "object") {
      return NextResponse.json({ error: "Request body must include 'sessionId' and 'order'." }, { status: 400 });
    }
    // Validated here (and again inside placeOrder): side, order type, asset class, symbol, finite positive bounded numbers.
    validatePaperOrderInput(body.order);
    const result = await placeOrder(body.sessionId, body.order as never);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (error instanceof PaperOrderValidationError) return NextResponse.json({ error: message }, { status: 400 });
    // Database/provider failures carry internal detail; keep that out of an anonymous caller's response.
    if (/^Supabase request failed/i.test(message)) {
      console.error("paper-trading/order failed:", message.slice(0, 300));
      return NextResponse.json({ error: "Paper trading is temporarily unavailable. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
