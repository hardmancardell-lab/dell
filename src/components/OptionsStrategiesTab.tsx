import {
  INSTITUTIONAL_USE_CASES,
  OI_VOLUME_READING_GUIDE,
  OPTIONS_STRATEGY_CATEGORIES,
} from "@/lib/agents/trading-agent/skills/options-strategies";

export function OptionsStrategiesTab() {
  return (
    <div className="jarvis flex flex-col gap-10">
      <p className="jv-lede">
        A reference catalog of options strategies, what open interest and volume patterns actually mean, why
        institutions use options in the first place, and how to read this app&apos;s own GEX and flow-skew
        signals as market insight rather than just numbers.
      </p>

      {OPTIONS_STRATEGY_CATEGORIES.map((cat) => (
        <section key={cat.id}>
          <div className="jv-strip-title" style={{ marginBottom: 4 }}>{cat.title}</div>
          <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>{cat.intro}</p>
          <div className="flex flex-col gap-3">
            {cat.strategies.map((s) => (
              <div key={s.name} className="jv-card">
                <div className="jv-br-b" />
                <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>{s.name}</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="jv-label">What It Is</div>
                    <div style={{ color: "var(--text-1)" }}>{s.whatItIs}</div>
                  </div>
                  <div>
                    <div className="jv-label">When To Use</div>
                    <div style={{ color: "var(--text-1)" }}>{s.whenToUse}</div>
                  </div>
                  <div>
                    <div className="jv-label">Reading OI &amp; Volume Here</div>
                    <div style={{ color: "var(--text-1)" }}>{s.oiVolumeNote}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <div className="jv-strip-title" style={{ marginBottom: 4 }}>5. Reading OI &amp; Volume</div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          The general patterns behind every strategy-specific note above, collected in one place.
        </p>
        <div className="flex flex-col gap-3">
          {OI_VOLUME_READING_GUIDE.map((g) => (
            <div key={g.pattern} className="jv-card">
              <div className="jv-br-b" />
              <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{g.pattern}</div>
              <div className="text-sm mt-1" style={{ color: "var(--text-1)" }}>{g.meaning}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="jv-strip-title" style={{ marginBottom: 4 }}>6. Why Institutions Use Options</div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          What options are actually for, beyond retail directional bets.
        </p>
        <div className="flex flex-col gap-3">
          {INSTITUTIONAL_USE_CASES.map((u) => (
            <div key={u.useCase} className="jv-card">
              <div className="jv-br-b" />
              <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{u.useCase}</div>
              <div className="text-sm mt-1" style={{ color: "var(--text-1)" }}>{u.explanation}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="jv-verdict-panel">
        <div className="jv-vp-label">
          <span className="jv-dot" aria-hidden="true" />
          This app&apos;s workflow — heuristic vs. measured
        </div>
        <p>
          The Dashboard tab&apos;s GEX &amp; Dealer Positioning section computes a real dealer-gamma regime,
          gamma flip level, call/put walls, and IV term structure from a live options chain with real open
          interest (via Tradier) — those are genuinely computed numbers, not estimates. Its Strategy Scanner
          section then maps that regime plus put/call flow skew to 1-2 candidate strategies from the catalog
          above. That mapping itself is a documented, rule-based expert heuristic (e.g. &ldquo;positive gamma
          + neutral skew → conditions commonly associated with iron condors&rdquo;), not a backtested or
          statistically validated recommendation the way the Backtest tabs elsewhere in this app are — treat
          it as a starting framework for your own analysis, not investment advice.
        </p>
      </div>
    </div>
  );
}
