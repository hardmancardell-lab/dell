import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { getAdvisorClientBySlug, listRealizedPnl } from "@/lib/data/advisor-clients-db";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { slug } = await params;
  try {
    const client = await getAdvisorClientBySlug(slug);
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const sales = await listRealizedPnl(client.id);
    const totalRealizedPnl = sales.reduce((sum, s) => sum + s.realizedPnl, 0);
    return NextResponse.json({ sales, totalRealizedPnl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
