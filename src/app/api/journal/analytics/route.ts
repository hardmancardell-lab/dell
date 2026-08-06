import { NextResponse } from "next/server";
import { getJournalPositions, isJournalDbConfigured } from "@/lib/data/journal-db";
import { computeJournalAnalytics } from "@/lib/agents/trading-agent/skills/journal-analytics";

export async function GET() {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const positions = await getJournalPositions();
    const analytics = computeJournalAnalytics(positions);
    return NextResponse.json({ analytics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
