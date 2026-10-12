"use client";

import type { ChartPoint, Phase } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import { PHASE_NAMES } from "@/lib/agents/research-agent/skills/lifecycle-phase";
import type { Rating, RatingBands } from "@/lib/agents/research-agent/skills/valuation-rating";
import { RATING_ORDER } from "@/lib/agents/research-agent/skills/valuation-rating";

/**
 * Charts for the business-phase page, drawn in the app's theme variables.
 * Revenue and the profit lines share one axis so their gaps are honest.
 */

const fmtB = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(1)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B` : `${(a / 1e6).toFixed(0)}M`;
  return `${v < 0 ? "-" : ""}$${s}`;
};

/** Round-number tick positions between lo and hi (inclusive of the nearest nice bounds). */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const rough = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.5; v += step) out.push(v);
  return out;
}

export type SeriesKey = "revenue" | "operatingProfit" | "netIncome" | "freeCashFlow";

const SERIES: { key: SeriesKey; label: string; color: string; dash?: string; width: number }[] = [
  { key: "revenue", label: "Revenue", color: "var(--text-1)", width: 2 },
  { key: "operatingProfit", label: "Operating profit", color: "var(--signal)", width: 3.5 },
  { key: "netIncome", label: "Net income", color: "var(--verdict)", dash: "6 4", width: 2 },
  { key: "freeCashFlow", label: "Free cash flow", color: "var(--text-2)", dash: "2 4", width: 2.4 },
];

export const SERIES_LABELS = Object.fromEntries(SERIES.map((s) => [s.key, s.label])) as Record<SeriesKey, string>;

export function RevenueProfitChart({ points, visible, emphasize }: { points: ChartPoint[]; visible: Record<SeriesKey, boolean>; emphasize: SeriesKey }) {
  if (points.length < 2) return null;
  const W = 640;
  const H = 300;
  const L = 58;
  const R = 78;
  const T = 16;
  const B = 34;
  const shown = SERIES.filter((s) => visible[s.key]);
  const vals = points.flatMap((p) => shown.map((s) => p[s.key]).filter((v): v is number => v !== null));
  const hi = Math.max(...vals, 1);
  const lo = Math.min(0, ...vals);
  const ticks = niceTicks(lo, hi);
  const top = ticks[ticks.length - 1];
  const bottom = ticks[0];
  const x = (i: number) => L + (i / (points.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - bottom) / (top - bottom || 1)) * (H - T - B);
  const pathFor = (key: SeriesKey) => {
    let d = "";
    points.forEach((p, i) => {
      const v = p[key];
      if (v === null) return;
      d += `${d === "" || points[i - 1]?.[key] == null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    });
    return d.trim();
  };
  // End labels, nudged apart so they never overlap.
  const lastIdx = points.length - 1;
  const ends = shown
    .map((s) => ({ s, v: points[lastIdx][s.key] }))
    .filter((e): e is { s: (typeof SERIES)[number]; v: number } => e.v !== null)
    .sort((a, b) => y(a.v) - y(b.v));
  const labelY: number[] = [];
  ends.forEach((e, i) => {
    let ly = y(e.v);
    if (i > 0 && ly - labelY[i - 1] < 16) ly = labelY[i - 1] + 16;
    labelY.push(ly);
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Revenue and profit by year on one chart" style={{ maxWidth: 760 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 0 ? 1.2 : 0.6} opacity={t === 0 ? 1 : 0.6} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-2)">{fmtB(t)}</text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={p.label} x={x(i)} y={H - 12} textAnchor="middle" fontSize={10} fill={p.isTtm ? "var(--text-0)" : "var(--text-2)"} fontWeight={p.isTtm ? 600 : 400}>
          {p.label}
        </text>
      ))}
      {shown.map((s) => (
        <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={s.key === emphasize ? s.width + 1 : s.width} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {shown.map((s) =>
        points.map((p, i) => {
          const v = p[s.key];
          if (v === null) return null;
          return (
            <circle key={`${s.key}${i}`} cx={x(i)} cy={y(v)} r={p.isTtm ? 4.5 : 3} fill={p.isTtm ? "var(--ink-900)" : s.color} stroke={s.color} strokeWidth={p.isTtm ? 2 : 0}>
              <title>{`${s.label}, ${p.label}${p.isTtm ? " (last twelve months)" : ""}: ${fmtB(v)}`}</title>
            </circle>
          );
        })
      )}
      {ends.map((e, i) => (
        <text key={e.s.key} x={x(lastIdx) + 10} y={labelY[i] + 4} fontSize={10.5} fill={e.s.color} fontWeight={e.s.key === emphasize ? 700 : 500}>
          {fmtB(e.v)}
        </text>
      ))}
    </svg>
  );
}

export function SeriesLegend({ visible, onToggle, emphasize }: { visible: Record<SeriesKey, boolean>; onToggle: (k: SeriesKey) => void; emphasize: SeriesKey }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Lines to show">
      {SERIES.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onToggle(s.key)}
          aria-pressed={visible[s.key]}
          className="text-xs"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 4, cursor: "pointer",
            background: visible[s.key] ? "var(--ink-800)" : "transparent", border: `1px solid ${visible[s.key] ? s.color : "var(--line)"}`,
            color: visible[s.key] ? "var(--text-0)" : "var(--text-2)",
          }}
        >
          <svg width="26" height="8" aria-hidden="true">
            <line x1="1" x2="25" y1="4" y2="4" stroke={s.color} strokeWidth={s.key === emphasize ? 4 : 2.4} strokeDasharray={s.dash} />
          </svg>
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- phase ladder

