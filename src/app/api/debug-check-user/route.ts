import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";

/** Temporary — checks whether a real Supabase Auth user exists for a given email and its confirmation status. Remove once done. */
export async function GET(request: Request) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const res = await fetch(`${url}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const json = await res.json();
  const users = (json.users ?? []) as Array<Record<string, unknown>>;
  const match = users.find((u) => (u.email as string)?.toLowerCase() === email?.toLowerCase());
  return NextResponse.json({
    totalUsers: users.length,
    found: !!match,
    user: match
      ? {
          id: match.id,
          email: match.email,
          email_confirmed_at: match.email_confirmed_at,
          created_at: match.created_at,
          last_sign_in_at: match.last_sign_in_at,
          confirmed_at: match.confirmed_at,
        }
      : null,
    allEmails: users.map((u) => u.email),
  });
}
