import { NextResponse } from "next/server";
import { getAdvisorClientBySlug, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { valuatePortfolio } from "@/lib/agents/trading-agent/skills/portfolio-valuation";

/** Temporary — replays exactly what /api/my-portfolio returns for Christopher's account, with today's live market prices, since I can't literally click through his session. Remove once done. */
export async function GET() {
  const client = await getAdvisorClientBySlug("mXvZ8uqqJK4");
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const holdings = await listClientHoldings(client.id);
  if (holdings.length === 0) {
    return NextResponse.json({ linked: true, clientName: client.name, summary: null, holdingsCount: 0, cashBalance: client.cashBalance });
  }
  const summary = await valuatePortfolio(holdings);
  return NextResponse.json({ linked: true, clientName: client.name, cashBalance: client.cashBalance, summary });
}
