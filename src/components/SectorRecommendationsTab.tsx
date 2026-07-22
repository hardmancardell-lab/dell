"use client";

import { useEffect, useState } from "react";
import type { SectorRecommendation } from "@/lib/agents/research-agent/types";

const READ_BADGE_CLASS: Record<SectorRecommendation["overallRead"], string> = {
  constructive: "jv-badge c-signal",
  cautious: "jv-badge c-danger",
  mixed: "jv-badge c-neutral",
};

function ReadBadge({ read }: { read: SectorRecommendation["overallRead"] }) {
  return <span className={READ_BADGE_CLASS[read]}>{read}</span>;
}

function TrendCond({ trend, isFavorable }: { trend: string; isFavorable: boolean | null }) {
  const arrow = trend === "rising" ? "↑ Rising" : trend === "falling" ? "↓ Falling" : "→ Flat";
  const cls = isFavorable === null ? "c-neutral" : isFavorable ? "c-signal" : "c-danger";
  return <div className={`jv-cond ${cls}`}>{arrow}</div>;
}

/** Animated pulse bar standing in for a per-count wire convergence — see globals.css .jv-converge-bar note. */
function ConvergeBar() {
  return (
    <div className="jv-converge-bar" aria-hidden="true">
      <svg viewBox="0 0 100 18" preserveAspectRatio="none">
        <line className="base" x1="50" y1="0" x2="50" y2="18" />
        <line className="pulse" x1="50" y1="0" x2="50" y2="18" />
      </svg>
    </div>
  );
}

export function SectorRecommendationsTab() {
  const [data, setData] = useState<SectorRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sector-recommendations")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) setError(json.error ?? "Unknown error");
        else setData(json as SectorRecommendation[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, []);

  // No .jarvis wrapper here — this tab always renders nested inside the
  // Sector section's single .jarvis scope in page.tsx; double-wrapping would
  // stack a second background/padding/radial-gradient layer.
  return (
    <div>
      <p className="jv-lede">
        Live macro indicator readings mapped to each industry&apos;s primary drivers, converging into one
        stance per industry &mdash; a screening signal, not a forecast. Pair with the written analysis and
        the metrics pointers below each card.
      </p>

      {loading && <div className="text-sm" style={{ color: "var(--text-2)" }}>Loading live indicator readings…</div>}

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-10">
          {data.map((rec) => (
            <div key={rec.industryId}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-base font-semibold" style={{ color: "var(--text-0)" }}>
                  {rec.industryName}
                </h3>
                <ReadBadge read={rec.overallRead} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {rec.signals.map((s) => (
                  <div key={s.indicatorId} className="jv-card">
                    <div className="jv-br-b" />
                    <div className="jv-label">{s.label}</div>
                    <TrendCond trend={s.trend} isFavorable={s.isFavorable} />
                    <div className="jv-stat">
                      <span>{s.unit}</span>
                      <b>
                        {s.latestValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        {s.latestDate ? ` · ${s.latestDate}` : ""}
                      </b>
                    </div>
                  </div>
                ))}
              </div>

              <ConvergeBar />

              <div className="jv-verdict-panel">
                <div className="jv-vp-label">
                  <span className="jv-dot" aria-hidden="true" />
                  {rec.macroLinkage.stanceLabel}
                </div>
                <h3>{rec.analysis}</h3>
                <p style={{ marginBottom: 10 }}>{rec.macroLinkage.rationale}</p>
                <div className="text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
                  Affected by: {rec.macroLinkage.affectedBy.join(", ")}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div className="jv-card">
                  <div className="jv-label" style={{ color: "var(--danger)" }}>
                    Obstacles
                  </div>
                  <ul className="text-xs space-y-1 list-disc list-inside" style={{ color: "var(--text-1)" }}>
                    {rec.obstacles.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
                <div className="jv-card">
                  <div className="jv-label" style={{ color: "var(--signal)" }}>
                    Opportunities
                  </div>
                  <ul className="text-xs space-y-1 list-disc list-inside" style={{ color: "var(--text-1)" }}>
                    {rec.opportunities.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="jv-note">
                {rec.favorableCount} favorable / {rec.unfavorableCount} unfavorable of {rec.signals.length}{" "}
                tracked.
                {rec.relevantMetrics.fredIndustryGroupLabel && (
                  <>
                    {" "}
                    Metrics: see <b>&quot;{rec.relevantMetrics.fredIndustryGroupLabel}&quot;</b> in Industry
                    Groups.
                  </>
                )}
                {rec.relevantMetrics.fmpSectorName && (
                  <>
                    {" "}
                    Fundamentals: see <b>&quot;{rec.relevantMetrics.fmpSectorName}&quot;</b> in Sector
                    Fundamentals.
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
