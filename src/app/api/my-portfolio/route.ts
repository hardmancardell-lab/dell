import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminViewAsSlug } from "@/lib/admin-view-as";
import { getAdvisorClientByUser, getAdvisorClientBySlug, listClientHoldings } from "@/lib/data/advisor-clients-db";
import { valuatePortfolio } from "@/lib/agents/trading-agent/skills/portfolio-valuation";
import type { AdvisorClient } from "@/lib/agents/trading-agent/types";

/**
 * Self-service equivalent of /api/client/[slug]/dashboard, but for a real
 * logged-in user instead of a passcode session — looks up (and lazily
 * links, on first hit) the advisor_clients row tied to this account. A
 * plain self-directed user with no advisor relationship gets
 * {linked: false}, which the Portfolio Tracker UI treats as "use the normal
 * local tracker" rather than an error.
 *
 * Also honors an active admin "view as" session (see admin-view-as.ts) —
 * support can browse the real app scoped to a specific client's data
 * without their password. Mutation routes (holdings POST/DELETE) are
 * deliberately NOT given this same treatment: they still require a real
 * Supabase user, so an admin in view-as mode can look but not touch.
 */
export async function GET() {
  const viewAsSlug = await getAdminViewAsSlug();
  if (viewAsSlug) {
    const client = await getAdvisorClientBySlug(viewAsSlug);
    if (!client) return NextResponse.json({ error: "View-as client not found." }, { status: 404 });
    return buildPortfolioResponse(client, true);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  try {
    const client = await getAdvisorClientByUser(user.id, user.email);
    if (!client) return NextResponse.json({ linked: false });
    return await buildPortfolioResponse(client, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function buildPortfolioResponse(client: AdvisorClient, viewingAs: boolean) {
  try {
    const holdings = await listClientHoldings(client.id);
    if (holdings.length === 0) {
      return NextResponse.json({ linked: true, viewingAs, clientName: client.name, summary: null, holdingsCount: 0, cashBalance: client.cashBalance });
    }
    const summary = await valuatePortfolio(holdings);
    return NextResponse.json({ linked: true, viewingAs, clientName: client.name, summary, holdingsCount: holdings.length, cashBalance: client.cashBalance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
