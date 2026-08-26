"use client";

import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
  return (
    <button onClick={logout} className="text-xs hover:underline" style={{ color: "var(--text-2)" }}>
      Sign out
    </button>
  );
}
