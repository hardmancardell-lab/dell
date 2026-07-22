import Link from "next/link";

export function NavBar() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          Graham Research Agent
        </Link>
      </div>
    </header>
  );
}
