import { RESEARCH_SOURCE_CATEGORIES, SYNTHESIS_TABLE } from "@/lib/agents/research-agent/skills/research-sources";

export function ResearchSourcesTab() {
  return (
    <div className="space-y-10">
      <p className="text-zinc-500">
        Where institutional-grade sector analysis actually comes from — past
        the noise of retail financial news and sell-side consensus upgrades,
        which are lagging, sentiment-driven, and prone to cyclical bias.
      </p>

      {RESEARCH_SOURCE_CATEGORIES.map((cat) => (
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
        <h2 className="text-lg font-semibold mb-3">Synthesis: Question → Metric → Source</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4">Analytical Question</th>
                <th className="py-2 pr-4">Target Metric</th>
                <th className="py-2 pr-4">Primary Source</th>
              </tr>
            </thead>
            <tbody>
              {SYNTHESIS_TABLE.map((row) => (
                <tr key={row.question} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">{row.question}</td>
                  <td className="py-2 pr-4 font-medium">{row.metric}</td>
                  <td className="py-2 pr-4 text-zinc-500">{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950">
        <h2 className="text-lg font-semibold mb-2">This App&apos;s Workflow</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Economic analysis based on indicators (Macro tab) produces a
          stance and a set of live signals. Sector Recommendations then maps
          those same indicators onto each industry&apos;s primary drivers,
          producing a favorable/unfavorable read per sector. That read is a
          screening signal for where to look next, not a forecast &mdash;
          confirm it against the metrics pointers on each card (Industry
          Groups, Sector Fundamentals) and, ultimately, the primary sources
          above before treating it as anything more than a starting point.
        </p>
      </section>
    </div>
  );
}
