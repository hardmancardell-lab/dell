"use client";

import type { FundType } from "@/lib/agents/retirement/retirement-math";
import { barPercent } from "@/lib/chart/svg-math";

/**
 * Two small charts for the 401(k) plan analyzer, drawn in the app's theme
 * variables. Neither colors anything "good" or "bad": cost bars use one
 * neutral tone plus one accent for target-date funds, so the picture shows
 * what the plan lists and does not steer the user toward a pick.
 */

const fmtUsd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export interface CostBarRow {
  id: string;
  name: string;
  pct: number;
  type: FundType;
}

export function CostBars({ rows }: { rows: CostBarRow[] }) {
  // Funds without a usable cost are left out rather than drawn as NaN-width bars; a zero cost draws a zero-length bar.
  const usable = rows.filter((r) => Number.isFinite(r.pct) && r.pct >= 0);
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => b.pct - a.pct);
  const max = Math.max(...sorted.map((r) => r.pct), 0.0001);
  return (
    <div role="img" aria-label="Yearly cost of each fund, as a percent" className="flex flex-col gap-2">
      {sorted.map((r) => {
        const isTarget = r.type === "target_date_index" || r.type === "target_date_active";
        return (
          <div key={r.id}>
            <div className="flex justify-between gap-3 text-xs" style={{ color: "var(--text-1)" }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{r.name || "Unnamed fund"}</span>
              <span className="jv-num" style={{ color: "var(--text-0)", whiteSpace: "nowrap" }}>
                {r.pct.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}% &middot; ${(r.pct * 10).toFixed(2)} per $1,000
              </span>
            </div>
            <div style={{ height: 8, background: "var(--ink-800)", border: "1px solid var(--line)", borderRadius: 2 }}>
              <div
                style={{
                  // Bars start at zero and their length is proportional to the cost: 0% is an empty bar, not a sliver.
                  width: `${barPercent(r.pct, max)}%`,
                  height: "100%",
                  background: isTarget ? "var(--signal)" : "var(--text-2)",
                  borderRadius: 1,
                }}
              />
            </div>
          </div>
        );
      })}
      <div className="flex gap-4 text-xs" style={{ color: "var(--text-2)" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--signal)", marginRight: 6 }} />Target-date fund</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--text-2)", marginRight: 6 }} />Other funds</span>
      </div>
    </div>
  );
}

export function FeeDragChart({
  a,
  b,
  labelA,
  labelB,
}: {
  a: number[];
  b: number[];
  labelA: string;
  labelB: string;
}) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  // A series with a missing or non-finite value cannot be drawn honestly: show nothing rather than NaN paths.
  if (![...a.slice(0, n), ...b.slice(0, n)].every((v) => Number.isFinite(v))) return null;
  const W = 420;
  const H = 230;
  const L = 14;
  const R = 66; // room on the right for the end-value labels, so they never sit on a line
  const T = 26;
  const B = 34;
  const maxV = Math.max(...a.slice(0, n), ...b.slice(0, n), 1);
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxV) * (H - T - B);
  const path = (s: number[]) => s.slice(0, n).map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = n - 1;
  const mid = Math.floor(last / 2);
  // Push the two end labels apart when the lines finish close together, so they never overlap.
  const yA = y(a[last]);
  const yB = y(b[last]);
  const nudge = Math.abs(yA - yB) < 14 ? (14 - Math.abs(yA - yB)) / 2 : 0;
  const labelYA = yA <= yB ? yA - nudge : yA + nudge;
  const labelYB = yA <= yB ? yB + nudge : yB - nudge;
  const area = `${path(a)} L${x(last).toFixed(1)},${y(b[last]).toFixed(1)} ${b
    .slice(0, n)
    .map((v, i) => `L${x(last - i).toFixed(1)},${y(b[last - i]).toFixed(1)}`)
    .join(" ")} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Projected balance over ${last} years at two yearly costs`} style={{ maxWidth: 560 }}>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--line)" />
      <path d={area} fill="var(--verdict)" opacity={0.12} />
      <path d={path(a)} fill="none" stroke="var(--signal)" strokeWidth={2} />
      <path d={path(b)} fill="none" stroke="var(--verdict)" strokeWidth={2} strokeDasharray="5 3" />
      <circle cx={x(last)} cy={y(a[last])} r={3.5} fill="var(--signal)" />
      <circle cx={x(last)} cy={y(b[last])} r={3.5} fill="var(--verdict)" />
      <text x={x(last) + 8} y={labelYA + 4} textAnchor="start" fontSize={11} fill="var(--signal)">{fmtUsd(a[last])}</text>
      <text x={x(last) + 8} y={labelYB + 4} textAnchor="start" fontSize={11} fill="var(--verdict)">{fmtUsd(b[last])}</text>
      <text x={L} y={H - 14} fontSize={10} fill="var(--text-2)">Today</text>
      <text x={x(mid)} y={H - 14} fontSize={10} fill="var(--text-2)" textAnchor="middle">Year {mid}</text>
      <text x={W - R} y={H - 14} fontSize={10} fill="var(--text-2)" textAnchor="end">Year {last}</text>
      <line x1={L} x2={L + 22} y1={12} y2={12} stroke="var(--signal)" strokeWidth={2} />
      <text x={L + 28} y={15} fontSize={10} fill="var(--text-1)">{labelA}</text>
      <line x1={W / 2} x2={W / 2 + 22} y1={12} y2={12} stroke="var(--verdict)" strokeWidth={2} strokeDasharray="5 3" />
      <text x={W / 2 + 28} y={15} fontSize={10} fill="var(--text-1)">{labelB}</text>
    </svg>
  );
}
