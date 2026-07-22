import { CURRENCY_DRIVER_CATEGORIES } from "@/lib/agents/trading-agent/skills/currency-drivers";

export function CurrencyDriversTab() {
  return (
    <div className="space-y-10">
      <p className="text-zinc-500">
        Written from an international-finance/macroeconomics perspective: the real mechanisms
        that move currency valuations, and why. Reference content — pair it with the Live Rates
        tab&apos;s &ldquo;Get Expert Read&rdquo; button for a synthesis grounded in this pair&apos;s
        actual current real news and rate data.
      </p>

      {CURRENCY_DRIVER_CATEGORIES.map((cat, i) => (
        <section key={cat.id}>
          <h2 className="text-lg font-semibold mb-1">
            {i + 1}. {cat.title}
          </h2>
          <p className="text-sm text-zinc-500 mb-3">{cat.intro}</p>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950 mb-3">
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Mechanism</div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{cat.mechanism}</p>
          </div>
          <div className="space-y-2">
            {cat.examples.map((ex) => (
              <div key={ex.label} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-sm font-medium">{ex.label}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{ex.detail}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
