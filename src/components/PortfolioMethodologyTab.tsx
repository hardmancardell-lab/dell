import { PORTFOLIO_METHODOLOGY_OUTLINES } from "@/lib/agents/trading-agent/skills/portfolio-methodology";

export function PortfolioMethodologyTab() {
  return (
    <div className="space-y-10">
      <p className="text-zinc-500">
        Two different answers to the same question — how do you build a portfolio that isn&apos;t just a pile of
        stocks you like? Traditional and Modern Portfolio Theory approach it from opposite ends: one starts with the
        individual security, the other starts with how securities relate to each other.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {PORTFOLIO_METHODOLOGY_OUTLINES.map((outline) => (
          <section key={outline.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
            <h2 className="text-lg font-semibold mb-2">{outline.title}</h2>
            <p className="text-sm text-zinc-500 mb-5">{outline.summary}</p>
            <div className="space-y-4">
              {outline.points.map((p) => (
                <div key={p.heading}>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{p.heading}</div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{p.detail}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-6">
        <h2 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-300">Neither Is "Correct"</h2>
        <p className="text-sm text-amber-800 dark:text-amber-400 leading-relaxed">
          These aren&apos;t competing predictions about which stocks will go up — they&apos;re different frameworks
          for the same job, and they're not mutually exclusive. You can use the Traditional tab to source
          individually-strong candidates via the Graham Checklist, then use the Modern Portfolio Theory tab to check
          whether the resulting combination is actually diversified, or just a collection of stocks that happen to
          move together. Both tabs work off the same holdings on the Dashboard tab.
        </p>
      </section>
    </div>
  );
}
