import { RESEARCH_SOURCE_CATEGORIES, SYNTHESIS_TABLE } from "@/lib/agents/research-agent/skills/research-sources";

export function ResearchSourcesTab() {
  return (
    <div className="flex flex-col gap-10">
      <p className="jv-lede">
        Where institutional-grade sector analysis actually comes from — past the noise of retail
        financial news and sell-side consensus upgrades, which are lagging, sentiment-driven, and
        prone to cyclical bias.
      </p>

      {RESEARCH_SOURCE_CATEGORIES.map((cat) => (
        <section key={cat.id}>
          <div className="jv-strip-title" style={{ marginBottom: 4 }}>
            {cat.title}
          </div>
          <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
            {cat.intro}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cat.sources.map((s) => (
              <div key={s.name} className="jv-card">
                <div className="jv-br-b" />
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                  {s.name}
                </div>
                <div className="text-sm mt-1" style={{ color: "var(--text-1)" }}>
                  {s.description}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <div className="jv-strip-title">Synthesis: Question → Metric → Source</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Analytical Question</th>
                <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Target Metric</th>
                <th className="py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal">Primary Source</th>
              </tr>
            </thead>
            <tbody>
              {SYNTHESIS_TABLE.map((row) => (
                <tr key={row.question} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                  <td className="py-2 pr-4" style={{ color: "var(--text-1)" }}>
                    {row.question}
                  </td>
                  <td className="py-2 pr-4 font-medium font-mono" style={{ color: "var(--text-0)" }}>
                    {row.metric}
                  </td>
                  <td className="py-2 pr-4" style={{ color: "var(--text-2)" }}>
                    {row.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="jv-verdict-panel">
        <div className="jv-vp-label">
          <span className="jv-dot" aria-hidden="true" />
          This app&apos;s workflow
        </div>
        <p>
          Economic analysis based on indicators (Macro tab) produces a stance and a set of live
          signals. Sector Recommendations then maps those same indicators onto each industry&apos;s
          primary drivers, producing a favorable/unfavorable read per sector. That read is a
          screening signal for where to look next, not a forecast &mdash; confirm it against the
          metrics pointers on each card (Industry Groups, Sector Fundamentals) and, ultimately, the
          primary sources above before treating it as anything more than a starting point.
        </p>
      </div>
    </div>
  );
}
