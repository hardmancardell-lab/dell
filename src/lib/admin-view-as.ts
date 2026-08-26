import { cookies } from "next/headers";

/**
 * "View As" cookie is only ever honored alongside a currently-valid
 * admin_session cookie (same secret /admin/login sets) — so tampering with
 * this cookie's value requires already holding admin access, same trust
 * boundary as every other /admin/* capability in this app.
 */
export const ADMIN_VIEW_AS_COOKIE = "admin_view_as";

export async function getAdminViewAsSlug(): Promise<string | null> {
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  if (!expected) return null;
  const store = await cookies();
  const adminSession = store.get("admin_session")?.value;
  if (!adminSession || adminSession !== expected) return null;
  return store.get(ADMIN_VIEW_AS_COOKIE)?.value ?? null;
}
