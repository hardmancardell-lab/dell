import { FX_RESEARCH_CATEGORIES, FX_STRATEGY_FRAMEWORK } from "@/lib/agents/trading-agent/skills/fx-research-sources";

export function FxResearchSourcesTab() {
  return (
    <div className="jarvis flex flex-col gap-10">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Verified, checkable sources on what actually moves currency pairs —
        balance of payments, positioning, central bank communication, and
        market-microstructure research — plus a step-by-step buy/sell
        framework built from that material.
      </p>

      {FX_RESEARCH_CATEGORIES.map((cat) => (
        <section key={cat.id}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text-0)" }}>{cat.title}</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>{cat.intro}</p>
          <div className="flex flex-col gap-3">
            {cat.sources.map((s) => (
              <div key={s.name} className="jv-card">
                <div className="font-medium text-sm" style={{ color: "var(--text-0)" }}>{s.name}</div>
                <div className="text-sm mt-1" style={{ color: "var(--text-1)" }}>{s.description}</div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text-0)" }}>5. Strategy Framework: Buy/Sell Signals</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Five recurring FX strategies, each broken into what confirms a buy,
          what confirms a sell, and the check that keeps you from
          over-reading a false positive.
        </p>
        <div className="flex flex-col gap-4">
          {FX_STRATEGY_FRAMEWORK.map((s) => (
            <div key={s.id} className="jv-card">
              <div className="font-medium text-sm mb-3" style={{ color: "var(--text-0)" }}>{s.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="jv-cond c-signal" style={{ marginBottom: 4 }}>Buy Signal</div>
                  <div style={{ color: "var(--text-1)" }}>{s.buySignal}</div>
                </div>
                <div>
                  <div className="jv-cond c-danger" style={{ marginBottom: 4 }}>Sell Signal</div>
                  <div style={{ color: "var(--text-1)" }}>{s.sellSignal}</div>
                </div>
                <div>
                  <div className="jv-cond c-neutral" style={{ marginBottom: 4 }}>Confirming Check</div>
                  <div style={{ color: "var(--text-1)" }}>{s.confirmingCheck}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="jv-verdict-panel">
        <div className="jv-vp-label">
          <span className="jv-dot" />
          On Precision: What&apos;s Illustrative vs. What&apos;s Measured
        </div>
        <p>
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
