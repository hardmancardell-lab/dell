import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { gateOwner, type GateClient } from "@/lib/faye/access";
import { labEnabled } from "@/lib/faye/lab/config";
import { createClient } from "@/lib/supabase/server";
import { Lab } from "./Lab";

// Owner-only. Anyone who is not the owner (signed out, signed in as someone else, unconfirmed e-mail, not on FAYE_OWNER_EMAILS) gets the
// ordinary 404 page, the same as a path that does not exist. The routes under /api/faye/lab check again on every call.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Faye Lab", robots: { index: false, follow: false } };

export default async function FayeLabPage() {
  const gate = await gateOwner(async () => (await createClient()) as unknown as GateClient);
  if (!gate.ok) notFound();
  return <Lab enabled={labEnabled()} />;
}
