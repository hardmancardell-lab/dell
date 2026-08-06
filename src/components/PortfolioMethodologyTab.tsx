import { PORTFOLIO_METHODOLOGY_OUTLINES } from "@/lib/agents/trading-agent/skills/portfolio-methodology";

export function PortfolioMethodologyTab() {
  return (
    <div className="jarvis flex flex-col gap-10">
      <p className="jv-lede">
        Two different answers to the same question — how do you build a portfolio that isn&apos;t just a pile of
        stocks you like? Traditional and Modern Portfolio Theory approach it from opposite ends: one starts with the
        individual security, the other starts with how securities relate to each other.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {PORTFOLIO_METHODOLOGY_OUTLINES.map((outline) => (
          <section key={outline.id} className="jv-card">
            <div className="jv-br-b" />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--text-0)" }}>{outline.title}</h2>
            <p className="text-sm mb-5" style={{ color: "var(--text-1)" }}>{outline.summary}</p>
            <div className="flex flex-col gap-4">
              {outline.points.map((p) => (
                <div key={p.heading}>
                  <div className="jv-label">{p.heading}</div>
                  <p className="text-sm" style={{ color: "var(--text-1)" }}>{p.detail}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="jv-verdict-panel">
        <div className="jv-vp-label">
          <span className="jv-dot" />
          Neither Is &quot;Correct&quot;
        </div>
        <p>
          These aren&apos;t competing predictions about which stocks will go up — they&apos;re different frameworks
          for the same job, and they&apos;re not mutually exclusive. You can use the Traditional tab to source
          individually-strong candidates via the Value Checklist, then use the Modern Portfolio Theory tab to check
          whether the resulting combination is actually diversified, or just a collection of stocks that happen to
          move together. Both tabs work off the same holdings on the Dashboard tab.
        </p>
      </section>
    </div>
  );
}
