import { FUTURES_COMMODITIES_RESEARCH_CATEGORIES } from "@/lib/agents/trading-agent/skills/futures-commodities-research-sources";

export function FuturesCommoditiesResearchSourcesTab({ assetLabel }: { assetLabel: string }) {
  return (
    <div className="jarvis flex flex-col gap-10">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Starting scaffold for {assetLabel} research sources — official supply/demand
        data and positioning, to be expanded with strategy-specific buy/sell
        signal content in a later pass.
      </p>

      {FUTURES_COMMODITIES_RESEARCH_CATEGORIES.map((cat) => (
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
    </div>
  );
}
