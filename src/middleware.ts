import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { bearerMatches, verifyAdminCookie, verifySiteCookie } from "@/lib/access/tokens";

const SITE_GATE_COOKIE = "site_access";

/**
 * Reachable WITHOUT the site-password cookie: the gate page and the endpoint that sets the cookie. (Before this was
 * checked ahead of the cookie test, /gate redirected to itself whenever SITE_ACCESS_PASSWORD was set.)
 */
const GATE_EXEMPT_PREFIXES = ["/gate", "/api/gate"];

/**
 * Callers that cannot hold a browser session at all (GitHub Actions, Twilio, an email link, a survey link) and that
 * the product promises "no login" to. They skip BOTH the site gate and the Supabase session, and are protected by
 * their own check instead:
 *   /api/cron/*            Bearer CRON_SECRET, constant-time, verified right here (and again in each handler)
 *   /api/sms-webhook       X-Twilio-Signature HMAC-SHA1, verified in the handler when TWILIO_AUTH_TOKEN is set
 *   /api/alerts/unsubscribe  unguessable subscription token in the query string
 *   /survey, /api/beta-feedback  open by design (emails say "no login"); the handler validates and size-caps input
 *                            and rate-limits per IP
 */
const SELF_AUTH_PREFIXES = ["/api/sms-webhook", "/api/alerts/unsubscribe", "/survey", "/api/beta-feedback"];
const CRON_PREFIX = "/api/cron";

/** Skip the Supabase user session (but still need the site cookie when the gate is on). */
const PUBLIC_PATH_PREFIXES = [
  "/admin",
  "/client",
  "/login",
  "/signup",
  "/gate",
  "/api/admin",
  "/api/client",
  "/api/gate",
  // Admin-only API routes that don't live under /api/admin: each route checks the admin session itself
  // (isAdminSessionValid), so they shouldn't also require a regular-user Supabase session.
  "/api/advisor",
  "/api/webull-token",
  "/api/webull-quote-test",
  // Read-only market data + the anonymous, session-id-based Paper Trading feature (never had a login requirement,
  // by design) - both are consumed by PriceChart, which is also embedded in the public /client/[slug] dashboard
  // (no Supabase session there), so neither can require one.
  "/api/chart-bars",
  "/api/paper-trading",
  // Ticker-parameterized market-data studies: same "read-only market data, no login requirement by design" rationale.
  "/api/gap-calendar-study",
  "/api/interaction-effects",
  "/api/correlation-matrix",
  "/api/fomc-reaction-study",
  "/api/fomc-week-variance",
  "/api/quad-witching-study",
  "/api/week-start-momentum",
  "/api/overnight-intraday-pattern",
  "/api/post-big-day-study",
  "/api/low-of-day-timing",
  "/api/witching-range-containment",
];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicPath(pathname: string): boolean {
  return matchesPrefix(pathname, PUBLIC_PATH_PREFIXES);
}

function jsonDenied(error: string, code: string, status = 401): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Layered gates, in order:
 * 0. Paths that must work without the site cookie: /gate and /api/gate; cron (Bearer CRON_SECRET); Twilio webhook,
 *    email unsubscribe, survey and beta-feedback (each self-protected, see SELF_AUTH_PREFIXES).
 * 1. Site-wide beta-access password (SITE_ACCESS_PASSWORD, /gate). The cookie holds a signed, expiring token, never
 *    the password. DECISION FOR THE OWNER: when SITE_ACCESS_PASSWORD is UNSET the gate is OFF (the site is open to
 *    anyone). That is the pre-existing behaviour and is kept; set the variable in production to enforce the gate.
 * 2. Real per-user Supabase Auth session for everything except the PUBLIC_PATH_PREFIXES (their own auth). Page
 *    requests are redirected to /login; /api/* requests get JSON 401 so client code never parses an HTML login page.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  if (matchesPrefix(pathname, GATE_EXEMPT_PREFIXES)) {
    return NextResponse.next();
  }

  if (matchesPrefix(pathname, [CRON_PREFIX])) {
    if (await bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.next();
    return jsonDenied("Unauthorized", "cron_unauthorized");
  }

  if (matchesPrefix(pathname, SELF_AUTH_PREFIXES)) {
    return NextResponse.next();
  }

  const sitePassword = process.env.SITE_ACCESS_PASSWORD;
  if (sitePassword) {
    const cookie = request.cookies.get(SITE_GATE_COOKIE)?.value;
    if (!(await verifySiteCookie(cookie))) {
      if (isApi) return jsonDenied("Site access password required.", "gate_required");
      return NextResponse.redirect(new URL("/gate", request.url));
    }
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // An admin actively "viewing as" a specific client - same admin_session gate as /admin/*, applied here to let the
  // admin browse the real app (not just /admin/*) without a Supabase user session for this browser. Route handlers
  // re-check this pair via getAdminViewAsSlug() before serving any per-user data - this only unblocks the page load.
  const viewAsSlug = request.cookies.get("admin_view_as")?.value;
  if (viewAsSlug && (await verifyAdminCookie(request.cookies.get("admin_session")?.value))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isApi) return jsonDenied("Sign in required (session missing or expired).", "auth_required");
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icons/|manifest.webmanifest|sw.js|icon-|videos/).*)",
  ],
};
