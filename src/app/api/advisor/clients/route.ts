import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { createAdvisorClient, isAdvisorClientsDbConfigured, listAdvisorClients } from "@/lib/data/advisor-clients-db";

export async function GET() {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  if (!isAdvisorClientsDbConfigured()) {
    return NextResponse.json({ error: "Not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  try {
    const clients = await listAdvisorClients();
    return NextResponse.json({ clients });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  if (!isAdvisorClientsDbConfigured()) {
    return NextResponse.json({ error: "Not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unset)." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  if (!body?.name?.trim() || !body?.passcode?.trim()) {
    return NextResponse.json({ error: "Both 'name' and 'passcode' are required." }, { status: 400 });
  }
  const cashBalance = Number.isFinite(body?.cashBalance) ? Number(body.cashBalance) : 0;
  if (cashBalance < 0) {
    return NextResponse.json({ error: "Cash balance can't be negative." }, { status: 400 });
  }
  const linkedEmail = typeof body?.linkedEmail === "string" && body.linkedEmail.trim() ? body.linkedEmail.trim() : null;
  try {
    const client = await createAdvisorClient(body.name.trim(), body.passcode.trim(), cashBalance, linkedEmail);
    return NextResponse.json({ client });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
