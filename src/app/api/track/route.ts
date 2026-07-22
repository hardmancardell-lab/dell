import { NextResponse } from "next/server";
import { insertAnalyticsEvent, isSupabaseConfigured } from "@/lib/analytics/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.sessionId || typeof body.sessionId !== "string") {
      return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
    }
    if (!body.eventName || typeof body.eventName !== "string") {
      return NextResponse.json({ error: "Missing eventName." }, { status: 400 });
    }
    if (!isSupabaseConfigured()) {
      // Analytics is opt-in infrastructure that may not be wired up yet —
      // see SUPABASE_INTEGRATION_NOTES.md. Not an error from the caller's
      // perspective, just a no-op.
      return new NextResponse(null, { status: 204 });
    }
    await insertAnalyticsEvent({
      sessionId: body.sessionId,
      eventName: body.eventName,
      agent: body.agent ?? null,
      tab: body.tab ?? null,
      symbol: body.symbol ?? null,
      metadata: body.metadata ?? null,
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    // Analytics must never surface an error to the client or break the app.
    return new NextResponse(null, { status: 204 });
  }
}
