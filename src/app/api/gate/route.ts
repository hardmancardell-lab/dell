import { NextResponse } from "next/server";
import { clientIp, LockoutLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS, issueSiteCookie, timingSafeEqualStr } from "@/lib/access/tokens";

const COOKIE_NAME = "site_access";

// Best-effort, per-instance (see src/lib/access/rate-limit.ts): 5 wrong passwords per 15 min per IP, then a lockout that doubles.
const limiter = new LockoutLimiter(5, 15 * 60_000, 60_000, 60 * 60_000);

export async function POST(request: Request) {
  const ip = clientIp(request);
  const gate = limiter.check(ip);
  if (!gate.allowed) return tooManyRequests(gate);

  const body = await request.json().catch(() => null);
  const expected = process.env.SITE_ACCESS_PASSWORD;
  const given = typeof body?.password === "string" ? body.password : "";
  if (!expected || !given || given.length > 512 || !(await timingSafeEqualStr(given, expected))) {
    const after = limiter.fail(ip);
    if (!after.allowed) return tooManyRequests(after);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  limiter.succeed(ip);
  const res = NextResponse.json({ ok: true });
  // The cookie holds a signed, expiring token derived from the password, never the password itself.
  res.cookies.set(COOKIE_NAME, await issueSiteCookie(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  return res;
}
