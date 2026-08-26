import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";

/** Temporary — checks the raw advisor_clients row's user_id link status. Remove once done. */
export async function GET() {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const res = await fetch(`${url}/rest/v1/advisor_clients?select=id,slug,name,linked_email,user_id,cash_balance`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await res.json();
  return NextResponse.json({ rows });
}

/** Temporary — manually completes the link for a client whose lazy-link never fired. Remove once done. */
export async function POST(request: Request) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body?.slug || !body?.userId) return NextResponse.json({ error: "slug and userId required." }, { status: 400 });

  const res = await fetch(`${url}/rest/v1/advisor_clients?slug=eq.${encodeURIComponent(body.slug)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=representation" },
    body: JSON.stringify({ user_id: body.userId }),
  });
  const rows = await res.json();
  return NextResponse.json({ status: res.status, rows });
}
