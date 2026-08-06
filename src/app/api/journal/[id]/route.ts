import { NextResponse } from "next/server";
import { deleteJournalPosition, isJournalDbConfigured, updateJournalPosition } from "@/lib/data/journal-db";
import type { JournalEmotionTag, JournalStatus } from "@/lib/agents/trading-agent/types";

interface PatchBody {
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
    const body = (await request.json()) as PatchBody;
    const position = await updateJournalPosition(id, body);
    return NextResponse.json({ position });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const { id } = await context.params;
  try {
    await deleteJournalPosition(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
