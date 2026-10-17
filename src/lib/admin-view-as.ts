import { cookies } from "next/headers";
import { verifyAdminCookie } from "@/lib/access/tokens";

/**
 * "View As" cookie is only ever honored alongside a currently-valid
 * admin_session cookie (a signed token /admin/login sets) - so tampering with
 * this cookie's value requires already holding admin access, same trust
 * boundary as every other /admin/* capability in this app.
 */
export const ADMIN_VIEW_AS_COOKIE = "admin_view_as";

export async function getAdminViewAsSlug(): Promise<string | null> {
  const store = await cookies();
  if (!(await verifyAdminCookie(store.get("admin_session")?.value))) return null;
  return store.get(ADMIN_VIEW_AS_COOKIE)?.value ?? null;
}
