import { CURRENCY_DRIVER_CATEGORIES } from "@/lib/agents/trading-agent/skills/currency-drivers";

export function CurrencyDriversTab() {
  return (
    <div className="jarvis flex flex-col gap-10">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Written from an international-finance/macroeconomics perspective: the real mechanisms
        that move currency valuations, and why. Reference content — pair it with the Live Rates
        tab&apos;s &ldquo;Get Expert Read&rdquo; button for a synthesis grounded in this pair&apos;s
        actual current real news and rate data.
      </p>

      {CURRENCY_DRIVER_CATEGORIES.map((cat, i) => (
        <section key={cat.id}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text-0)" }}>
            {i + 1}. {cat.title}
          </h2>
          <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>{cat.intro}</p>
          <div className="jv-card mb-3">
            <div className="jv-br-b" />
            <div className="jv-label">Mechanism</div>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-1)" }}>{cat.mechanism}</p>
          </div>
          <div className="flex flex-col gap-2">
            {cat.examples.map((ex) => (
              <div key={ex.label} className="jv-card">
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{ex.label}</div>
                <div className="text-sm mt-1" style={{ color: "var(--text-1)" }}>{ex.detail}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
