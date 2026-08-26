import { NextResponse } from "next/server";
import {
  createAdvisorClient,
  createClientHolding,
  sellClientHolding,
  listClientHoldings,
  listRealizedPnl,
  deleteAdvisorClient,
} from "@/lib/data/advisor-clients-db";

/** Temporary — end-to-end smoke test of the new sellClientHolding/realized-P&L path against a throwaway test client. Remove once done. */
export async function GET() {
  const client = await createAdvisorClient("__SMOKE_TEST__", "smoketest123", 0, null);
  try {
    const holding = await createClientHolding(client.id, {
      symbol: "TEST",
      assetClass: "equity",
      shares: 10,
      costBasisPerShare: 100,
      acquiredDate: "2026-01-01",
      optionRight: null,
      strikePrice: null,
      expirationDate: null,
      underlyingSymbol: null,
      contractMultiplier: null,
    });

    // Sell 4 of 10 @ 120, fee 3 -> expected realized = (120-100)*4 - 3 = 77
    const sale = await sellClientHolding(holding.id, 4, 120, 3, "2026-08-26");
    const holdingsAfterPartial = await listClientHoldings(client.id);

    // Sell the rest (6) @ 90, fee 1 -> expected realized = (90-100)*6 - 1 = -61, holding should be deleted
    const sale2 = await sellClientHolding(holding.id, 6, 90, 1, "2026-08-26");
    const holdingsAfterFull = await listClientHoldings(client.id);

    const sales = await listRealizedPnl(client.id);

    return NextResponse.json({
      sale,
      holdingsAfterPartial,
      sale2,
      holdingsAfterFull,
      allRealizedSales: sales,
      checks: {
        firstSaleCorrect: sale.realizedPnl === 77,
        remainingSharesAfterPartial: holdingsAfterPartial[0]?.shares === 6,
        secondSaleCorrect: sale2.realizedPnl === -61,
        holdingGoneAfterFullSale: holdingsAfterFull.length === 0,
      },
    });
  } finally {
    await deleteAdvisorClient(client.slug);
  }
}
