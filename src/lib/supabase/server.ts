import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server Component / Route Handler Supabase client — reads/writes the auth session cookies via Next's cookies(). Uses the public anon key + RLS, same as the browser client; this is about running server-side, not about elevated privileges (unlike the service-role client used for this app's own data tables). */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component (not a Route Handler/Action) —
            // cookies() is read-only there. Middleware's session refresh
            // handles the actual write path; this is safe to ignore.
          }
        },
      },
    }
  );
}
