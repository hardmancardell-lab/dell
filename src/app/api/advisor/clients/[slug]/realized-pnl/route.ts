import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { getAdvisorClientBySlug, listRealizedPnl, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { checkWashSaleRisk } from "@/lib/agents/trading-agent/skills/wash-sale-check";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { slug } = await params;
  try {
    const client = await getAdvisorClientBySlug(slug);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const [sales, holdings] = await Promise.all([listRealizedPnl(client.id), listClientHoldings(client.id)]);
    const totalRealizedPnl = sales.reduce((sum, s) => sum + s.realizedPnl, 0);
    const washSaleFlags = checkWashSaleRisk(sales, holdings);
    return NextResponse.json({ sales, totalRealizedPnl, washSaleFlags });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
