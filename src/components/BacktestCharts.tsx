"use client";

import { useMemo, useState } from "react";

/**
 * Visual layer for backtest results, one chart per analytical question —
 * not one chart type reused everywhere:
 *   Edge?            -> forest plot (mean + CI vs. a zero line)
 *   Holds up?        -> paired dumbbell (train vs. test mean per horizon)
 *   Shape / tails?   -> histogram with mean + median markers
 *   Path / risk?     -> equity curve with an underwater (drawdown) panel
 *   How fast?        -> cumulative reversion curve (ECDF)
 *   Do stops help?   -> diverging heat map (stop level x horizon)
 * Pure SVG, themed through the .jarvis CSS variables (no chart dependency).
 */

export interface ChartHorizon {
  label: string;
  n: number;
  mean: number | null;
  median: number | null;
  ciLo: number | null;
  ciHi: number | null;
  passes: boolean;
  train: number | null;
  test: number | null;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number | null;
  largestLossPct: number | null;
}

export interface ChartTrade {
  date: string; // YYYY-MM-DD
  returns: Record<string, number | null>; // raw price return % keyed by horizon label
}

export interface OverlayCell {
  v: number | null;
  sub?: string;
}
export interface OverlayRow {
  label: string;
  cells: (OverlayCell | null)[];
}

const C = {
  signal: "var(--signal)",
  danger: "var(--danger)",
  verdict: "var(--verdict)",
  line: "var(--line)",
  lineB: "var(--line-bright)",
  t0: "var(--text-0)",
  t1: "var(--text-1)",
  t2: "var(--text-2)",
  mono: "var(--font-mono)",
};

const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

