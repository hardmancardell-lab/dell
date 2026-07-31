import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Swaps a one-time password entry for an httpOnly cookie, so the admin
 * secret never has to live in a URL (browser history, screenshots, shared
 * links, server access logs) the way ?secret=... did. Route Handlers are
 * the only place Next.js allows setting cookies server-side — a plain
 * Server Component (like the /admin/analytics page) can only read them.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  if (!expected || !body?.secret || body.secret !== expected) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
