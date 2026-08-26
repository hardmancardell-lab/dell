import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { sellClientHolding } from "@/lib/data/advisor-clients-db";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; holdingId: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { holdingId } = await params;
  const body = await request.json().catch(() => null);
  const sharesSold = Number(body?.sharesSold);
  const salePricePerShare = Number(body?.salePricePerShare);
  const fee = Number(body?.fee ?? 0);
  const saleDate = body?.saleDate;
  if (!Number.isFinite(sharesSold) || sharesSold <= 0 || !Number.isFinite(salePricePerShare) || !saleDate) {
    return NextResponse.json({ error: "sharesSold (>0), salePricePerShare, and saleDate are required." }, { status: 400 });
  }
  try {
    const sale = await sellClientHolding(holdingId, sharesSold, salePricePerShare, fee, saleDate);
    return NextResponse.json({ sale });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