export function PhaseLadder({ phase, valuedAs }: { phase: Phase | null; valuedAs: Phase | null }) {
  const phases: Phase[] = [1, 2, 3, 4, 5];
  return (
    <ol className="flex flex-wrap gap-2" aria-label="The five business phases" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {phases.map((p) => {
        const active = p === phase;
        const valued = p === valuedAs && valuedAs !== phase;
        return (
          <li
            key={p}
            style={{
              flex: "1 1 120px", minWidth: 110, padding: "10px 12px", borderRadius: 4,
              border: `1px solid ${active ? "var(--signal)" : valued ? "var(--verdict)" : "var(--line)"}`,
              background: active ? "rgba(79, 232, 208, 0.08)" : "var(--ink-800)",
            }}
            aria-current={active ? "step" : undefined}
          >
            <div className="text-xs" style={{ color: active ? "var(--signal)" : "var(--text-2)", letterSpacing: "0.06em" }}>PHASE {p}</div>
            <div className="text-sm font-medium" style={{ color: active ? "var(--text-0)" : "var(--text-1)" }}>{PHASE_NAMES[p]}</div>
            {active && <div className="text-xs" style={{ color: "var(--signal)" }}>Where it is now</div>}
            {valued && <div className="text-xs" style={{ color: "var(--verdict)" }}>Valued as this (your choice)</div>}
          </li>
        );
      })}
    </ol>
  );
}

// --------------------------------------------------------------- rating gauge

const RATING_COLOR: Record<Rating, string> = {
  "very expensive": "var(--danger)",
  expensive: "#e8a063",
  "fair value": "var(--text-2)",
  attractive: "#6fd6b8",
  "very attractive": "var(--signal)",
};

export function ratingColor(r: Rating): string {
  return RATING_COLOR[r];
}

/**
 * The five bands laid out on one scale, widest range on the left (most
 * expensive), with a marker where today's average premium to the past-year
 * average falls. Band edges come from the same constants the rating uses.
 */
