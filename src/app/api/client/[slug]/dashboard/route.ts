import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdvisorClientBySlug, listClientHoldings, listRealizedPnl } from "@/lib/data/advisor-clients-db";
import { valuatePortfolio } from "@/lib/agents/trading-agent/skills/portfolio-valuation";
import { checkWashSaleRisk } from "@/lib/agents/trading-agent/skills/wash-sale-check";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getAdvisorClientBySlug(slug);
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const cookieStore = await cookies();
  const session = cookieStore.get(`client_session_${slug}`)?.value;
  if (!session || session !== client.passcodeHash) {
    return NextResponse.json({ error: "Passcode required.", requiresPasscode: true }, { status: 401 });
  }

  try {
    const [holdings, sales] = await Promise.all([listClientHoldings(client.id), listRealizedPnl(client.id)]);
    const totalRealizedPnl = sales.reduce((sum, s) => sum + s.realizedPnl, 0);
    const washSaleFlags = checkWashSaleRisk(sales, holdings);
    if (holdings.length === 0) {
      return NextResponse.json({ clientName: client.name, summary: null, holdingsCount: 0, cashBalance: client.cashBalance, sales, totalRealizedPnl, washSaleFlags });
    }
    const summary = await valuatePortfolio(holdings);
    return NextResponse.json({ clientName: client.name, summary, holdingsCount: holdings.length, cashBalance: client.cashBalance, sales, totalRealizedPnl, washSaleFlags });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
