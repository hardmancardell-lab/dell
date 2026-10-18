import { NextResponse } from "next/server";
import { isValidId } from "@/lib/data/postgrest-safe";
import { getAdvisorClientBySlug, replacePasscodeHashIfUnchanged } from "@/lib/data/advisor-clients-db";
import { hashPasscodeSalted, verifyPasscode } from "@/lib/access/passcode";
import { clientIp, LockoutLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS, issueClientCookie } from "@/lib/access/tokens";

// Best-effort, per-instance: 5 wrong passcodes per 15 min per IP+slug, escalating lockout. A second limiter keyed by
// slug alone slows a distributed guess against one client link (10 failures per 15 min across all IPs).
const perIp = new LockoutLimiter(5, 15 * 60_000, 60_000, 60 * 60_000);
const perSlug = new LockoutLimiter(10, 15 * 60_000, 60_000, 30 * 60_000);

/**
 * Swaps a passcode entry for an httpOnly cookie scoped to this one client link, same "never put the secret in a URL"
 * precedent as /api/admin/login. The cookie holds a signed, expiring token keyed on the stored passcode hash (so
 * changing the passcode revokes it) and no longer contains the hash itself.
 *
 * Passcodes are stored as a salted scrypt hash (lib/access/passcode.ts). A row still holding the old unsalted SHA-256
 * is accepted, and on that same successful sign-in it is replaced by a salted hash (compare-and-set, failure ignored),
 * so no client is locked out and no data migration is needed. The cookie is bound to the stored hash, so when the hash
 * changes every OTHER outstanding session for this client fails the cookie check and is asked for the passcode again
 * (it never leaks anything); this sign-in gets a cookie for the new hash. Passcodes are never logged.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidId(slug)) return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  const ipKey = `${clientIp(request)}|${slug.slice(0, 64)}`;
  const slugKey = `slug|${slug.slice(0, 64)}`;
  const gate = perIp.check(ipKey);
  if (!gate.allowed) return tooManyRequests(gate);
  const gate2 = perSlug.check(slugKey);
  if (!gate2.allowed) return tooManyRequests(gate2);

  const body = await request.json().catch(() => null);
  if (typeof body?.passcode !== "string" || !body.passcode.trim()) {
    return NextResponse.json({ error: "Passcode is required." }, { status: 400 });
  }
  if (body.passcode.length > 256) {
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }
  const client = await getAdvisorClientBySlug(slug);
  // The check runs against a dummy hash when the slug is unknown, so timing does not reveal which slugs exist.
  const check = await verifyPasscode(body.passcode, client ? client.passcodeHash : null);
  if (!client || !check.ok) {
    const a = perIp.fail(ipKey);
    perSlug.fail(slugKey);
    if (!a.allowed) return tooManyRequests(a);
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }
  perIp.succeed(ipKey);
  let effectiveHash = client.passcodeHash;
  if (check.needsRehash) {
    try {
      const upgraded = await hashPasscodeSalted(body.passcode);
      if (await replacePasscodeHashIfUnchanged(slug, client.passcodeHash, upgraded)) effectiveHash = upgraded;
    } catch {
      // The old hash still works; the upgrade is tried again at the next sign-in. Nothing is logged: the error text could carry row data.
    }
  }
  const res = NextResponse.json({ ok: true, name: client.name });
  res.cookies.set(`client_session_${slug}`, await issueClientCookie(slug, effectiveHash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  return res;
}