function niceStep(range: number, target: number): number {
  const raw = (range || 1) / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

function niceTicks(min: number, max: number, target = 6): number[] {
  const step = niceStep(max - min, target);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function ChartCard({
  eyebrow,
  title,
  how,
  takeaway,
  tip,
  controls,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  how: string;
  takeaway?: string | null;
  tip?: string | null;
  controls?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`jv-card ${className ?? ""}`}>
      <div className="jv-br-b" />
      <div className="jv-eyebrow" style={{ marginBottom: 4 }}>
        {eyebrow}
      </div>
      <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
        {title}
      </div>
      <p className="text-xs mt-1 mb-3" style={{ color: "var(--text-2)" }}>
        {how}
      </p>
      {controls}
      {children}
      <div className="text-xs mt-2 font-mono" style={{ color: "var(--text-1)", minHeight: 16 }}>
        {tip ?? ""}
      </div>
      {takeaway && (
        <p className="text-xs mt-2" style={{ color: "var(--verdict)" }}>
          {takeaway}
        </p>
      )}
    </div>
  );
}

function HorizonPicker({ labels, value, onChange }: { labels: string[]; value: string; onChange: (l: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2" role="group" aria-label="Horizon">
      {labels.map((l) => (
        <button key={l} type="button" onClick={() => onChange(l)} className={value === l ? "jv-btn" : "jv-btn-outline"} style={{ padding: "3px 10px", fontSize: 12 }}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Edge: forest plot                                                       */
/* ----------------------------------------------------------------------- */

function EdgeForest({ horizons }: { horizons: ChartHorizon[] }) {
  const [tip, setTip] = useState<string | null>(null);
  const rows = horizons.filter((h) => h.mean !== null);
  const W = 420, top = 12, rowH = 38, left = 40, right = 80, axisH = 38;
  const H = top + rows.length * rowH + axisH;
  const vals = rows.flatMap((h) => [h.ciLo ?? h.mean ?? 0, h.ciHi ?? h.mean ?? 0, 0]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1;
  const x = (v: number) => left + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - left - right);
  const ticks = niceTicks(lo - pad, hi + pad, 5);
  const passing = rows.filter((h) => h.passes);
  const widest = rows.reduce((a, b) => ((b.ciHi ?? 0) - (b.ciLo ?? 0) > (a.ciHi ?? 0) - (a.ciLo ?? 0) ? b : a), rows[0]);
  const takeaway =
    rows.length === 0
      ? null
      : `${passing.length} of ${rows.length} horizons clear all three bars${passing.length ? ` (${passing.map((h) => h.label).join(", ")})` : ""}. Widest uncertainty: ${widest.label}.${rows.some((h) => h.n < 30) ? " n < 30 at some horizons: directional only." : ""}`;

  return (
    <ChartCard
      eyebrow="Is there an edge?"
      title="Forward return by horizon, with 95% confidence interval"
      how="Dot = mean strategy return. Line = bootstrap 95% CI. A line that crosses zero could be luck. Filled = passes all three bars (FDR-significant, same sign out-of-sample, CI excludes zero)."
      takeaway={takeaway}
      tip={tip}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Forest plot of mean forward return with confidence intervals by horizon" onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - axisH} style={{ stroke: t === 0 ? C.lineB : C.line, strokeWidth: t === 0 ? 1.5 : 1 }} />
            <text x={x(t)} y={H - axisH + 15} textAnchor="middle" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
              {t}%
            </text>
          </g>
        ))}
        <text x={(left + W - right) / 2} y={H - 6} textAnchor="middle" style={{ fill: C.t2, fontSize: 10 }}>
          mean forward return (strategy P&amp;L)
        </text>
        {rows.map((h, i) => {
          const y = top + i * rowH + rowH / 2;
          const col = h.passes ? C.signal : C.t2;
          const msg = `${h.label}: mean ${fmt(h.mean)}${h.ciLo !== null && h.ciHi !== null ? `, 95% CI [${h.ciLo.toFixed(2)}, ${h.ciHi.toFixed(2)}]` : ""}, n=${h.n}${h.passes ? ", passes all 3 bars" : ""}`;
          return (
            <g key={h.label} onMouseEnter={() => setTip(msg)} onFocus={() => setTip(msg)} tabIndex={0}>
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x={left - 8} y={y + 4} textAnchor="end" style={{ fill: C.t1, fontSize: 11, fontFamily: C.mono }}>
                {h.label}
              </text>
              {h.ciLo !== null && h.ciHi !== null && (
                <>
                  <line x1={x(h.ciLo)} x2={x(h.ciHi)} y1={y} y2={y} style={{ stroke: col, strokeWidth: 2, strokeLinecap: "round" }} />
                  <line x1={x(h.ciLo)} x2={x(h.ciLo)} y1={y - 5} y2={y + 5} style={{ stroke: col, strokeWidth: 2 }} />
                  <line x1={x(h.ciHi)} x2={x(h.ciHi)} y1={y - 5} y2={y + 5} style={{ stroke: col, strokeWidth: 2 }} />
                </>
              )}
              <circle cx={x(h.mean as number)} cy={y} r={h.passes ? 5.5 : 4.5} style={h.passes ? { fill: C.signal } : { fill: "var(--ink-900)", stroke: C.t2, strokeWidth: 1.6 }} />
              <text x={W - right + 10} y={y - 1} style={{ fill: C.t0, fontSize: 11, fontFamily: C.mono }}>
                {fmt(h.mean, 2)}
              </text>
              <text x={W - right + 10} y={y + 11} style={{ fill: C.t2, fontSize: 9, fontFamily: C.mono }}>
                n={h.n}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

/* ----------------------------------------------------------------------- */
/* Holds up?: train vs. test dumbbell                                      */
/* ----------------------------------------------------------------------- */

function OosDumbbell({ horizons }: { horizons: ChartHorizon[] }) {
  const [tip, setTip] = useState<string | null>(null);
  const rows = horizons.filter((h) => h.train !== null && h.test !== null);
  const W = 420, top = 12, rowH = 38, left = 40, right = 80, axisH = 38;
  const H = top + rows.length * rowH + axisH;
  const vals = rows.flatMap((h) => [h.train as number, h.test as number, 0]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const x = (v: number) => left + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - left - right);
  const ticks = niceTicks(lo - pad, hi + pad, 5);
  const flips = rows.filter((h) => Math.sign(h.train as number) !== Math.sign(h.test as number));
  const takeaway = rows.length === 0 ? null : flips.length ? `Out-of-sample sign flips at ${flips.map((h) => h.label).join(", ")}: the in-sample result there may not hold.` : "Train and test agree in sign at every horizon.";

  return (
    <ChartCard
      eyebrow="Does it hold up?"
      title="Earlier 75% vs. later 25% of occurrences"
      how="Each pair is the mean return in the training slice and the held-out later slice. Close together and on the same side of zero = stable. A rose line means the sign flipped."
      takeaway={takeaway}
      tip={tip}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Paired dot chart of training and test mean return by horizon" onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={H - axisH} style={{ stroke: t === 0 ? C.lineB : C.line, strokeWidth: t === 0 ? 1.5 : 1 }} />
            <text x={x(t)} y={H - axisH + 15} textAnchor="middle" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
              {t}%
            </text>
          </g>
        ))}
        {rows.map((h, i) => {
          const y = top + i * rowH + rowH / 2;
          const flip = Math.sign(h.train as number) !== Math.sign(h.test as number);
          const msg = `${h.label}: train ${fmt(h.train)} vs test ${fmt(h.test)}${flip ? " (sign flips)" : ""}`;
          return (
            <g key={h.label} onMouseEnter={() => setTip(msg)} onFocus={() => setTip(msg)} tabIndex={0}>
              <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill="transparent" />
              <text x={left - 8} y={y + 4} textAnchor="end" style={{ fill: C.t1, fontSize: 11, fontFamily: C.mono }}>
                {h.label}
              </text>
              <line x1={x(h.train as number)} x2={x(h.test as number)} y1={y} y2={y} style={{ stroke: flip ? C.danger : C.lineB, strokeWidth: 2.5, strokeLinecap: "round" }} />
              <circle cx={x(h.train as number)} cy={y} r={5} style={{ fill: C.t1 }} />
              <circle cx={x(h.test as number)} cy={y} r={5} style={{ fill: C.verdict }} />
              {flip && (
                <text x={W - right + 10} y={y + 4} style={{ fill: C.danger, fontSize: 10, fontFamily: C.mono }}>
                  sign flips
                </text>
              )}
            </g>
          );
        })}
        <g transform={`translate(${left}, ${H - 8})`}>
          <circle cx={4} cy={-3} r={4} style={{ fill: C.t1 }} />
          <text x={12} y={0} style={{ fill: C.t2, fontSize: 10 }}>
            train (earlier 75%)
          </text>
          <circle cx={130} cy={-3} r={4} style={{ fill: C.verdict }} />
          <text x={138} y={0} style={{ fill: C.t2, fontSize: 10 }}>
            test (later 25%)
          </text>
        </g>
      </svg>
    </ChartCard>
  );
}

/* ----------------------------------------------------------------------- */
/* Shape / tails: histogram                                                */
/* ----------------------------------------------------------------------- */

function stratReturns(trades: ChartTrade[], label: string, isShort: boolean) {
  return trades
    .filter((t) => t.returns[label] !== null && t.returns[label] !== undefined)
    .map((t) => ({ date: t.date, r: (isShort ? -1 : 1) * (t.returns[label] as number) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function ReturnHistogram({ trades, labels, isShort }: { trades: ChartTrade[]; labels: string[]; isShort: boolean }) {
  const [label, setLabel] = useState(labels[labels.length - 1]);
  const [tip, setTip] = useState<string | null>(null);
  const data = useMemo(() => stratReturns(trades, label, isShort).map((d) => d.r), [trades, label, isShort]);

  const W = 420, H = 250, left = 34, right = 10, top = 24, axisH = 34;
  let body: React.ReactNode = <p className="text-xs" style={{ color: "var(--text-2)" }}>Not enough occurrences at this horizon.</p>;
  let takeaway: string | null = null;

  if (data.length >= 5) {
    const mn = Math.min(...data), mx = Math.max(...data);
    const k = Math.max(6, Math.min(14, Math.round(Math.sqrt(data.length))));
    const w = niceStep(mx - mn, k);
    const e0 = Math.floor(mn / w) * w, e1 = Math.ceil(mx / w) * w;
    const nb = Math.max(1, Math.round((e1 - e0) / w));
    const counts = new Array(nb).fill(0);
    for (const v of data) counts[Math.min(nb - 1, Math.floor((v - e0) / w + 1e-9))]++;
    const cmax = Math.max(...counts);
    const x = (v: number) => left + ((v - e0) / (e1 - e0)) * (W - left - right);
    const y = (c: number) => top + (1 - c / (cmax * 1.1)) * (H - top - axisH);
    const mean = data.reduce((s, v) => s + v, 0) / data.length;
    const med = median(data);
    const sd = Math.sqrt(data.reduce((s, v) => s + (v - mean) ** 2, 0) / data.length);
    const xt = niceTicks(e0, e1, 7);
    const yt = niceTicks(0, cmax, 4).filter((t) => Number.isInteger(t));
    const losers = data.filter((v) => v <= 0).length;
    takeaway = `${Math.round((losers / data.length) * 100)}% of trades lose; worst ${fmt(mn)}, best ${fmt(mx)}.${Math.abs(mean - med) > 0.35 * sd ? " Mean and median diverge: a few large outcomes drive the average, so lean on the median." : " Mean and median agree: no single outlier is driving the result."}`;
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`Histogram of ${label} strategy returns`} onMouseLeave={() => setTip(null)}>
        {yt.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} style={{ stroke: C.line }} />
            <text x={left - 6} y={y(t) + 3} textAnchor="end" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
              {t}
            </text>
          </g>
        ))}
        {counts.map((c, i) => {
          const a = e0 + i * w;
          const b = a + w;
          const msg = `${fmt(a, 1)} to ${fmt(b, 1)}: ${c} trade${c === 1 ? "" : "s"}`;
          return (
            <g key={i} onMouseEnter={() => setTip(msg)} onFocus={() => setTip(msg)} tabIndex={0}>
              {c > 0 && <rect x={x(a) + 1} y={y(c)} width={Math.max(1, x(b) - x(a) - 2)} height={y(0) - y(c)} rx={2} style={{ fill: b <= 1e-9 ? C.danger : C.signal, opacity: 0.85 }} />}
              <rect x={x(a)} y={top} width={x(b) - x(a)} height={H - top - axisH} fill="transparent" />
            </g>
          );
        })}
        <line x1={x(0)} x2={x(0)} y1={top} y2={H - axisH} style={{ stroke: C.lineB, strokeWidth: 1.5 }} />
        <line x1={x(mean)} x2={x(mean)} y1={top - 6} y2={H - axisH} style={{ stroke: C.verdict, strokeWidth: 2 }} />
        <line x1={x(med)} x2={x(med)} y1={top - 6} y2={H - axisH} style={{ stroke: C.t0, strokeWidth: 1.5, strokeDasharray: "4 3" }} />
        <text x={x(mean) + (x(mean) >= x(med) ? 4 : -4)} y={top - 9} textAnchor={x(mean) >= x(med) ? "start" : "end"} style={{ fill: C.verdict, fontSize: 10, fontFamily: C.mono }}>
          mean {fmt(mean, 1)}
        </text>
        <text x={x(med) + (x(mean) >= x(med) ? -4 : 4)} y={top - 9} textAnchor={x(mean) >= x(med) ? "end" : "start"} style={{ fill: C.t0, fontSize: 10, fontFamily: C.mono }}>
          median {fmt(med, 1)}
        </text>
        {xt.map((t) => (
          <text key={t} x={x(t)} y={H - axisH + 15} textAnchor="middle" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
            {t}%
          </text>
        ))}
        <text x={(left + W - right) / 2} y={H - 4} textAnchor="middle" style={{ fill: C.t2, fontSize: 10 }}>
          {label} strategy return per trade (n={data.length})
        </text>
      </svg>
    );
  }

  return (
    <ChartCard
      eyebrow="What does a typical trade look like?"
      title="Distribution of per-trade returns"
      how="Each bar counts trades in a return bucket. Rose = losing buckets, teal = winners. The amber line is the mean, the dashed line the median. Fat left tails and mean/median gaps are what a single average hides."
      takeaway={takeaway}
      tip={tip}
      controls={<HorizonPicker labels={labels} value={label} onChange={setLabel} />}
    >
      {body}
    </ChartCard>
  );
}

/* ----------------------------------------------------------------------- */
/* Path / risk: equity curve + underwater                                  */
/* ----------------------------------------------------------------------- */

function EquityDrawdown({ trades, labels, isShort }: { trades: ChartTrade[]; labels: string[]; isShort: boolean }) {
  const [label, setLabel] = useState(labels[labels.length - 1]);
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(() => {
    const out: { date: string; t: number; r: number; cum: number; dd: number }[] = [];
    let eq = 1;
    let peak = 1;
    for (const d of stratReturns(trades, label, isShort)) {
      eq *= 1 + d.r / 100;
      peak = Math.max(peak, eq);
      out.push({ date: d.date, t: Date.parse(d.date), r: d.r, cum: (eq - 1) * 100, dd: (eq / peak - 1) * 100 });
    }
    return out;
  }, [trades, label, isShort]);

  const W = 760, left = 44, right = 16, eqTop = 14, eqH = 170, gap = 34, ddH = 74, axisH = 28;
  const H = eqTop + eqH + gap + ddH + axisH;
  let body: React.ReactNode = <p className="text-xs" style={{ color: "var(--text-2)" }}>Not enough occurrences at this horizon.</p>;
  let takeaway: string | null = null;

  if (series.length >= 3) {
    const t0 = series[0].t, t1 = series[series.length - 1].t;
    const x = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (W - left - right);
    const cums = series.map((s) => s.cum);
    const cLo = Math.min(0, ...cums), cHi = Math.max(0, ...cums);
    const cPad = (cHi - cLo) * 0.08 || 1;
    const yE = (v: number) => eqTop + (1 - (v - (cLo - cPad)) / (cHi - cLo + 2 * cPad)) * eqH;
    const ddMin = Math.min(...series.map((s) => s.dd), -1);
    const yD = (v: number) => eqTop + eqH + gap + (v / (ddMin * 1.1)) * ddH;
    const eTicks = niceTicks(cLo - cPad, cHi + cPad, 5);
    const dTicks = niceTicks(ddMin * 1.1, 0, 3);

    let line = `M${x(t0)} ${yE(0)}`;
    let area = `M${x(t0)} ${yD(0)}`;
    for (const s of series) {
      line += ` H${x(s.t)} V${yE(s.cum)}`;
      area += ` H${x(s.t)} V${yD(s.dd)}`;
    }
    area += ` H${x(t1)} V${yD(0)} Z`;
    const final = series[series.length - 1];
    const worst = series.reduce((a, b) => (b.dd < a.dd ? b : a), series[0]);
    const years = [...new Set(series.map((s) => s.date.slice(0, 4)))];
    const hv = hover !== null ? series[hover] : null;
    takeaway = `Compounded in order: ${fmt(final.cum, 1)} total, max drawdown ${worst.dd.toFixed(1)}% (${worst.date}). Overlapping windows make this smoother than a real account would feel.`;
    body = (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`Equity curve and drawdown for ${label} strategy returns`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const tt = t0 + ((px - left) / (W - left - right)) * (t1 - t0);
          let best = 0;
          series.forEach((s, i) => {
            if (Math.abs(s.t - tt) < Math.abs(series[best].t - tt)) best = i;
          });
          setHover(best);
        }}
      >
        {eTicks.map((t) => (
          <g key={`e${t}`}>
            <line x1={left} x2={W - right} y1={yE(t)} y2={yE(t)} style={{ stroke: t === 0 ? C.lineB : C.line, strokeWidth: t === 0 ? 1.5 : 1 }} />
            <text x={left - 6} y={yE(t) + 3} textAnchor="end" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
              {t}%
            </text>
          </g>
        ))}
        <text x={left} y={eqTop - 3} style={{ fill: C.t2, fontSize: 10 }}>cumulative return</text>
        <path d={line} fill="none" style={{ stroke: C.signal, strokeWidth: 2, strokeLinejoin: "round" }} />
        <circle cx={x(final.t)} cy={yE(final.cum)} r={4.5} style={{ fill: C.signal, stroke: "var(--ink-900)", strokeWidth: 2 }} />
        <text x={x(final.t) - 8} y={yE(final.cum) - 8} textAnchor="end" style={{ fill: C.t0, fontSize: 11, fontFamily: C.mono }}>
          {fmt(final.cum, 1)}
        </text>
        <text x={left} y={eqTop + eqH + gap - 8} style={{ fill: C.t2, fontSize: 10 }}>drawdown from peak</text>
        {dTicks.map((t) => (
          <g key={`d${t}`}>
            <line x1={left} x2={W - right} y1={yD(t)} y2={yD(t)} style={{ stroke: t === 0 ? C.lineB : C.line }} />
            <text x={left - 6} y={yD(t) + 3} textAnchor="end" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
              {t}%
            </text>
          </g>
        ))}
        <path d={area} style={{ fill: C.danger, opacity: 0.22 }} />
        <circle cx={x(worst.t)} cy={yD(worst.dd)} r={4} style={{ fill: C.danger, stroke: "var(--ink-900)", strokeWidth: 2 }} />
        {years.map((yr) => {
          const t = Math.max(t0, Date.parse(`${yr}-01-01`));
          return (
            <text key={yr} x={x(t)} y={H - 8} textAnchor="start" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
              {yr}
            </text>
          );
        })}
        {hv && (
          <g>
            <line x1={x(hv.t)} x2={x(hv.t)} y1={eqTop} y2={eqTop + eqH + gap + ddH} style={{ stroke: C.t1, strokeWidth: 1, strokeDasharray: "3 3" }} />
            <circle cx={x(hv.t)} cy={yE(hv.cum)} r={4} style={{ fill: C.t0 }} />
          </g>
        )}
      </svg>
    );
  }

  const hv = hover !== null && series[hover] ? series[hover] : null;
  return (
    <ChartCard
      className="lg:col-span-2"
      eyebrow="What does the path look like?"
      title="Equity curve and underwater plot"
      how="Top: each occurrence's return compounded in date order. Bottom: how far below its prior peak the account sits. Depth and duration of the rose area are the risk the average return doesn't show."
      takeaway={takeaway}
      tip={hv ? `${hv.date} · trade ${fmt(hv.r)} · cumulative ${fmt(hv.cum, 1)} · drawdown ${hv.dd.toFixed(1)}%` : null}
      controls={<HorizonPicker labels={labels} value={label} onChange={setLabel} />}
    >
      {body}
    </ChartCard>
  );
}

/* ----------------------------------------------------------------------- */
/* How fast: cumulative reversion curve                                    */
/* ----------------------------------------------------------------------- */

function RevertCurve({ days, maxDay, unit }: { days: (number | null)[]; maxDay: number; unit: string }) {
  const [tip, setTip] = useState<string | null>(null);
  const total = days.length;
  const reverted = days.filter((d): d is number => d !== null);
  if (total === 0) return null;
  const shown = Math.min(maxDay, Math.max(10, Math.ceil(Math.max(0, ...reverted) * 1.1)));
  const pts: number[] = [];
  for (let d = 0; d <= shown; d++) pts.push((reverted.filter((v) => v <= d).length / total) * 100);

  const W = 420, H = 250, left = 38, right = 12, top = 16, axisH = 36;
  const x = (d: number) => left + (d / shown) * (W - left - right);
  const y = (p: number) => top + (1 - p / 100) * (H - top - axisH);
  let line = `M${x(0)} ${y(pts[0])}`;
  pts.forEach((p, i) => {
    if (i) line += ` H${x(i)} V${y(p)}`;
  });
  const area = `${line} V${y(0)} H${x(0)} Z`;
  const halfDay = pts.findIndex((p) => p >= 50);
  const never = total - reverted.length;
  const xt = niceTicks(0, shown, 7);
  const takeaway = `${halfDay >= 0 ? `Half of signals revert by ${unit.replace(/s$/, "")} ${halfDay}` : `Fewer than half revert within ${shown} ${unit}`}; ${Math.round((reverted.length / total) * 100)}% revert within the ${shown} ${unit} shown${never ? `, ${never} never did in the tracked window` : ""}.`;

  return (
    <ChartCard
      eyebrow="How long until it pays off?"
      title="Share of signals that have reverted to the mean"
      how={`Curve = cumulative % of occurrences back at the mean by each ${unit.replace(/s$/, "")}. A steep early rise means fast reversion; a flat plateau is a group that lingers (or never comes back).`}
      takeaway={takeaway}
      tip={tip}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Cumulative reversion curve" onMouseLeave={() => setTip(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const d = Math.max(0, Math.min(shown, Math.round(((px - left) / (W - left - right)) * shown)));
          setTip(`${unit} ${d}: ${pts[d].toFixed(1)}% reverted (${Math.round((pts[d] / 100) * total)} of ${total})`);
        }}>
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line x1={left} x2={W - right} y1={y(p)} y2={y(p)} style={{ stroke: p === 50 ? C.lineB : C.line, strokeDasharray: p === 50 ? "4 3" : undefined }} />
            <text x={left - 6} y={y(p) + 3} textAnchor="end" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
              {p}%
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={t} x={x(t)} y={H - axisH + 15} textAnchor="middle" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
            {t}
          </text>
        ))}
        <text x={(left + W - right) / 2} y={H - 4} textAnchor="middle" style={{ fill: C.t2, fontSize: 10 }}>
          {unit} after the signal (n={total})
        </text>
        <path d={area} style={{ fill: C.signal, opacity: 0.1 }} />
        <path d={line} fill="none" style={{ stroke: C.signal, strokeWidth: 2, strokeLinejoin: "round" }} />
        {halfDay >= 0 && (
          <g>
            <line x1={x(halfDay)} x2={x(halfDay)} y1={y(50)} y2={y(0)} style={{ stroke: C.verdict, strokeWidth: 1.5 }} />
            <circle cx={x(halfDay)} cy={y(50)} r={4.5} style={{ fill: C.verdict, stroke: "var(--ink-900)", strokeWidth: 2 }} />
            <text x={x(halfDay) + 8} y={y(50) + 16} style={{ fill: C.verdict, fontSize: 10, fontFamily: C.mono }}>
              median: {unit.replace(/s$/, "")} {halfDay}
            </text>
          </g>
        )}
      </svg>
    </ChartCard>
  );
}

