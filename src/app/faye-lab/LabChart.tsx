import { percent, shortDate, shortTime, type SeriesPoint } from "@/lib/faye/lab/stats";

/**
 * Pass rate per run for one suite: one bar per run, oldest on the left. The scale is fixed at 0 to 100% and the bars start at zero.
 * One axis only. Each bar carries its own "passed/total" label (so n is always on screen), and a thin line shows the 95% range, which
 * is wide when there are few questions. Colour is never the only signal: the label and the table below say the same thing.
 * Pure SVG, Jarvis tokens through CSS classes, server-render safe, no timers.
 */
const W = 320;
const H = 176;
const L = 34;
const R = 8;
const T = 22;
const B = 40;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;

const f = (n: number) => Math.round(n * 10) / 10;
const y = (rate: number) => f(T + PLOT_H * (1 - rate));

export interface PassChartProps {
  suite: string;
  title: string;
  points: readonly SeriesPoint[];
  /** For the guardrail: a bar under 100% is drawn red (the gate treats any miss as a block). */
  strict?: boolean;
  emptyText: string;
  id: string;
}

export function toneFor(p: SeriesPoint, strict: boolean): "ok" | "warn" | "bad" {
  if (p.passed === p.total) return "ok";
  return strict ? "bad" : "warn";
}

export function PassChart({ suite, title, points, strict = false, emptyText, id }: PassChartProps) {
  const totals = points.map((p) => p.total);
  const nText = points.length === 0 ? "" : Math.min(...totals) === Math.max(...totals) ? `n = ${totals[0]} questions per run` : `n = ${Math.min(...totals)} to ${Math.max(...totals)} questions per run`;
  const caption = `${title}${points.length > 0 ? `, last ${points.length} ${points.length === 1 ? "run" : "runs"}` : ""}`;
  if (points.length === 0) {
    return (
      <figure className="fl-chart" data-suite={suite}>
        <figcaption>{title}</figcaption>
        <p className="fl-empty">{emptyText}</p>
      </figure>
    );
  }
  const slot = PLOT_W / points.length;
  const barW = Math.min(34, slot * 0.6);
  const summary = points.map((p, i) => `run ${i + 1}: ${p.passed} of ${p.total}`).join("; ");
  return (
    <figure className="fl-chart" data-suite={suite}>
      <figcaption id={`${id}-cap`}>
        {caption}
        <span className="fl-small" style={{ display: "block", fontWeight: 400 }}>
          {nText}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`}>
        <title id={`${id}-t`}>{caption}</title>
        <desc id={`${id}-d`}>{`Bars start at zero on a scale of 0 to 100 percent. ${summary}.`}</desc>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line className={g === 0 ? "fl-svg-base" : "fl-svg-grid"} x1={L} x2={W - R} y1={y(g)} y2={y(g)} />
            <text className="fl-svg-t" x={L - 6} y={y(g) + 4} textAnchor="end">
              {percent(g)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = L + slot * i + slot / 2;
          const top = y(p.rate);
          const h = Math.max(0, f(T + PLOT_H - top));
          const lo = y(p.low);
          const hi = y(p.high);
          const tone = toneFor(p, strict);
          return (
            <g key={p.id} data-point={i}>
              <rect className="fl-bar" data-tone={tone} x={f(cx - barW / 2)} y={top} width={f(barW)} height={h} />
              <line className="fl-whisk" x1={f(cx)} x2={f(cx)} y1={hi} y2={lo} />
              <line className="fl-whisk" x1={f(cx - 4)} x2={f(cx + 4)} y1={hi} y2={hi} />
              <line className="fl-whisk" x1={f(cx - 4)} x2={f(cx + 4)} y1={lo} y2={lo} />
              <text className="fl-svg-v" x={f(cx)} y={Math.max(12, hi - 5)} textAnchor="middle">
                {`${p.passed}/${p.total}`}
              </text>
              <text className="fl-svg-t" x={f(cx)} y={H - 22} textAnchor="middle">
                {shortDate(p.at)}
              </text>
              <text className="fl-svg-t" x={f(cx)} y={H - 9} textAnchor="middle">
                {shortTime(p.at)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
