import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AdvisorClientsManager } from "@/components/AdvisorClientsManager";

// Same cookie-gate precedent as /admin/analytics — sign in once at
// /admin/login to get the httpOnly session cookie, reused here rather than
// building a second admin auth path for this one page.
export default async function AdminClientsPage() {
  const expected = process.env.ADMIN_ANALYTICS_SECRET;
  const cookieStore = await cookies();
  const session = cookieStore.get("admin_session")?.value;
  if (!expected || !session || session !== expected) {
    notFound();
  }
  return <AdvisorClientsManager />;
}
