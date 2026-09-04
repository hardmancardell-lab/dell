import { NextResponse } from "next/server";
import { getGuidedTradeSignals } from "@/lib/agents/trading-agent/skills/guided-trade-signals";

/** Temporary — verifies the new portfolio-scoping logic directly (route auth can't be curled). Remove once done. */
export async function GET() {
  const unscoped = await getGuidedTradeSignals();
  const christopherSymbols = ["CIBR", "DTCR", "NLR", "QTUM", "IBLC", "OKLO"];
  const scoped = await getGuidedTradeSignals(christopherSymbols);

  return NextResponse.json({
    unscopedCount: unscoped.length,
    unscopedAllUnflagged: unscoped.every((s) => s.ownedByUser === false && s.relatedHoldingSymbol === null),
    scopedCount: scoped.length,
    scoped: scoped.map((s) => ({ ticker: s.ticker, strategyType: s.strategyType, ownedByUser: s.ownedByUser, relatedHoldingSymbol: s.relatedHoldingSymbol })),
    sortedCorrectly: scoped.every((s, i) => {
      const rank = (x: typeof s) => (x.ownedByUser ? 0 : x.relatedHoldingSymbol ? 1 : 2);
      return i === 0 || rank(scoped[i - 1]) <= rank(s);
    }),
  });
}
