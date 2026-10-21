import { gateOwner, type Env, type GateClient } from "@/lib/faye/access";

/**
 * Who may see the Lab page. Only the owner (same gate as every Faye route: confirmed e-mail, listed in FAYE_OWNER_EMAILS, a live session
 * checked with Supabase Auth). Everyone else, including a signed-out visitor and a failed auth check, is "hidden": the page answers the
 * ordinary 404, exactly like a path that does not exist, so it does not even confirm that a Lab exists.
 */
export async function labPageAccess(getClient: () => Promise<GateClient>, env: Env = process.env): Promise<"owner" | "hidden"> {
  try {
    const gate = await gateOwner(getClient, env);
    return gate.ok ? "owner" : "hidden";
  } catch {
    return "hidden";
  }
}
