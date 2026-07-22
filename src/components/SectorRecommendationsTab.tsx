"use client";

import { useEffect, useState } from "react";
import type { SectorRecommendation } from "@/lib/agents/research-agent/types";

const READ_STYLES: Record<SectorRecommendation["overallRead"], string> = {
  constructive: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  cautious: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
  mixed: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function ReadBadge({ read }: { read: SectorRecommendation["overallRead"] }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${READ_STYLES[read]}`}>
      {read}
    </span>
  );
}

function TrendIcon({ trend, isFavorable }: { trend: string; isFavorable: boolean | null }) {
  const arrow = trend === "rising" ? "↑" : trend === "falling" ? "↓" : "→";
  const color =
    isFavorable === null
      ? "text-zinc-400"
      : isFavorable
        ? "text-green-600 dark:text-green-400"
        : "text-red-600 dark:text-red-400";
  return <span className={`font-mono font-bold ${color}`}>{arrow}</span>;
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

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        Live macro indicator readings mapped to each industry&apos;s primary
        drivers, with a simple favorable/unfavorable trend count &mdash; a
        screening signal, not a forecast. Pair with the written analysis and
        the metrics pointers below each card.
      </p>

      {loading && <div className="text-sm text-zinc-500">Loading live indicator readings…</div>}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {data.map((rec) => (
            <div
              key={rec.industryId}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">{rec.industryName}</h3>
                <ReadBadge read={rec.overallRead} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {rec.signals.map((s) => (
                  <div
                    key={s.indicatorId}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2"
                  >
                    <div>
                      <div className="text-xs font-medium">{s.label}</div>
                      <div className="text-xs text-zinc-500">
                        {s.latestValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} {s.unit}
                        {s.latestDate ? ` (${s.latestDate})` : ""}
                      </div>
                    </div>
                    <TrendIcon trend={s.trend} isFavorable={s.isFavorable} />
                  </div>
                ))}
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-3">
                {rec.analysis}
              </p>

              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 mb-3">
                <div className="text-xs font-medium mb-1">
                  Macro linkage &mdash; stance: {rec.macroLinkage.stanceLabel}
                </div>
                <div className="text-xs text-zinc-400 mb-1">
                  Affected by: {rec.macroLinkage.affectedBy.join(", ")}
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {rec.macroLinkage.rationale}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Obstacles</div>
                  <ul className="text-xs text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-0.5">
                    {rec.obstacles.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Opportunities</div>
                  <ul className="text-xs text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-0.5">
                    {rec.opportunities.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="text-xs text-zinc-400 flex flex-wrap gap-3">
                <span>
                  {rec.favorableCount} favorable / {rec.unfavorableCount} unfavorable of {rec.signals.length} tracked
                </span>
                {rec.relevantMetrics.fredIndustryGroupLabel && (
                  <span>
                    Metrics: see &quot;{rec.relevantMetrics.fredIndustryGroupLabel}&quot; in Industry Groups sub-tab
                  </span>
                )}
                {rec.relevantMetrics.fmpSectorName && (
                  <span>
                    Fundamentals: see &quot;{rec.relevantMetrics.fmpSectorName}&quot; in Sector Fundamentals sub-tab
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
