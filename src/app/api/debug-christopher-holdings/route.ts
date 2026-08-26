import { NextResponse } from "next/server";
import { getAdvisorClientBySlug, listClientHoldings, createClientHolding, deleteClientHolding } from "@/lib/data/advisor-clients-db";

/** Temporary — lists/mutates Christopher's holdings for a real portfolio update. Remove once done. */
export async function GET() {
  const client = await getAdvisorClientBySlug("mXvZ8uqqJK4");
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const holdings = await listClientHoldings(client.id);
  return NextResponse.json({ clientId: client.id, cashBalance: client.cashBalance, holdings });
}

export async function POST() {
  const client = await getAdvisorClientBySlug("mXvZ8uqqJK4");
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  // QTUM: reduce 5 -> 3 shares (sold 2 @ $148.82, $2 fee — not stored, no realized-P&L field on this table).
  await deleteClientHolding("2c84b1c2-ea14-4f8d-a81b-4e449604aff3");
  await createClientHolding(client.id, {
    symbol: "QTUM",
    assetClass: "equity",
    shares: 3,
    costBasisPerShare: 154.65,
    acquiredDate: "2026-08-17",
    optionRight: null,
    strikePrice: null,
    expirationDate: null,
    underlyingSymbol: null,
    contractMultiplier: null,
  });

  // New position: IBLC, 3 shares @ 46.35
  await createClientHolding(client.id, {
    symbol: "IBLC",
    assetClass: "equity",
    shares: 3,
    costBasisPerShare: 46.35,
    acquiredDate: "2026-08-26",
    optionRight: null,
    strikePrice: null,
    expirationDate: null,
    underlyingSymbol: null,
    contractMultiplier: null,
  });

  // New position: OKLO, 7 shares @ 44.02
  await createClientHolding(client.id, {
    symbol: "OKLO",
    assetClass: "equity",
    shares: 7,
    costBasisPerShare: 44.02,
    acquiredDate: "2026-08-26",
    optionRight: null,
    strikePrice: null,
    expirationDate: null,
    underlyingSymbol: null,
    contractMultiplier: null,
  });

  const holdings = await listClientHoldings(client.id);
  return NextResponse.json({ done: true, holdings });
}
