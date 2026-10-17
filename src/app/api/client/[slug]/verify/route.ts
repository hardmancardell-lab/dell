import { NextResponse } from "next/server";
import { isValidId } from "@/lib/data/postgrest-safe";
import { getAdvisorClientBySlug, hashPasscode } from "@/lib/data/advisor-clients-db";
import { clientIp, LockoutLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS, issueClientCookie, timingSafeEqualStr } from "@/lib/access/tokens";

// Best-effort, per-instance: 5 wrong passcodes per 15 min per IP+slug, escalating lockout. A second limiter keyed by
// slug alone slows a distributed guess against one client link (10 failures per 15 min across all IPs).
const perIp = new LockoutLimiter(5, 15 * 60_000, 60_000, 60 * 60_000);
const perSlug = new LockoutLimiter(10, 15 * 60_000, 60_000, 30 * 60_000);

/**
 * Swaps a passcode entry for an httpOnly cookie scoped to this one client link, same "never put the secret in a URL"
 * precedent as /api/admin/login. The cookie holds a signed, expiring token keyed on the stored passcode hash (so
 * changing the passcode revokes it) and no longer contains the hash itself.
 *
 * NOT FIXED HERE: passcodes are still stored as unsalted SHA-256 (advisor-clients-db hashPasscode). Moving to
 * scrypt with a per-client salt needs a data migration of existing advisor_clients rows; see fix-batch-A notes.
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
  // Hash even when the slug is unknown so timing does not reveal which slugs exist.
  const candidate = hashPasscode(body.passcode);
  const ok = client ? await timingSafeEqualStr(candidate, client.passcodeHash) : false;
  if (!client || !ok) {
    const a = perIp.fail(ipKey);
    perSlug.fail(slugKey);
    if (!a.allowed) return tooManyRequests(a);
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }
  perIp.succeed(ipKey);
  const res = NextResponse.json({ ok: true, name: client.name });
  res.cookies.set(`client_session_${slug}`, await issueClientCookie(slug, client.passcodeHash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  return res;
}
