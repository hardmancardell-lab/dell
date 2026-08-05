import { NextResponse } from "next/server";
import { getRecentHypotheses, isHypothesisLedgerConfigured } from "@/lib/data/hypothesis-ledger-db";

export async function GET(request: Request) {
  if (!isHypothesisLedgerConfigured()) {
    return NextResponse.json({ error: "Hypothesis ledger is not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "100");
  try {
    const hypotheses = await getRecentHypotheses(Number.isFinite(limit) && limit > 0 ? limit : 100);
    return NextResponse.json({ hypotheses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
