import { NextResponse } from "next/server";
import { isHypothesisLedgerConfigured } from "@/lib/data/hypothesis-ledger-db";
import { getGuidedTradeSignals } from "@/lib/agents/trading-agent/skills/guided-trade-signals";
import { createClient } from "@/lib/supabase/server";
import { getAdvisorClientByUser, listClientHoldings } from "@/lib/data/advisor-clients-db";

export const maxDuration = 30;

/**
 * Scoped for an authenticated user with a linked advisor_clients portfolio,
 * unscoped (exact prior behavior) for everyone else — a logged-out visitor
 * sees the same general list as always, just never personalized. Failure to
 * resolve the user's holdings degrades to the unscoped list rather than
 * failing the request.
 */
async function getServerOwnedSymbols(): Promise<string[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !user.email) return [];
    const client = await getAdvisorClientByUser(user.id, user.email);
    if (!client) return [];
    const holdings = await listClientHoldings(client.id);
    return holdings.map((h) => h.symbol);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  if (!isHypothesisLedgerConfigured()) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }
  try {
    const { searchParams } = new URL(request.url);
    // A self-directed user with no advisor_clients row keeps their holdings in
    // browser localStorage only (see portfolio-storage.ts) — there's no server
    // row to resolve for them, so the client sends those symbols directly.
    // Purely additive to the server-resolved list; never a substitute for it.
    const localSymbols = (searchParams.get("localSymbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const serverSymbols = await getServerOwnedSymbols();
    const ownedSymbols = [...new Set([...serverSymbols, ...localSymbols])];
    const signals = await getGuidedTradeSignals(ownedSymbols);
    return NextResponse.json({ signals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
