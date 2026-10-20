/**
 * Faye owner gate (design section 2.1). Used by every /api/faye/* route.
 *
 * Layers, in order (every one must pass):
 *   1. auth.getUser() - asks Supabase Auth, so a forged or stale cookie is not enough (getSession() would trust the cookie).
 *   2. email_confirmed_at is set (open sign-up may have email confirmation off).
 *   3. the lower-cased email is in FAYE_OWNER_EMAILS (server-only, comma separated). Empty or unset = nobody (fail closed).
 *   4. the database: every RPC re-checks faye_access (user id pinned by faye_seed_owner, email must still match, email confirmed).
 * The client is never trusted; the widget only decides whether to draw the button.
 */
import { errorBody, HTTP_STATUS, type ErrorBody, type FayeErrorCode } from "./mailbox/errors";

export interface GateUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

export interface RpcResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/** The slice of the Supabase server client the mailbox needs. The real client satisfies it; tests pass a fake. */
export interface GateClient {
  auth: { getUser(): Promise<{ data: { user: GateUser | null }; error: unknown }> };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResponse>;
}

export type Env = Record<string, string | undefined>;

export function parseOwnerEmails(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const e = part.trim().toLowerCase();
    if (e.length >= 3 && e.includes("@")) out.add(e);
  }
  return out;
}

export type OwnerVerdict = { ok: true } | { ok: false; reason: "no_user" | "no_email" | "unconfirmed" | "no_owner_list" | "not_listed" };

/** Pure decision used by the gate (layers 2 and 3). */
export function evaluateOwner(user: GateUser | null | undefined, owners: Set<string>): OwnerVerdict {
  if (!user || typeof user.id !== "string" || user.id.length === 0) return { ok: false, reason: "no_user" };
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, reason: "no_email" };
  if (!user.email_confirmed_at) return { ok: false, reason: "unconfirmed" };
  if (owners.size === 0) return { ok: false, reason: "no_owner_list" };
  if (!owners.has(email)) return { ok: false, reason: "not_listed" };
  return { ok: true };
}

export type GateResult =
  | { ok: true; user: GateUser; client: GateClient }
  | { ok: false; status: number; code: FayeErrorCode; body: ErrorBody; reason: string };

function deny(code: FayeErrorCode, reason: string): GateResult {
  return { ok: false, status: HTTP_STATUS[code], code, body: errorBody(code), reason };
}

/**
 * Runs layers 1 to 3. The caller supplies how to get the user-scoped client (the real one reads the session cookie).
 * The `reason` is for server logs and tests only; it is never sent to the browser.
 */
export async function gateOwner(getClient: () => Promise<GateClient>, env: Env = process.env): Promise<GateResult> {
  let client: GateClient;
  let user: GateUser | null;
  try {
    client = await getClient();
    const res = await client.auth.getUser();
    user = res.data?.user ?? null;
    if (!user && res.error) {
      // An auth-server failure is not the same as "no session", but both must fail closed.
      return deny("auth_required", "auth_error");
    }
  } catch {
    return deny("unavailable", "auth_unreachable");
  }
  if (!user) return deny("auth_required", "no_session");
  const verdict = evaluateOwner(user, parseOwnerEmails(env.FAYE_OWNER_EMAILS));
  if (!verdict.ok) return deny("not_allowed", verdict.reason);
  return { ok: true, user, client };
}

/**
 * CSRF guard for POST routes: JSON content type and a same-origin request. Supabase cookies are SameSite=Lax; this is belt and braces.
 * Origin must match the Host (or X-Forwarded-Host) the request arrived on. A request with no Origin is accepted only when the
 * browser says Sec-Fetch-Site is same-origin or none.
 */
export function checkPostRequest(request: Request): { ok: true } | { ok: false; code: FayeErrorCode; reason: string } {
  const ct = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("application/json")) return { ok: false, code: "bad_request", reason: "content_type" };
  const origin = request.headers.get("origin");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host).split(",")[0].trim().toLowerCase();
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { ok: false, code: "not_allowed", reason: "bad_origin" };
    }
    return originHost === host ? { ok: true } : { ok: false, code: "not_allowed", reason: "origin_mismatch" };
  }
  const site = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (site === "same-origin" || site === "none") return { ok: true };
  return { ok: false, code: "not_allowed", reason: "no_origin" };
}
