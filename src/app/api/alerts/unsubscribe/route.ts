import { NextResponse } from "next/server";
import { deactivateSubscriptionByToken, isAlertsDbConfigured } from "@/lib/data/alerts-db";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";

// Public by design (link in every alert email). Best-effort per-instance limit: 30 attempts per 15 min per IP.
const limiter = new SlidingWindowLimiter(30, 15 * 60_000);

export async function GET(request: Request) {
  if (!isAlertsDbConfigured()) {
    return NextResponse.json(
      { error: "Alerts are not configured on this deployment — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset." },
      { status: 503 }
    );
  }

  const decision = limiter.hit(clientIp(request));
  if (!decision.allowed) return tooManyRequests(decision);

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token || token.length > 200) {
    return NextResponse.json({ error: "Missing required 'token' query param." }, { status: 400 });
  }

  try {
    const found = await deactivateSubscriptionByToken(token);
    if (!found) {
      return NextResponse.json({ error: "No matching active subscription found for this token." }, { status: 404 });
    }
    return new NextResponse("You have been unsubscribed from alerts.", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    // Do not echo database error text to an unauthenticated caller.
    console.error("alerts/unsubscribe failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not process the request. Please try again later." }, { status: 500 });
  }
}
