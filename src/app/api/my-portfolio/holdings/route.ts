import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClientHolding, getAdvisorClientByUser } from "@/lib/data/advisor-clients-db";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.symbol?.trim() || !body?.assetClass || !body?.shares || !body?.costBasisPerShare || !body?.acquiredDate) {
    return NextResponse.json({ error: "symbol, assetClass, shares, costBasisPerShare, and acquiredDate are required." }, { status: 400 });
  }

  try {
    const client = await getAdvisorClientByUser(user.id, user.email);
    if (!client) return NextResponse.json({ error: "No linked portfolio for this account." }, { status: 404 });
    const holding = await createClientHolding(client.id, {
      symbol: body.symbol.trim().toUpperCase(),
      assetClass: body.assetClass,
      shares: Number(body.shares),
      costBasisPerShare: Number(body.costBasisPerShare),
      acquiredDate: body.acquiredDate,
      optionRight: body.optionRight ?? null,
      strikePrice: body.strikePrice ?? null,
      expirationDate: body.expirationDate ?? null,
      underlyingSymbol: body.underlyingSymbol ?? null,
      contractMultiplier: body.contractMultiplier ?? null,
    });
    return NextResponse.json({ holding });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
