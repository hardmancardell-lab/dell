import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";

/** Temporary — generates a real recovery link via Supabase's admin API without sending an email, so the admin can send it themselves. Remove once done. */
export async function GET(request: Request) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ type: "recovery", email }),
  });
  const json = await res.json();
  return NextResponse.json({ status: res.status, action_link: json.action_link ?? null, raw: json });
}
