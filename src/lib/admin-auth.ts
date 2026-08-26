import { cookies } from "next/headers";

/** Shared admin_session cookie check for Route Handlers — same cookie/secret /admin/login already sets, reused here rather than building a second admin auth path. */
export async function isAdminSessionValid(): Promise<boolean> {
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  if (!expected) return false;
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  return Boolean(session && session === expected);
}
