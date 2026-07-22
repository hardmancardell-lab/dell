import {
  INSTITUTIONAL_USE_CASES,
  OI_VOLUME_READING_GUIDE,
  OPTIONS_STRATEGY_CATEGORIES,
} from "@/lib/agents/trading-agent/skills/options-strategies";

export function OptionsStrategiesTab() {
  return (
    <div className="space-y-10">
      <p className="text-zinc-500">
        A reference catalog of options strategies, what open interest and
        volume patterns actually mean, why institutions use options in the
        first place, and how to read this app&apos;s own GEX and flow-skew
        signals as market insight rather than just numbers.
      </p>

      {OPTIONS_STRATEGY_CATEGORIES.map((cat) => (
        <section key={cat.id}>
          <h2 className="text-lg font-semibold mb-1">{cat.title}</h2>
          <p className="text-sm text-zinc-500 mb-4">{cat.intro}</p>
          <div className="space-y-3">
            {cat.strategies.map((s) => (
              <div
                key={s.name}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950"
              >
                <div className="font-medium text-sm mb-2">{s.name}</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">What It Is</div>
                    <div className="text-zinc-600 dark:text-zinc-400">{s.whatItIs}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">When To Use</div>
                    <div className="text-zinc-600 dark:text-zinc-400">{s.whenToUse}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Reading OI &amp; Volume Here</div>
                    <div className="text-zinc-600 dark:text-zinc-400">{s.oiVolumeNote}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h2 className="text-lg font-semibold mb-1">5. Reading OI &amp; Volume</h2>
        <p className="text-sm text-zinc-500 mb-4">
          The general patterns behind every strategy-specific note above,
          collected in one place.
        </p>
        <div className="space-y-3">
          {OI_VOLUME_READING_GUIDE.map((g) => (
            <div
              key={g.pattern}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950"
            >
              <div className="font-medium text-sm">{g.pattern}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{g.meaning}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-1">6. Why Institutions Use Options</h2>
        <p className="text-sm text-zinc-500 mb-4">
          What options are actually for, beyond retail directional bets.
        </p>
        <div className="space-y-3">
          {INSTITUTIONAL_USE_CASES.map((u) => (
            <div
              key={u.useCase}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950"
            >
              <div className="font-medium text-sm">{u.useCase}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{u.explanation}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-6">
        <h2 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-300">
          This App&apos;s Workflow — and What&apos;s a Heuristic vs. What&apos;s Measured
        </h2>
        <p className="text-sm text-amber-800 dark:text-amber-400 leading-relaxed">
          The Dashboard tab&apos;s GEX &amp; Dealer Positioning section computes a
          real dealer-gamma regime, gamma flip level, call/put walls, and IV
          term structure from a live options chain with real open interest
          (via Tradier) — those are genuinely computed numbers, not
          estimates. Its Strategy Scanner section then maps that regime plus
          put/call flow skew to 1-2 candidate strategies from the catalog
          above. That mapping itself is a documented, rule-based expert
          heuristic (e.g. &ldquo;positive gamma + neutral skew → conditions
          commonly associated with iron condors&rdquo;), not a backtested or
          statistically validated recommendation the way the Backtest tabs
          elsewhere in this app are — treat it as a starting framework for
          your own analysis, not investment advice.
        </p>
      </section>
    </div>
  );
}
