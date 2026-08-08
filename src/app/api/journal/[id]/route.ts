import { NextResponse } from "next/server";
import { deleteJournalPosition, isJournalDbConfigured, updateJournalPosition } from "@/lib/data/journal-db";
import type { JournalEmotionTag, JournalStatus } from "@/lib/agents/trading-agent/types";

interface PatchBody {
  sessionId?: string;
  thesis?: string | null;
  notes?: string | null;
  stopLoss?: number | null;
  targetPrice?: number | null;
  emotionTag?: JournalEmotionTag | null;
  followedPlan?: boolean | null;
  mistakeTags?: string[];
  status?: JournalStatus;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const { id } = await context.params;
  try {
    const { sessionId, ...fields } = (await request.json()) as PatchBody;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing required 'sessionId'." }, { status: 400 });
    }
    const position = await updateJournalPosition(id, sessionId, fields);
    return NextResponse.json({ position });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const { id } = await context.params;
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing required 'sessionId' query param." }, { status: 400 });
  }
  try {
    await deleteJournalPosition(id, sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
