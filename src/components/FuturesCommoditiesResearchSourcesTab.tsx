import { FUTURES_COMMODITIES_RESEARCH_CATEGORIES } from "@/lib/agents/trading-agent/skills/futures-commodities-research-sources";

export function FuturesCommoditiesResearchSourcesTab({ assetLabel }: { assetLabel: string }) {
  return (
    <div className="space-y-10">
      <p className="text-zinc-500">
        Starting scaffold for {assetLabel} research sources — official supply/demand
        data and positioning, to be expanded with strategy-specific buy/sell
        signal content in a later pass.
      </p>

      {FUTURES_COMMODITIES_RESEARCH_CATEGORIES.map((cat) => (
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
    </div>
  );
}
