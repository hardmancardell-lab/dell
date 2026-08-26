import { NextResponse } from "next/server";
import { getAdvisorClientBySlug, hashPasscode } from "@/lib/data/advisor-clients-db";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Swaps a passcode entry for an httpOnly cookie scoped to this one client
 * link, same "never put the secret in a URL" precedent as /api/admin/login —
 * the cookie holds the stored passcode hash (not the plaintext), so the
 * dashboard route can verify it without a second DB round trip.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (!body?.passcode?.trim()) {
    return NextResponse.json({ error: "Passcode is required." }, { status: 400 });
  }
  const client = await getAdvisorClientBySlug(slug);
  if (!client || hashPasscode(body.passcode) !== client.passcodeHash) {
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, name: client.name });
  res.cookies.set(`client_session_${slug}`, client.passcodeHash, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return res;
}
