import { NextResponse } from "next/server";
import { getJournalPositions, isJournalDbConfigured } from "@/lib/data/journal-db";
import { computeJournalAnalytics } from "@/lib/agents/trading-agent/skills/journal-analytics";

export async function GET(request: Request) {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing required 'sessionId' query param." }, { status: 400 });
  }
  try {
    const positions = await getJournalPositions(sessionId);
    const analytics = computeJournalAnalytics(positions);
    return NextResponse.json({ analytics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
