import Link from "next/link";

export function NavBar() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-semibold tracking-tight">Dellegate</span>
          <span className="hidden sm:inline text-xs text-zinc-500">Delegate the research. Own the decision.</span>
        </Link>
      </div>
    </header>
  );
}
