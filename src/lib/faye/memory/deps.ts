/** The real dependencies for the Faye memory routes. Kept apart from handlers.ts because it imports next/headers (not loadable in plain-node tests). */
import { createClient } from "@/lib/supabase/server";
import type { GateClient } from "../access";
import type { MemoryDeps } from "./handlers";

export function realDeps(): MemoryDeps {
  return {
    env: process.env,
    getClient: async () => (await createClient()) as unknown as GateClient,
  };
}
