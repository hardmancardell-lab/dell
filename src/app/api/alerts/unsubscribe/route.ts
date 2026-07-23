import { NextResponse } from "next/server";
import { deactivateSubscriptionByToken, isAlertsDbConfigured } from "@/lib/data/alerts-db";

export async function GET(request: Request) {
  if (!isAlertsDbConfigured()) {
    return NextResponse.json(
      { error: "Alerts are not configured on this deployment — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
