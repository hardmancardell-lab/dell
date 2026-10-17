import { NextResponse } from "next/server";
import { clientIp, LockoutLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS, issueAdminCookie, timingSafeEqualStr } from "@/lib/access/tokens";

const COOKIE_NAME = "admin_session";

// Best-effort, per-instance: 5 wrong secrets per 15 min per IP, then an escalating lockout (1, 2, 4... up to 60 min).
const limiter = new LockoutLimiter(5, 15 * 60_000, 60_000, 60 * 60_000);

/**
 * Swaps a one-time password entry for an httpOnly cookie, so the admin
 * secret never has to live in a URL (browser history, screenshots, shared
 * links, server access logs) the way ?secret=... did. The cookie holds a
 * signed, expiring token derived from the secret, never the secret itself.
 * Route Handlers are the only place Next.js allows setting cookies
 * server-side - a plain Server Component can only read them.
 */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const gate = limiter.check(ip);
  if (!gate.allowed) return tooManyRequests(gate);

  const body = await request.json().catch(() => null);
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  const given = typeof body?.secret === "string" ? body.secret : "";
  if (!expected || !given || given.length > 512 || !(await timingSafeEqualStr(given, expected))) {
    const after = limiter.fail(ip);
    if (!after.allowed) return tooManyRequests(after);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  limiter.succeed(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await issueAdminCookie(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
