import type { PortfolioShockScanEntry } from "@/lib/agents/trading-agent/types";

/** Shared card rendering for one GDELT coverage-spike scan result — used by
 * both the portfolio-wide scan (PortfolioDashboardTab) and the standalone,
 * holdings-free scanner (SupplyDemandShockScanTab). */
export function ShockScanEntryCard({ entry }: { entry: PortfolioShockScanEntry }) {
  return (
    <div className="jv-card" style={entry.triggered ? { borderColor: "var(--verdict-dim)" } : undefined}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>{entry.symbols.join(", ")}</div>
        {entry.triggered && (
          <span className="jv-badge" style={{ color: "var(--verdict)", borderColor: "var(--verdict-dim)", background: "rgba(240, 168, 104, 0.08)" }}>
            Coverage spike: {entry.coverageMultiple?.toFixed(1)}x average
          </span>
        )}
      </div>
      <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>{entry.mechanismNote}</p>
      {entry.narrative && <p className="text-sm mb-2 whitespace-pre-wrap" style={{ color: "var(--text-1)" }}>{entry.narrative}</p>}
      {entry.headlines.length > 0 && (
        <ul className="text-xs list-disc pl-4 flex flex-col gap-1" style={{ color: "var(--text-2)" }}>
          {entry.headlines.slice(0, 3).map((h) => (
            <li key={h.url}>
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="underline">
                {h.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
