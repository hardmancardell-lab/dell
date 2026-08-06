import { NextResponse } from "next/server";
import {
  closeJournalEntry,
  deleteJournalEntry,
  getJournalEntryById,
  isJournalDbConfigured,
  updateJournalEntry,
} from "@/lib/data/journal-db";
import { computeJournalRealizedPnl } from "@/lib/agents/trading-agent/skills/journal-log";
import type { JournalCloseInput } from "@/lib/agents/trading-agent/types";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const { id } = await context.params;
  try {
    const body = (await request.json()) as (JournalCloseInput & { close?: boolean }) | { thesis?: string | null; notes?: string | null };

    if ("exitPrice" in body && body.exitPrice != null) {
      const existing = await getJournalEntryById(id);
      if (!existing) {
        return NextResponse.json({ error: "Journal entry not found." }, { status: 404 });
      }
      const realizedPnl = computeJournalRealizedPnl(
        existing.instrumentType,
        existing.quantity,
        existing.entryPrice,
        body.exitPrice
      );
      const entry = await closeJournalEntry(id, {
        exitPrice: body.exitPrice,
        exitDate: body.exitDate ?? new Date().toISOString(),
        realizedPnl,
        notes: body.notes ?? existing.notes,
      });
      return NextResponse.json({ entry });
    }

    const entry = await updateJournalEntry(id, body);
    return NextResponse.json({ entry });
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
    await deleteJournalEntry(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
