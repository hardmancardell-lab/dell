import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { ADMIN_VIEW_AS_COOKIE } from "@/lib/admin-view-as";
import { getAdvisorClientBySlug } from "@/lib/data/advisor-clients-db";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { slug } = await params;

  const client = await getAdvisorClientBySlug(slug);
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  // Lightweight audit trail — this app has one shared admin secret, not
  // per-admin accounts, so "who" isn't distinguishable beyond "the admin";
  // what/when/target is still worth having in the function logs.
  console.log(`[admin-view-as] started viewing as ${client.name} (${slug}) at ${new Date().toISOString()}`);

  const res = NextResponse.json({ ok: true, clientName: client.name });
  res.cookies.set(ADMIN_VIEW_AS_COOKIE, slug, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // 4 hours — a support session shouldn't need longer; re-start if it does
  });
  return res;
}
