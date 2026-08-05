import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "site_access";

/**
 * Site-wide access gate — beta test phase is over, no public access while this
 * IP isn't meant to be visible to anyone but the owner. Every route redirects
 * to /gate until the correct password is entered there (see /api/gate, which
 * sets the httpOnly cookie this checks). If SITE_ACCESS_PASSWORD isn't set,
 * the gate fails open (no lockout risk from a missing env var) — set it in
 * Vercel to actually enable the lock.
 */
export function middleware(request: NextRequest) {
  const password = process.env.SITE_ACCESS_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (cookie === password) return NextResponse.next();

  const gateUrl = new URL("/gate", request.url);
  return NextResponse.redirect(gateUrl);
}

export const config = {
  matcher: [
    /*
     * Match every route except:
     * - /gate (the password page itself)
     * - /api/gate (the password-check endpoint)
     * - Next.js internals and static assets
     */
    "/((?!gate|api/gate|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icons/|manifest.webmanifest|sw.js|icon-|videos/).*)",
  ],
};
