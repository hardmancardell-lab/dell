import { cookies } from "next/headers";
import { verifyAdminCookie } from "@/lib/access/tokens";

/** Shared admin_session cookie check for Route Handlers and admin pages. The cookie is a signed, expiring token issued by /api/admin/login, not the secret itself. */
export async function isAdminSessionValid(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminCookie(cookieStore.get("admin_session")?.value);
}
