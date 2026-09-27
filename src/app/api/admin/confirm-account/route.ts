import { NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Bypasses Supabase's default mailer entirely for a real, live-blocking
 * problem: its default shared mailer caps at ~2-3 sends/hour and
 * auth.signUp() reports success even when the confirmation email is
 * silently dropped, so a real signed-up user can be permanently stuck
 * "unconfirmed" with zero visibility into why. This uses the service-role
 * admin API (never exposed to the browser) to force-confirm an existing
 * account directly, or create+confirm one if it doesn't exist yet — no
 * email involved either way.
 */
export async function POST(request: Request) {
  if (!(await isAdminSessionValid())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "'email' is required." }, { status: 400 });

  const admin = createAdminClient();

  try {
    // listUsers is paginated; this app's real user count is small enough
    // that one page (default 50) covers it — revisit with a proper email
    // filter if that ever stops being true.
    const { data: listData, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (listError) throw listError;
    const existing = listData.users.find((u) => u.email?.toLowerCase() === email);

    if (existing) {
      if (!existing.email_confirmed_at) {
        const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { email_confirm: true });
        if (updateError) throw updateError;
      }
      return NextResponse.json({
        ok: true,
        outcome: existing.email_confirmed_at ? "already-confirmed" : "confirmed-existing",
        message: existing.email_confirmed_at
          ? "This account was already confirmed — they can log in at /login with the password they set at signup."
          : "Account force-confirmed. They can now log in at /login with the password they set at signup — no email needed.",
      });
    }

    // No account exists yet — create one, pre-confirmed, with a temporary
    // password they should change after logging in.
    const tempPassword = `Dell-${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}!`;
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });
    if (createError) throw createError;

    return NextResponse.json({
      ok: true,
      outcome: "created",
      tempPassword,
      message: `No account existed yet — created and pre-confirmed one. Temporary password: ${tempPassword} (share this once; they should change it after logging in at /login).`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
