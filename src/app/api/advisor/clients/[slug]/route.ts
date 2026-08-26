import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { deleteAdvisorClient, getAdvisorClientBySlug, updateAdvisorClient } from "@/lib/data/advisor-clients-db";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { slug } = await params;
  const body = await request.json().catch(() => null);

  const updates: { cashBalance?: number; linkedEmail?: string | null } = {};
  if (body?.cashBalance !== undefined) {
    const cashBalance = Number(body.cashBalance);
    if (!Number.isFinite(cashBalance) || cashBalance < 0) {
      return NextResponse.json({ error: "'cashBalance' must be a non-negative number." }, { status: 400 });
    }
    updates.cashBalance = cashBalance;
  }
  if (body?.linkedEmail !== undefined) {
    updates.linkedEmail = typeof body.linkedEmail === "string" && body.linkedEmail.trim() ? body.linkedEmail : null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Provide 'cashBalance' and/or 'linkedEmail' to update." }, { status: 400 });
  }

  try {
    const existing = await getAdvisorClientBySlug(slug);
    if (!existing) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const client = await updateAdvisorClient(slug, updates);
    return NextResponse.json({ client });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { slug } = await params;
  try {
    const existing = await getAdvisorClientBySlug(slug);
    if (!existing) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    await deleteAdvisorClient(slug);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
