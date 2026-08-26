import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client for Auth — uses the public anon key (safe to ship to the client, protected by RLS, not secret), never the service-role key used everywhere else in this app's server-only Supabase REST calls. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
