"use client";

import { useEffect, useState } from "react";
import type { BarAdjustment } from "@/lib/data/market-data-types";
import { describeAdjustment, describeFeed, formatAge, type ChartBarsMeta } from "@/lib/chart/meta";
import { formatBarLabel, formatClock, formatDay, ZONE_LABEL, type ChartZone } from "@/lib/chart/timeformat";
import { ToggleGroup } from "./ToggleGroup";

const ADJUSTMENT_OPTIONS = [
  { value: "split" as const, label: "Split-adj.", title: "Prices back-adjusted for stock splits (the default: a split is not a crash)" },
  { value: "all" as const, label: "Split + div.", title: "Back-adjusted for splits and dividends (total-return style; older prices come out lower than they traded)" },
  { value: "raw" as const, label: "Unadjusted", title: "Prices exactly as traded; a split shows as a jump" },
];

/** Re-renders every `everyMs` so "5 min ago" stays true while the page stays open. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * The honest-labelling strip above the chart: where the bars came from, whether prices are adjusted, when the newest bar
 * ended, and a DELAYED badge when the data is flagged (or, for a live market, looks) behind. Nothing here is invented:
 * a field the provider did not state reads "not stated".
 */
export function ChartHeader({
  meta,
  zone,
  intraday,
  adjustable,
  adjustment,
  onAdjustmentChange,
  loading,
}: {
  meta: ChartBarsMeta | null;
  zone: ChartZone;
  intraday: boolean;
  /** True for equities and ETFs (Alpaca): the only data that has an adjustment choice. */
  adjustable: boolean;
  adjustment: BarAdjustment;
  onAdjustmentChange: (a: BarAdjustment) => void;
  loading: boolean;
}) {
  const now = useNow(30_000);
  const feed = describeFeed(meta?.feed);
  const asOfSec = meta?.asOf != null ? Math.floor(meta.asOf / 1000) : null;
  const asOfText =
    asOfSec === null
      ? "no bars"
      : intraday
        ? `${formatDay(asOfSec, zone)} ${formatClock(asOfSec, zone)} ${ZONE_LABEL[zone]}`
        : `Last ${meta && meta.barMs >= 7 * 86_400_000 ? "weekly" : "daily"} bar ${formatBarLabel(asOfSec - Math.round((meta?.barMs ?? 0) / 1000), zone, false)}`;
  // Daily and longer bars are dated by their open, so an age would read as "a day old" for the current day's bar.
  const age = intraday && meta?.asOf != null ? formatAge(now - meta.asOf) : null;
  const delayed = meta?.delayed === true;

  return (
    <div className="mb-2" data-testid="chart-header">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" style={{ color: "var(--text-1)" }}>
        {adjustable ? (
          <ToggleGroup label="Prices" name="adjustment" value={adjustment} options={ADJUSTMENT_OPTIONS} onChange={onAdjustmentChange} />
        ) : (
          <span data-testid="adjustment-na">
            <span style={{ color: "var(--text-2)" }}>Prices </span>
            {describeAdjustment(null)}
          </span>
        )}
        <span data-testid="chart-source">
          <span style={{ color: "var(--text-2)" }}>Source </span>
          {meta?.provider ?? (loading ? "loading" : "not stated")}
          {meta ? `, ${feed.short}` : ""}
        </span>
        <span data-testid="chart-asof">
          <span style={{ color: "var(--text-2)" }}>{intraday ? "As of " : ""}</span>
          {asOfText}
          {age ? ` (${age})` : ""}
        </span>
        <span data-testid="chart-zone">
          <span style={{ color: "var(--text-2)" }}>Times </span>
          {ZONE_LABEL[zone]}
        </span>
        {delayed && (
          <span
            role="status"
            data-testid="delayed-badge"
            className="jv-badge"
            style={{ color: "var(--verdict)", borderColor: "var(--verdict)" }}
            title={
              meta?.delayedSource === "provider"
                ? "The data provider flagged these bars as delayed."
                : "The newest bar is older than expected while this market is open (derived from the bar time; a holiday can cause this)."
            }
          >
            {meta?.delayedSource === "provider" ? "Delayed" : "Possibly delayed"}
          </span>
        )}
        {meta?.synthetic && (
          <span role="status" data-testid="synthetic-badge" className="jv-badge c-danger">
            Synthetic data
          </span>
        )}
      </div>
      {meta && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }} data-testid="chart-feed-note">
          {adjustable ? `${describeAdjustment(meta.adjustment)}. ` : ""}
          Volume: {feed.volumeNote}.
        </p>
      )}
    </div>
  );
}
