import { NextResponse } from "next/server";
import { getAdvisorClientBySlug } from "@/lib/data/advisor-clients-db";

// TEMP debug route — read-only lookup to confirm Christopher's current
// linked_email before resending his dashboard link. Delete after.
export async function GET() {
  try {
    const client = await getAdvisorClientBySlug("mXvZ8uqqJK4");
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    return NextResponse.json({ name: client.name, slug: client.slug, linkedEmail: client.linkedEmail, cashBalance: client.cashBalance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
