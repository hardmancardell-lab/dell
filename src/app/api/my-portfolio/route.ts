import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdvisorClientByUser, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { valuatePortfolio } from "@/lib/agents/trading-agent/skills/portfolio-valuation";

/**
 * Self-service equivalent of /api/client/[slug]/dashboard, but for a real
 * logged-in user instead of a passcode session — looks up (and lazily
 * links, on first hit) the advisor_clients row tied to this account. A
 * plain self-directed user with no advisor relationship gets
 * {linked: false}, which the Portfolio Tracker UI treats as "use the normal
 * local tracker" rather than an error.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  try {
    const client = await getAdvisorClientByUser(user.id, user.email);
    if (!client) return NextResponse.json({ linked: false });

    const holdings = await listClientHoldings(client.id);
    if (holdings.length === 0) {
      return NextResponse.json({ linked: true, clientName: client.name, summary: null, holdingsCount: 0, cashBalance: client.cashBalance });
    }
    const summary = await valuatePortfolio(holdings);
    return NextResponse.json({ linked: true, clientName: client.name, summary, holdingsCount: holdings.length, cashBalance: client.cashBalance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
