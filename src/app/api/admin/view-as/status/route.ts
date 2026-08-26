import { NextResponse } from "next/server";
import { getAdminViewAsSlug } from "@/lib/admin-view-as";
import { getAdvisorClientBySlug } from "@/lib/data/advisor-clients-db";

export async function GET() {
  const slug = await getAdminViewAsSlug();
  if (!slug) return NextResponse.json({ viewingAs: null });

  const client = await getAdvisorClientBySlug(slug);
  if (!client) return NextResponse.json({ viewingAs: null });

  return NextResponse.json({ viewingAs: { slug, clientName: client.name } });
}
