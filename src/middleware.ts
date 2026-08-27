import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SITE_GATE_COOKIE = "site_access";

const PUBLIC_PATH_PREFIXES = [
  "/admin",
  "/client",
  "/login",
  "/signup",
  "/gate",
  "/api/admin",
  "/api/client",
  "/api/gate",
  "/api/auth",
  // Admin-only API routes that don't live under /api/admin — all already
  // gated by isAdminSessionValid()'s separate admin-secret cookie, so they
  // shouldn't also require a regular-user Supabase session.
  "/api/advisor",
  "/api/webull-token",
  "/api/webull-quote-test",
  // Read-only market data + the anonymous, session-id-based Paper Trading
  // feature (never had a login requirement, by design) — both are consumed
  // by PriceChart, which is now also embedded in the public /client/[slug]
  // dashboard (no Supabase session there), so neither can require one.
  "/api/chart-bars",
  "/api/paper-trading",
  // Ticker-parameterized market-data studies — same "read-only market data,
  // no login requirement by design" rationale as chart-bars above.
  "/api/gap-calendar-study",
  "/api/interaction-effects",
  "/api/correlation-matrix",
  "/api/debug-christopher-live-view",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Two independent gates, layered in order:
 * 1. Site-wide beta-access password (unchanged from before — SITE_ACCESS_PASSWORD,
 *    /gate). Still required first for anyone without the shared password.
 * 2. Real per-user Supabase Auth session, required for everything except
 *    /admin/* (its own admin-secret cookie), /client/* (its own per-client
 *    passcode), and the auth pages themselves — those three areas keep their
 *    existing, separate auth mechanisms untouched.
 */
export async function middleware(request: NextRequest) {
  const sitePassword = process.env.SITE_ACCESS_PASSWORD;
  if (sitePassword) {
    const cookie = request.cookies.get(SITE_GATE_COOKIE)?.value;
    if (cookie !== sitePassword) {
      return NextResponse.redirect(new URL("/gate", request.url));
    }
  }

  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // An admin actively "viewing as" a specific client — same admin_session
  // secret gate as /admin/*, applied here to let the admin browse the real
  // app (not just /admin/*) without a Supabase user session for this browser.
  // Route handlers themselves re-check this pair via getAdminViewAsSlug()
  // before serving any per-user data — this only unblocks the page load.
  const adminSecret = process.env.ADMIN_ANALYTICS_SECRET;
  const adminSession = request.cookies.get("admin_session")?.value;
  const viewAsSlug = request.cookies.get("admin_view_as")?.value;
  if (adminSecret && adminSession === adminSecret && viewAsSlug) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icons/|manifest.webmanifest|sw.js|icon-|videos/).*)",
  ],
};
