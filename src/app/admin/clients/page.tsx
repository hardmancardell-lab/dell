import { verifyAdminCookie } from "@/lib/access/tokens";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AdvisorClientsManager } from "@/components/AdvisorClientsManager";

// Same cookie-gate precedent as /admin/analytics — sign in once at
// /admin/login to get the httpOnly session cookie, reused here rather than
// building a second admin auth path for this one page.
export default async function AdminClientsPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  if (!(await verifyAdminCookie(session))) {
    notFound();
  }
  return <AdvisorClientsManager />;
}
