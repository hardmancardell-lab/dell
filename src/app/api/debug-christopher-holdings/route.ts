import { NextResponse } from "next/server";
import { getAdvisorClientBySlug, listClientHoldings } from "@/lib/data/advisor-clients-db";

/** Temporary — lists Christopher's current holdings so deltas can be computed precisely. Remove once done. */
export async function GET() {
  const client = await getAdvisorClientBySlug("mXvZ8uqqJK4");
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const holdings = await listClientHoldings(client.id);
  return NextResponse.json({ clientId: client.id, cashBalance: client.cashBalance, holdings });
}
