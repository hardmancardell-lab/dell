import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sets a real Supabase Auth user's password directly, bypassing the mailer
 * entirely (no reset email). For syncing a client's real login password to
 * match an admin-managed passcode they were already given out-of-band.
 */
export async function POST(request: Request) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email) return NextResponse.json({ error: "'email' is required." }, { status: 400 });
  if (!password) return NextResponse.json({ error: "'password' is required." }, { status: 400 });

  const admin = createAdminClient();

  try {
    const { data: listData, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (listError) throw listError;
    const existing = listData.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing) {
      return NextResponse.json({ error: "No account exists yet for that email — confirm/create it first." }, { status: 404 });
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, message: "Password set. They can log in at /login with the new password now." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
