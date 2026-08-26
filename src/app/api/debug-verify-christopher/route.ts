import { NextResponse } from "next/server";
import { getAdvisorClientByUser, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { valuatePortfolio } from "@/lib/agents/trading-agent/skills/portfolio-valuation";

/** Temporary — replicates exactly what /api/my-portfolio would return for Christopher's real user id, bypassing the need for his session cookie. Remove once done. */
export async function GET() {
  const userId = "9b09deca-717a-4578-b1ea-6c2c45e927d1";
  const email = "ezernackchristopher97@gmail.com";
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const signinRes = await fetch(`${url}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const signinJson = await signinRes.json();
  const allUsers = (signinJson.users ?? []) as Record<string, unknown>[];
  const me = allUsers.find((u) => u.id === userId);

  try {
    const client = await getAdvisorClientByUser(userId, email);
    if (!client) {
      return NextResponse.json({ lastSignInAt: me?.last_sign_in_at ?? null, myPortfolioResult: { linked: false }, note: "No advisor_clients row linked to this user — he'd see 'no linked portfolio', not a broken screen, but this means the link is NOT intact." });
    }
    const holdings = await listClientHoldings(client.id);
    if (holdings.length === 0) {
      return NextResponse.json({ lastSignInAt: me?.last_sign_in_at ?? null, myPortfolioResult: { linked: true, clientName: client.name, summary: null, holdingsCount: 0, cashBalance: client.cashBalance } });
    }
    const summary = await valuatePortfolio(holdings);
    return NextResponse.json({ lastSignInAt: me?.last_sign_in_at ?? null, myPortfolioResult: { linked: true, clientName: client.name, holdingsCount: holdings.length, cashBalance: client.cashBalance, summaryOk: Boolean(summary), totalValue: summary?.totalValue ?? null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ lastSignInAt: me?.last_sign_in_at ?? null, myPortfolioResult: { error: message }, note: "This is exactly the error his real browser would have hit." });
  }
}
