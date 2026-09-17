import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { createClient } from "@/lib/supabase/server";

export async function NavBar() {
  // Real bug found live: this used to render LogoutButton unconditionally,
  // so a brand-new visitor with no account at all (e.g. someone opening a
  // /signup link for the first time) saw "Sign out" sitting right next to
  // "Create account" — confusing enough that it read as the app being
  // broken. Only show it when there's an actual logged-in Supabase session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header
      className="jarvis"
      style={{
        background: "rgba(8, 11, 16, 0.55)",
        backgroundImage: "none",
        backdropFilter: "blur(6px)",
        borderBottom: "1px solid var(--line)",
        borderRadius: 0,
        padding: 0,
      }}
    >
      <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/dellegate-mark.png" alt="Dellegate" width={71} height={44} style={{ borderRadius: 4, objectFit: "cover" }} />
          <span className="font-semibold tracking-tight" style={{ color: "var(--text-0)" }}>
            Dellegate
          </span>
          <span className="hidden sm:inline text-xs" style={{ color: "var(--text-2)" }}>
            Delegate the research. Own the decision.
          </span>
        </Link>
        {user && <LogoutButton />}
      </div>
    </header>
  );
}
