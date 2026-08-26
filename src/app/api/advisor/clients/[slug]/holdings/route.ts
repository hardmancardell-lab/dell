import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { createClientHolding, getAdvisorClientBySlug, listClientHoldings } from "@/lib/data/advisor-clients-db";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { slug } = await params;
  try {
    const client = await getAdvisorClientBySlug(slug);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const holdings = await listClientHoldings(client.id);
    return NextResponse.json({ holdings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (!body?.symbol?.trim() || !body?.assetClass || !body?.shares || !body?.costBasisPerShare || !body?.acquiredDate) {
    return NextResponse.json({ error: "symbol, assetClass, shares, costBasisPerShare, and acquiredDate are required." }, { status: 400 });
  }
  try {
    const client = await getAdvisorClientBySlug(slug);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
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
