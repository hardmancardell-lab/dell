import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { deleteClientHolding } from "@/lib/data/advisor-clients-db";

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; holdingId: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { holdingId } = await params;
  try {
    await deleteClientHolding(holdingId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
