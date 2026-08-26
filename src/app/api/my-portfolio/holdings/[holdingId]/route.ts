import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteClientHolding, getAdvisorClientByUser, listClientHoldings } from "@/lib/data/advisor-clients-db";

export async function DELETE(request: Request, { params }: { params: Promise<{ holdingId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { holdingId } = await params;

  try {
    const client = await getAdvisorClientByUser(user.id, user.email);
    if (!client) return NextResponse.json({ error: "No linked portfolio for this account." }, { status: 404 });
    // Ownership check — this route has no admin-secret gate, only a real
    // user's own session, so it must confirm the holding is actually theirs
    // before deleting (unlike the admin route, which trusts the operator).
    const holdings = await listClientHoldings(client.id);
    if (!holdings.some((h) => h.id === holdingId)) {
      return NextResponse.json({ error: "Holding not found." }, { status: 404 });
    }
    await deleteClientHolding(holdingId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
