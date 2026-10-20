/** The real dependencies for the Faye routes. Kept apart from handlers.ts because it imports next/headers (not loadable in plain-node tests). */
import { createClient } from "@/lib/supabase/server";
import type { GateClient } from "../access";
import type { HandlerDeps } from "./handlers";

export function realDeps(): HandlerDeps {
  return {
    env: process.env,
    // The real client has the same auth.getUser / rpc surface the gate uses.
    getClient: async () => (await createClient()) as unknown as GateClient,
  };
}