/* ----------------------------------------------------------------------- */
/* Do stops help: diverging heat map                                       */
/* ----------------------------------------------------------------------- */

function OverlayHeatmap({ cols, rows }: { cols: string[]; rows: OverlayRow[] }) {
  const [tip, setTip] = useState<string | null>(null);
  const all = rows.flatMap((r) => r.cells.map((c) => c?.v).filter((v): v is number => v !== null && v !== undefined));
  if (all.length === 0) return null;
  const vmax = Math.max(...all.map(Math.abs), 0.0001);
  const labelW = 150, cellW = 76, cellH = 40, top = 26, left = 4;
  const W = left + labelW + cols.length * cellW + 8, H = top + rows.length * cellH + 6;
  const best = cols.map((_, ci) => {
    let bi = -1, bv = -Infinity;
    rows.forEach((r, ri) => {
      const v = r.cells[ci]?.v;
      if (v !== null && v !== undefined && v > bv) {
        bv = v;
        bi = ri;
      }
    });
    return bi;
  });
  const baseline = rows[0];
  const helps = rows.slice(1).flatMap((r) => r.cells.map((c, ci) => (c?.v !== null && c?.v !== undefined && baseline.cells[ci]?.v !== null && baseline.cells[ci]?.v !== undefined ? (c.v as number) - (baseline.cells[ci]?.v as number) : null))).filter((v): v is number => v !== null);
  const better = helps.filter((v) => v > 0).length;
  const takeaway = `A stop beats holding in ${better} of ${helps.length} stop/horizon cells. Amber outline = best row for that horizon. Compare to the baseline row, not to zero.`;

  return (
    <ChartCard
      eyebrow="Does a stop help or hurt?"
      title="Mean return by stop rule and horizon"
      how="Rows are exit rules, columns are holding horizons. Teal = positive mean return, rose = negative, darker = larger. Small text shows how often the stop fired."
      takeaway={takeaway}
      tip={tip}
    >
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: W * 0.8, height: "auto", display: "block" }} role="img" aria-label="Heat map of mean return by stop level and horizon" onMouseLeave={() => setTip(null)}>
          {cols.map((c, ci) => (
            <text key={c} x={left + labelW + ci * cellW + cellW / 2} y={16} textAnchor="middle" style={{ fill: C.t1, fontSize: 11, fontFamily: C.mono }}>
              {c}
            </text>
          ))}
          {rows.map((r, ri) => (
            <g key={r.label}>
              <text x={left + labelW - 10} y={top + ri * cellH + cellH / 2 + 4} textAnchor="end" style={{ fill: ri === 0 ? C.t0 : C.t1, fontSize: 11 }}>
                {r.label}
              </text>
              {r.cells.map((c, ci) => {
                const v = c?.v ?? null;
                const alpha = v === null ? 0 : 0.1 + 0.55 * Math.min(1, Math.abs(v) / vmax);
                const fill = v === null ? "transparent" : v >= 0 ? `rgba(79, 232, 208, ${alpha})` : `rgba(232, 99, 122, ${alpha})`;
                const msg = v === null ? `${r.label}, ${cols[ci]}: n/a` : `${r.label}, ${cols[ci]}: mean ${fmt(v)}${c?.sub ? ` · ${c.sub}` : ""}`;
                return (
                  <g key={ci} onMouseEnter={() => setTip(msg)} onFocus={() => setTip(msg)} tabIndex={0}>
                    <rect x={left + labelW + ci * cellW + 2} y={top + ri * cellH + 2} width={cellW - 4} height={cellH - 4} rx={4} style={{ fill, stroke: best[ci] === ri ? C.verdict : "transparent", strokeWidth: 1.5 }} />
                    <text x={left + labelW + ci * cellW + cellW / 2} y={top + ri * cellH + cellH / 2 + (c?.sub ? 1 : 4)} textAnchor="middle" style={{ fill: C.t0, fontSize: 12, fontFamily: C.mono }}>
                      {v === null ? "–" : fmt(v, 1)}
                    </text>
                    {c?.sub && (
                      <text x={left + labelW + ci * cellW + cellW / 2} y={top + ri * cellH + cellH / 2 + 13} textAnchor="middle" style={{ fill: C.t1, fontSize: 9, fontFamily: C.mono }}>
                        {c.sub}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </ChartCard>
  );
}

/* ----------------------------------------------------------------------- */
/* Verdict strip + composed panel                                          */
/* ----------------------------------------------------------------------- */

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? C.signal : tone === "bad" ? C.danger : tone === "warn" ? C.verdict : C.t0;
  return (
    <div className="jv-card" style={{ padding: "12px 14px" }}>
      <div className="jv-label" style={{ fontSize: 10 }}>{label}</div>
      <div className="font-mono" style={{ color, fontSize: 20, marginTop: 2 }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>{sub}</div>}
    </div>
  );
}

export interface BacktestChartsPanelProps {
  horizons: ChartHorizon[];
  trades: ChartTrade[];
  isShort: boolean;
  occurrences: number;
  revert?: { days: (number | null)[]; unit: string; maxDay: number } | null;
  overlay?: { cols: string[]; rows: OverlayRow[] } | null;
}

export function BacktestChartsPanel({ horizons, trades, isShort, occurrences, revert, overlay }: BacktestChartsPanelProps) {
  const labels = horizons.map((h) => h.label);
  const scored = horizons.filter((h) => h.mean !== null);
  const passing = scored.filter((h) => h.passes);
  const best = scored.length ? scored.reduce((a, b) => ((b.mean as number) > (a.mean as number) ? b : a)) : null;
  const verdictTone = passing.length === 0 ? "bad" : passing.length === scored.length ? "good" : "warn";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Occurrences" value={String(occurrences)} sub={occurrences < 30 ? "n < 30: directional only" : "trades in sample"} tone={occurrences < 30 ? "warn" : undefined} />
        <Tile label="Edge verdict" value={`${passing.length} / ${scored.length}`} sub="horizons pass all 3 bars" tone={verdictTone} />
        <Tile label="Best horizon" value={best ? `${best.label} ${fmt(best.mean, 1)}` : "N/A"} sub={best?.winRate !== null && best ? `${best.winRate?.toFixed(0)}% win rate` : undefined} />
        <Tile label="Worst single trade" value={best ? fmt(best.largestLossPct, 1) : "N/A"} sub={best ? `max drawdown ${best.maxDrawdownPct?.toFixed(1) ?? "N/A"}% at ${best.label}` : undefined} tone="bad" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EdgeForest horizons={horizons} />
        <OosDumbbell horizons={horizons} />
        <ReturnHistogram trades={trades} labels={labels} isShort={isShort} />
        {revert && <RevertCurve days={revert.days} maxDay={revert.maxDay} unit={revert.unit} />}
        <EquityDrawdown trades={trades} labels={labels} isShort={isShort} />
        {overlay && overlay.rows.length > 1 && (
          <div className="lg:col-span-2">
            <OverlayHeatmap cols={overlay.cols} rows={overlay.rows} />
          </div>
        )}
      </div>
    </div>
  );
}
