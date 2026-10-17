import { NextResponse } from "next/server";
import { fetchQuote, isWebullConfigured } from "@/lib/data/webull";
import { isAdminSessionValid } from "@/lib/admin-auth";

/**
 * Verification-only route - hit this once real WEBULL_APP_KEY/SECRET are set to confirm the signing algorithm and
 * snapshot endpoint actually work against Webull's live API. It is on the middleware's public list (admin routes carry
 * their own auth instead of a Supabase user session), so the admin check below is what protects it: without the admin
 * session cookie it answers 404, so it cannot be used to spend Webull quota or read provider error text.
 */
export async function GET(request: Request) {
  if (!(await isAdminSessionValid())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!isWebullConfigured()) {
    return NextResponse.json({ error: "WEBULL_APP_KEY/WEBULL_APP_SECRET are not configured." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? "AAPL").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-=/^]{0,14}$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  }
  try {
    const quote = await fetchQuote(symbol);
    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
