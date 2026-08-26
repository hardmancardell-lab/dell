import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export function NavBar() {
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
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-semibold tracking-tight" style={{ color: "var(--text-0)" }}>
            Dellegate
          </span>
          <span className="hidden sm:inline text-xs" style={{ color: "var(--text-2)" }}>
            Delegate the research. Own the decision.
          </span>
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
