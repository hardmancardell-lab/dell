import { NextResponse } from "next/server";
import { createJournalPosition, getJournalPositions, insertJournalFill, isJournalDbConfigured } from "@/lib/data/journal-db";
import type { JournalPositionInput } from "@/lib/agents/trading-agent/types";

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
    return NextResponse.json({ positions });
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
    const body = (await request.json()) as JournalPositionInput;
    if (!body.sessionId || !body.ticker || !body.instrumentType || !body.strategy || !body.source || !body.quantity || !body.entryPrice) {
      return NextResponse.json(
        { error: "Request body must include 'sessionId', 'ticker', 'instrumentType', 'source', 'strategy', 'quantity', and 'entryPrice'." },
        { status: 400 }
      );
    }
    if (body.instrumentType !== "shares" && (body.strikePrice == null || !body.expirationDate)) {
      return NextResponse.json({ error: "Options positions require 'strikePrice' and 'expirationDate'." }, { status: 400 });
    }
    const openedAt = body.entryDate ?? new Date().toISOString();
    const position = await createJournalPosition({
      sessionId: body.sessionId,
      ticker: body.ticker.trim().toUpperCase(),
      instrumentType: body.instrumentType,
      strikePrice: body.strikePrice ?? null,
      expirationDate: body.expirationDate ?? null,
      source: body.source,
      strategy: body.strategy,
      strategyOther: body.strategy === "other" ? body.strategyOther ?? null : null,
      thesis: body.thesis ?? null,
      stopLoss: body.stopLoss ?? null,
      targetPrice: body.targetPrice ?? null,
      emotionTag: body.emotionTag ?? null,
      openedAt,
    });
    const fill = await insertJournalFill(position.id, {
      side: "buy",
      quantity: body.quantity,
      price: body.entryPrice,
      filledAt: openedAt,
      note: null,
    });
    return NextResponse.json({ position: { ...position, fills: [fill] } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
