import { NextResponse } from "next/server";

/** Temporary — checks whether a specific user has actually signed in since a fix landed. Remove once done. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const res = await fetch(`${url}/auth/v1/admin/users?filter=email.ilike.*${encodeURIComponent(email)}*&per_page=5`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const json = await res.json();
  const users = (json.users ?? []).map((u: Record<string, unknown>) => ({
    id: u.id,
    email: u.email,
    last_sign_in_at: u.last_sign_in_at,
    email_confirmed_at: u.email_confirmed_at,
    created_at: u.created_at,
  }));
  return NextResponse.json({ status: res.status, users });
}
