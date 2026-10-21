/** The real dependencies for the Faye Lab routes. Kept apart from handlers.ts because it imports next/headers (not loadable in plain-node tests). */
import { createClient } from "@/lib/supabase/server";
import type { GateClient } from "../access";
import type { LabDeps } from "./handlers";

export function realDeps(): LabDeps {
  return {
    env: process.env,
    getClient: async () => (await createClient()) as unknown as GateClient,
  };
}
