import { NextResponse } from "next/server";
import { createJournalEntry, getJournalEntries, isJournalDbConfigured } from "@/lib/data/journal-db";
import type { JournalEntryInput } from "@/lib/agents/trading-agent/types";

export async function GET() {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const entries = await getJournalEntries();
    return NextResponse.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isJournalDbConfigured()) {
    return NextResponse.json({ error: "Trade Journal is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as JournalEntryInput;
    if (!body.ticker || !body.instrumentType || !body.quantity || !body.entryPrice) {
      return NextResponse.json(
        { error: "Request body must include 'ticker', 'instrumentType', 'quantity', and 'entryPrice'." },
        { status: 400 }
      );
    }
    if (body.instrumentType !== "shares" && (body.strikePrice == null || !body.expirationDate)) {
      return NextResponse.json(
        { error: "Options entries require 'strikePrice' and 'expirationDate'." },
        { status: 400 }
      );
    }
    const entry = await createJournalEntry({
      ticker: body.ticker.trim().toUpperCase(),
      instrumentType: body.instrumentType,
      strikePrice: body.strikePrice ?? null,
      expirationDate: body.expirationDate ?? null,
      quantity: body.quantity,
      entryPrice: body.entryPrice,
      entryDate: body.entryDate ?? new Date().toISOString(),
      thesis: body.thesis ?? null,
    });
    return NextResponse.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
