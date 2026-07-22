import { NextResponse } from "next/server";
import { CURRENCY_PEGS } from "@/lib/agents/trading-agent/skills/currency-pegs";
import { getPegDeviationSnapshot } from "@/lib/agents/trading-agent/skills/peg-reversion";
import type { PegDeviationSnapshot } from "@/lib/agents/trading-agent/types";

export async function GET() {
  try {
    const livePegs = CURRENCY_PEGS.filter((p) => p.liveDataAvailable);
    const settled = await Promise.allSettled(livePegs.map((p) => getPegDeviationSnapshot(p.pair)));
    const snapshots: PegDeviationSnapshot[] = settled
      .filter((r): r is PromiseFulfilledResult<PegDeviationSnapshot> => r.status === "fulfilled")
      .map((r) => r.value);

    return NextResponse.json({ pegs: CURRENCY_PEGS, snapshots });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