export function RatingGauge({ premiumPct, bands, headline }: { premiumPct: number | null; bands: RatingBands; headline: Rating | null }) {
  const edges = [bands.veryExpensivePct + 15, bands.veryExpensivePct, bands.expensivePct, bands.attractivePct, bands.veryAttractivePct, bands.veryAttractivePct - 15];
  const hi = edges[0];
  const lo = edges[edges.length - 1];
  const W = 640;
  const L = 8;
  const R = 8;
  const x = (p: number) => L + ((hi - Math.min(hi, Math.max(lo, p))) / (hi - lo)) * (W - L - R);
  return (
    <svg viewBox={`0 0 ${W} 86`} width="100%" role="img" aria-label={headline ? `Rating: ${headline}` : "Rating not available"} style={{ maxWidth: 760 }}>
      {RATING_ORDER.map((r, i) => (
        <g key={r}>
          <rect x={x(edges[i])} y={26} width={x(edges[i + 1]) - x(edges[i]) - 2} height={22} fill={RATING_COLOR[r]} opacity={headline === r ? 0.95 : 0.28} rx={2} />
          <text x={(x(edges[i]) + x(edges[i + 1])) / 2 - 1} y={65} textAnchor="middle" fontSize={10.5} fill={headline === r ? "var(--text-0)" : "var(--text-2)"} fontWeight={headline === r ? 700 : 400}>
            {r}
          </text>
        </g>
      ))}
      {[bands.veryExpensivePct, bands.expensivePct, bands.attractivePct, bands.veryAttractivePct].map((e) => (
        <text key={e} x={x(e) - 1} y={78} textAnchor="middle" fontSize={9} fill="var(--text-2)">{e > 0 ? `+${e}%` : `${e}%`}</text>
      ))}
      {premiumPct !== null && (
        <g>
          <path d={`M${x(premiumPct)},52 l-6,-10 l12,0 z`} fill="var(--text-0)" />
          {/* The label hugs the marker but is pulled inward near either edge so it is never clipped. */}
          <text x={Math.min(W - R, Math.max(L, x(premiumPct) + (x(premiumPct) > W * 0.7 ? 14 : x(premiumPct) < W * 0.3 ? -14 : 0)))} y={16} textAnchor={x(premiumPct) > W * 0.7 ? "end" : x(premiumPct) < W * 0.3 ? "start" : "middle"} fontSize={11} fill="var(--text-0)" fontWeight={600}>
            {premiumPct > 0 ? "+" : ""}{premiumPct.toFixed(0)}% vs its past-year average
          </text>
        </g>
      )}
    </svg>
  );
}

// ------------------------------------------------------------ value-by-growth

export function ValueCurveChart({ curve, price, impliedGrowth }: { curve: { growthPct: number; valuePerShare: number | null }[]; price: number; impliedGrowth: number | null }) {
  const pts = curve.filter((c): c is { growthPct: number; valuePerShare: number } => c.valuePerShare !== null);
  if (pts.length < 2) return null;
  const W = 640;
  const H = 260;
  const L = 56;
  const R = 20;
  const T = 18;
  const B = 36;
  const gx0 = pts[0].growthPct;
  const gx1 = pts[pts.length - 1].growthPct;
  const vmax = Math.max(...pts.map((p) => p.valuePerShare), price) * 1.05;
  const vmin = Math.min(0, ...pts.map((p) => p.valuePerShare));
  const x = (g: number) => L + ((g - gx0) / (gx1 - gx0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - vmin) / (vmax - vmin)) * (H - T - B);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.growthPct).toFixed(1)},${y(p.valuePerShare).toFixed(1)}`).join(" ");
  const yt = niceTicks(vmin, vmax, 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="What one share is worth under different yearly growth rates, against today's price" style={{ maxWidth: 760 }}>
      {yt.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={0.6} opacity={0.6} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-2)">${Math.round(t)}</text>
        </g>
      ))}
      {pts.filter((_, i) => i % 2 === 0 || pts.length < 9).map((p, i) => (
        // The first tick sits in the corner beside the axis labels, so it is left-aligned instead of centred on its tick.
        <text key={p.growthPct} x={i === 0 ? x(p.growthPct) + 2 : x(p.growthPct)} y={H - 22} textAnchor={i === 0 ? "start" : "middle"} fontSize={10} fill="var(--text-2)">{p.growthPct}%</text>
      ))}
      <text x={(L + W - R) / 2} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--text-2)">Yearly cash-flow growth assumed</text>
      <line x1={L} x2={W - R} y1={y(price)} y2={y(price)} stroke="var(--verdict)" strokeWidth={1.6} strokeDasharray="5 3" />
      <text x={W - R} y={y(price) - 6} textAnchor="end" fontSize={10.5} fill="var(--verdict)" fontWeight={600}>Today&apos;s price ${price.toFixed(2)}</text>
      <path d={d} fill="none" stroke="var(--signal)" strokeWidth={2.6} strokeLinejoin="round" />
      {impliedGrowth !== null && impliedGrowth >= gx0 && impliedGrowth <= gx1 && (
        <g>
          <line x1={x(impliedGrowth)} x2={x(impliedGrowth)} y1={y(price)} y2={H - B} stroke="var(--text-0)" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={x(impliedGrowth)} cy={y(price)} r={5} fill="var(--text-0)" />
          <text x={x(impliedGrowth) + 8} y={y(price) + 18} fontSize={11} fill="var(--text-0)" fontWeight={600}>The price assumes about {impliedGrowth.toFixed(1)}% a year</text>
        </g>
      )}
    </svg>
  );
}
