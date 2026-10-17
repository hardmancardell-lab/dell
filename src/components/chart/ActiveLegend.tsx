"use client";

import { indicatorDef } from "@/lib/chart/indicators";
import { volumeLegendLabel } from "@/lib/chart/meta";
import { SMA_COLORS, VOLUME_BAR } from "@/lib/design/tokens";
import type { BarAdjustment } from "@/lib/data/market-data-types";

/**
 * One line per thing drawn on the chart that is not obvious from the candles: the volume bars (with their source and
 * unit), the moving averages, and every active indicator. An indicator that is a model or an approximation carries an
 * "estimate" tag whose title says why, so a line on the chart is never read as advice or as measured data.
 */
export function ActiveLegend({
  feed,
  adjustment,
  showSma20,
  showSma50,
  activeIds,
}: {
  feed: string | null;
  adjustment: BarAdjustment | null;
  showSma20: boolean;
  showSma50: boolean;
  activeIds: readonly string[];
}) {
  const items = activeIds.map(indicatorDef).filter((d): d is NonNullable<ReturnType<typeof indicatorDef>> => Boolean(d));
  return (
    <ul className="mt-2 space-y-1 text-[11px]" style={{ color: "var(--text-1)" }} aria-label="Chart legend" data-testid="chart-legend">
      <li className="flex items-center gap-2" data-testid="legend-volume">
        <span aria-hidden className="inline-block w-2.5 h-2.5" style={{ background: VOLUME_BAR.up }} />
        <span>{volumeLegendLabel(feed, adjustment)}</span>
      </li>
      {showSma20 && (
        <li className="flex items-center gap-2">
          <span aria-hidden className="inline-block w-2.5 h-0.5" style={{ background: SMA_COLORS.sma20 }} />
          <span>SMA 20: 20-bar simple moving average of the close</span>
        </li>
      )}
      {showSma50 && (
        <li className="flex items-center gap-2">
          <span aria-hidden className="inline-block w-2.5 h-0.5" style={{ background: SMA_COLORS.sma50 }} />
          <span>SMA 50: 50-bar simple moving average of the close</span>
        </li>
      )}
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-2" data-testid={`legend-${d.id}`}>
          <span aria-hidden className="inline-block w-2.5 h-0.5" style={{ background: d.color }} />
          <span>
            {d.label}: {d.description}
          </span>
          {d.estimate && (
            <span className="jv-badge c-neutral" title={d.estimate} style={{ padding: "1px 6px" }}>
              estimate
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
