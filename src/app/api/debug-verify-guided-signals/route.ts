import { NextResponse } from "next/server";
import { getGuidedTradeSignals } from "@/lib/agents/trading-agent/skills/guided-trade-signals";
import { getRecentHypotheses } from "@/lib/data/hypothesis-ledger-db";
import { getSectorForSymbol } from "@/lib/agents/trading-agent/skills/sector-lookup";
import { fetchQuote } from "@/lib/data/market-data";

/** Temporary — verifies the new portfolio-scoping logic directly (route auth can't be curled). Remove once done. */
export async function GET() {
  const diagnostics: Record<string, string> = {};
  try {
    diagnostics.step = "getRecentHypotheses(1)";
    const hyp1 = await getRecentHypotheses(1);
    diagnostics.hyp1Count = String(hyp1.length);

    diagnostics.step = "getRecentHypotheses(10)";
    const hyp10 = await getRecentHypotheses(10);
    diagnostics.hyp10Count = String(hyp10.length);

    diagnostics.step = "getRecentHypotheses(200)";
    const hyp = await getRecentHypotheses(200);
    diagnostics.hypothesesCount = String(hyp.length);

    diagnostics.step = "getSectorForSymbol";
    const sector = await getSectorForSymbol("CIBR");
    diagnostics.cibrSector = String(sector);

    diagnostics.step = "fetchQuote";
    const quote = await fetchQuote("CIBR");
    diagnostics.cibrPrice = String(quote.lastPrice);

    diagnostics.step = "done-diagnostics";
  } catch (error) {
    return NextResponse.json({ failedAt: diagnostics.step, diagnostics, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }

  try {
    const unscoped = await getGuidedTradeSignals();
    const christopherSymbols = ["CIBR", "DTCR", "NLR", "QTUM", "IBLC", "OKLO"];
    const scoped = await getGuidedTradeSignals(christopherSymbols);

    return NextResponse.json({
      diagnostics,
      unscopedCount: unscoped.length,
      unscopedAllUnflagged: unscoped.every((s) => s.ownedByUser === false && s.relatedHoldingSymbol === null),
      scopedCount: scoped.length,
      scoped: scoped.map((s) => ({ ticker: s.ticker, strategyType: s.strategyType, ownedByUser: s.ownedByUser, relatedHoldingSymbol: s.relatedHoldingSymbol })),
      sortedCorrectly: scoped.every((s, i) => {
        const rank = (x: typeof s) => (x.ownedByUser ? 0 : x.relatedHoldingSymbol ? 1 : 2);
        return i === 0 || rank(scoped[i - 1]) <= rank(s);
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", stack: error instanceof Error ? error.stack : null },
      { status: 500 }
    );
  }
}
