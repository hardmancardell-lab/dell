import Link from "next/link";

export default function TradingAgentHome() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
          Trading Agent
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">
          Execution & Timing Tools
        </h1>
        <p className="text-zinc-500 mt-2">
          Discretionary trading support: options math and volume-anomaly signals.
          Data and analysis only — no order placement.
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/trading/options-calculator"
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950 hover:border-zinc-400 dark:hover:border-zinc-600"
          >
            <h2 className="text-lg font-semibold">Options Calculator</h2>
            <p className="text-sm text-zinc-500 mt-2">
              Black-Scholes theoretical price and Greeks for a call/put.
            </p>
          </Link>
          <Link
            href="/trading/pm-volume"
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950 hover:border-zinc-400 dark:hover:border-zinc-600"
          >
            <h2 className="text-lg font-semibold">PM-Volume Tracker</h2>
            <p className="text-sm text-zinc-500 mt-2">
              Pre-market volume anomaly detection plus a historical composite of
              how the ticker behaved at key times of day the prior times this happened.
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
