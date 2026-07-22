import { FX_RESEARCH_CATEGORIES, FX_STRATEGY_FRAMEWORK } from "@/lib/agents/trading-agent/skills/fx-research-sources";

export function FxResearchSourcesTab() {
  return (
    <div className="space-y-10">
      <p className="text-zinc-500">
        Verified, checkable sources on what actually moves currency pairs —
        balance of payments, positioning, central bank communication, and
        market-microstructure research — plus a step-by-step buy/sell
        framework built from that material.
      </p>

      {FX_RESEARCH_CATEGORIES.map((cat) => (
        <section key={cat.id}>
          <h2 className="text-lg font-semibold mb-1">{cat.title}</h2>
          <p className="text-sm text-zinc-500 mb-4">{cat.intro}</p>
          <div className="space-y-3">
            {cat.sources.map((s) => (
              <div
                key={s.name}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950"
              >
                <div className="font-medium text-sm">{s.name}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{s.description}</div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h2 className="text-lg font-semibold mb-1">5. Strategy Framework: Buy/Sell Signals</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Five recurring FX strategies, each broken into what confirms a buy,
          what confirms a sell, and the check that keeps you from
          over-reading a false positive.
        </p>
        <div className="space-y-4">
          {FX_STRATEGY_FRAMEWORK.map((s) => (
            <div key={s.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
              <div className="font-medium text-sm mb-3">{s.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-green-700 dark:text-green-500 mb-1">Buy Signal</div>
                  <div className="text-zinc-600 dark:text-zinc-400">{s.buySignal}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-red-700 dark:text-red-500 mb-1">Sell Signal</div>
                  <div className="text-zinc-600 dark:text-zinc-400">{s.sellSignal}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Confirming Check</div>
                  <div className="text-zinc-600 dark:text-zinc-400">{s.confirmingCheck}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-6">
        <h2 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-300">
          On Precision: What&apos;s Illustrative vs. What&apos;s Measured
        </h2>
        <p className="text-sm text-amber-800 dark:text-amber-400 leading-relaxed">
          Specific pip ranges and Fibonacci-style retracement percentages
          (e.g. &ldquo;50-78.6% same-day fade&rdquo;) are common discretionary-trader
          heuristics, not measured statistics from a dataset — there is no
          strong academic consensus that those particular ratios are
          privileged reversion levels. The one number-backed claim in this
          guide is the Andersen/Bollerslev/Diebold/Vega finding above (price
          adjusts near-instantly, volatility persists and decays), and even
          that paper doesn&apos;t hand you a specific pip figure for a given
          event. Turning the Event-Reaction strategy into real measured
          numbers would require an economic-surprise calendar plus historical
          intraday FX price data — this app doesn&apos;t have a source for
          either yet, so treat the framework above as a qualitative decision
          process, not a lookup table.
        </p>
      </section>
    </div>
  );
}
