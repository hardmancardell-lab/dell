import { NextResponse } from "next/server";
import { getJournalPositionById, insertJournalFill, isJournalDbConfigured, updateJournalPosition } from "@/lib/data/journal-db";
import { computeJournalPositionMetrics } from "@/lib/agents/trading-agent/skills/journal-log";
import type { JournalFillInput } from "@/lib/agents/trading-agent/types";

// Adding a fill covers averaging in (another buy), a partial exit (a sell
// smaller than open quantity), or a full close (a sell that brings open
// quantity to zero — auto-flips the position to "closed").
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const { id } = await context.params;
  try {
    const body = (await request.json()) as JournalFillInput;
    if (!body.side || !body.quantity || body.price == null) {
      return NextResponse.json({ error: "Request body must include 'side', 'quantity', and 'price'." }, { status: 400 });
    }
    const existing = await getJournalPositionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Journal position not found." }, { status: 404 });
    }
    const filledAt = body.filledAt ?? new Date().toISOString();
    const fill = await insertJournalFill(id, { side: body.side, quantity: body.quantity, price: body.price, filledAt, note: body.note ?? null });

    const allFills = [...existing.fills, fill];
    const metrics = computeJournalPositionMetrics(allFills, existing.instrumentType, existing.stopLoss);
    let position = { ...existing, fills: allFills };
    if (metrics.openQuantity <= 0 && existing.status === "open") {
      position = await updateJournalPosition(id, { status: "closed", closedAt: filledAt });
      position = { ...position, fills: allFills };
    }
    return NextResponse.json({ position, metrics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
