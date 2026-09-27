import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for auth.admin.* operations (confirm/create
 * users, generate sign-in links without sending an email) — server-only,
 * never exposed to the browser. Uses the same SUPABASE_URL/
 * SUPABASE_SERVICE_ROLE_KEY pair already used for this app's own data
 * tables (advisor-clients-db.ts etc.), just via the real SDK instead of
 * plain REST, since auth.admin isn't a PostgREST table.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
