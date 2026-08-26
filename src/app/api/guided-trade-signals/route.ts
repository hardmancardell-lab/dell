import { NextResponse } from "next/server";
import { isHypothesisLedgerConfigured } from "@/lib/data/hypothesis-ledger-db";
import { getGuidedTradeSignals } from "@/lib/agents/trading-agent/skills/guided-trade-signals";

export const maxDuration = 30;

export async function GET() {
  if (!isHypothesisLedgerConfigured()) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }
  try {
    const signals = await getGuidedTradeSignals();
    return NextResponse.json({ signals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
