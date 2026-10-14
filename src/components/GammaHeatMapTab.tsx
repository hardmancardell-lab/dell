"use client";

import { useMemo, useState } from "react";
import type { GammaHeatMapResult } from "@/lib/agents/trading-agent/skills/gamma-heat-map";
import { useTrackEvent } from "@/lib/analytics/use-track";

type View = "net" | "call" | "put" | "gross";
type Scale = "shared" | "each";

const VIEWS: [View, string][] = [
  ["net", "Net (calls +, puts −)"],
  ["call", "Calls only"],
  ["put", "Puts only"],
  ["gross", "Gross"],
];
const WINDOWS: [number, string][] = [
  [7, "Next 7 days"],
  [14, "Next 14 days"],
  [30, "Next 30 days"],
  [99, "All loaded (45 days)"],
];
const SCALES: [Scale, string][] = [
  ["shared", "Shared"],
  ["each", "Each expiry"],
];
/** Strike-range choices as a share of spot, shown to the user as dollars either side of spot. */
const RANGE_FRACTIONS = [0.04, 0.05, 0.08, 0.1, 0.2];

// Two colours that stay apart for colour-blind viewers: blue for calls, orange for puts, teal for the combined view.
const CALL_COLOR = "#3987e5";
const PUT_COLOR = "#d95926";
const GROSS_COLOR = "#34a89f";

const niceRange = (v: number) => (v >= 5 ? Math.round(v) : Math.round(v * 2) / 2);
const money = (m: number) => {
  const a = Math.abs(m);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}B` : a >= 10 ? `${a.toFixed(0)}M` : `${a.toFixed(1)}M`;
  return `${m < 0 ? "−" : ""}$${s}`;
};

function Seg<T extends string | number>({ label, items, value, onChange }: { label: string; items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5 max-w-full">
      <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-2)" }}>{label}</div>
      <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md" style={{ border: "1px solid var(--line-bright)" }}>
        {items.map(([v, text], i) => {
          const on = v === value;
          return (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(v)}
              className="px-3 py-1.5 text-sm whitespace-nowrap"
              style={{
                background: on ? "var(--signal)" : "transparent",
                color: on ? "var(--ink-950)" : "var(--text-1)",
                fontWeight: on ? 600 : 400,
                borderLeft: i === 0 ? "none" : "1px solid var(--line-bright)",
              }}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function baseColor(view: View, v: number): string {
  if (view === "net") return v >= 0 ? CALL_COLOR : PUT_COLOR;
  return view === "call" ? CALL_COLOR : view === "put" ? PUT_COLOR : GROSS_COLOR;
}

/** Square-root scale so the faint far-dated strikes stay visible next to the near-dated ones. */
function cellFill(view: View, v: number, max: number): string | null {
  if (!max || v === 0) return null;
  const a = Math.min(1, Math.sqrt(Math.abs(v) / max));
  return `color-mix(in srgb, ${baseColor(view, v)} ${Math.round(8 + a * 86)}%, var(--ink-800))`;
}

function HeatMap({ data, view, windowDays, scale, rangeDollars }: { data: GammaHeatMapResult; view: View; windowDays: number; scale: Scale; rangeDollars: number }) {
  const { spot } = data;
  const colIdx = data.expirations.map((e, j) => [e, j] as const).filter(([e]) => e.days <= windowDays);
  const rowIdx = data.strikes.map((k, i) => [k, i] as const).filter(([k]) => Math.abs(k - spot) <= rangeDollars + 1e-9);
  const n = rowIdx.length;
  if (n === 0 || colIdx.length === 0) return <p className="text-sm" style={{ color: "var(--text-2)" }}>Nothing to draw for this choice. Widen the strike range or the expiration window.</p>;

  const val = (i: number, j: number) => {
    const c = data.call[i][j], p = data.put[i][j];
    return view === "net" ? c - p : view === "call" ? c : view === "put" ? p : c + p;
  };

  const rh = Math.max(4, Math.min(16, Math.floor(560 / n)));
  const top0 = 46, left = 58, gap = 24, stripW = 190;
  const cw = Math.max(34, Math.min(62, Math.floor(560 / colIdx.length)));
  const hw = cw * colIdx.length;
  const H = top0 + n * rh + 16;
  const W = left + hw + gap + stripW + 90;
  const yOf = (r: number) => top0 + r * rh;

  let gmax = 0;
  const cmax = colIdx.map(([, j]) => {
    let m = 0;
    rowIdx.forEach(([, i]) => { const a = Math.abs(val(i, j)); if (a > m) m = a; if (a > gmax) gmax = a; });
    return m;
  });

  const strikesShown = rowIdx.map(([k]) => k);
  const yAt = (p: number): number | null => {
    if (p >= strikesShown[0]) return yOf(0) + rh / 2;
    if (p <= strikesShown[n - 1]) return yOf(n - 1) + rh / 2;
    for (let r = 0; r < n - 1; r++) {
      const a = strikesShown[r], b = strikesShown[r + 1];
      if (p <= a && p >= b) return yOf(r) + rh / 2 + ((a - p) / (a - b)) * rh;
    }
    return null;
  };

  const profile = rowIdx.map(([, i]) => colIdx.reduce((s, [, j]) => s + val(i, j), 0));
  const pmax = Math.max(...profile.map(Math.abs), 1e-9);
  const px = left + hw + gap;
  const zero = view === "net" ? px + stripW / 2 : px;
  const every = Math.max(1, Math.ceil(12 / rh));
  const spotY = yAt(spot);
  const flipIn = data.flip !== null && data.flip > strikesShown[n - 1] && data.flip < strikesShown[0];
  const flipY = flipIn ? yAt(data.flip as number) : null;
  const flipAbove = flipIn && (data.flip as number) > spot;
  const wallRow = (k: number | undefined) => (k === undefined ? -1 : strikesShown.indexOf(k));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${data.underlying} gamma heat map`} style={{ display: "block", overflow: "visible", width: "100%", maxWidth: W, height: "auto" }}>
        {colIdx.map(([e, j], c) => {
          const x = left + c * cw;
          const [, mm, dd] = e.date.split("-");
          return (
            <g key={e.date}>
              <text x={x + cw / 2} y={top0 - 24} textAnchor="middle" fontSize={11.5} fill="var(--text-1)">{`${mm}/${dd}`}</text>
              <text x={x + cw / 2} y={top0 - 10} textAnchor="middle" fontSize={11.5} fill="var(--text-2)">{e.days < 0.5 ? "today" : `${Math.round(e.days)}d`}</text>
              {rowIdx.map(([k, i], r) => {
                const v = val(i, j);
                const fill = cellFill(view, v, scale === "shared" ? gmax : cmax[c]);
                if (!fill) return null;
                return (
                  <rect key={k} x={x + 0.5} y={yOf(r)} width={cw - 1} height={rh - 0.5} style={{ fill }}>
                    <title>{`${data.underlying} ${k} ${e.date}: calls ${money(data.call[i][j])}, puts ${money(data.put[i][j])}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        {rowIdx.map(([k], r) =>
          r % every === 0 ? (
            <text key={k} x={left - 6} y={yOf(r) + rh / 2 + 4} textAnchor="end" fontSize={11.5} fill="var(--text-2)">{k}</text>
          ) : null,
        )}
        {spotY !== null && (
          <g>
            <line x1={left} x2={left + hw + gap + stripW} y1={spotY} y2={spotY} stroke="var(--text-0)" strokeWidth={1.4} />
            <text x={left + 4} y={flipAbove || !flipIn ? spotY + 12 : spotY - 4} fontSize={11.5} fill="var(--text-0)" stroke="var(--ink-800)" strokeWidth={3} paintOrder="stroke">{`Spot ${spot.toFixed(2)}`}</text>
          </g>
        )}
        {flipY !== null && (
          <g>
            <line x1={left} x2={left + hw + gap + stripW} y1={flipY} y2={flipY} stroke="var(--text-1)" strokeWidth={1.4} strokeDasharray="5 4" />
            <text x={left + 4} y={flipAbove ? flipY - 4 : flipY + 12} fontSize={11.5} fill="var(--text-1)" stroke="var(--ink-800)" strokeWidth={3} paintOrder="stroke">{`Zero-gamma ${(data.flip as number).toFixed(2)}`}</text>
          </g>
        )}
        <text x={px} y={top0 - 10} fontSize={11.5} fill="var(--text-1)">Total per strike</text>
        {view === "net" && <line x1={zero} x2={zero} y1={top0} y2={top0 + n * rh} stroke="var(--line-bright)" />}
        {profile.map((v, r) => {
          const len = (Math.abs(v) / pmax) * (view === "net" ? stripW / 2 : stripW);
          if (len < 0.3) return null;
          const x = v >= 0 ? zero : zero - len;
          return (
            <rect key={strikesShown[r]} x={x} y={yOf(r) + 0.5} width={len} height={Math.max(1, rh - 1.5)} fill={baseColor(view, v)} opacity={0.85}>
              <title>{`${data.underlying} ${strikesShown[r]}: ${money(v)} across the expirations shown`}</title>
            </rect>
          );
        })}
        {wallRow(data.callWalls[0]) >= 0 && <text x={px + stripW + 6} y={yOf(wallRow(data.callWalls[0])) + rh / 2 + 4} fontSize={11.5} fill="var(--text-1)">◄ call wall</text>}
        {wallRow(data.putWalls[0]) >= 0 && <text x={px + stripW + 6} y={yOf(wallRow(data.putWalls[0])) + rh / 2 + 4} fontSize={11.5} fill="var(--text-1)">◄ put wall</text>}
      </svg>
    </div>
  );
}

/**
 * Gamma heat map for any optionable ticker: strikes down the side, expirations across, with the per-strike total
 * beside it. Uses the GEX signal's own chains and maths (method gex-v2). A map of where option positioning sits, not a
 * forecast that price will stop there.
 */
export function GammaHeatMapTab({ defaultTicker = "SPY" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [data, setData] = useState<GammaHeatMapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("net");
  const [windowDays, setWindowDays] = useState(99);
  const [scale, setScale] = useState<Scale>("shared");
  const [rangeIdx, setRangeIdx] = useState(2);
  const { track } = useTrackEvent();

  const ranges = useMemo(() => (data ? RANGE_FRACTIONS.map((f) => niceRange(f * data.spot)) : []), [data]);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gamma-heat-map?ticker=${encodeURIComponent(t)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Gamma Heat Map", metadata: { endpoint: "gamma-heat-map", status: res.status } });
      } else {
        setData(json as GammaHeatMapResult);
        setRangeIdx(2);
        track("backtest_run", { tab: "Gamma Heat Map", metadata: { study: "gamma-heat-map", ticker: t } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const shownCols = data ? data.expirations.filter((e) => e.days <= windowDays).length : 0;
  const gross = data ? data.callTotalM + data.putTotalM : 0;
  const rangeDollars = ranges[rangeIdx] ?? 0;

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Dollar gamma by strike (down the side) and expiration (across) for any optionable ticker. A dark cell means a lot of option gamma sits at that
        strike and date. The strip on the right adds up each strike across the expirations shown. It maps where positioning is concentrated; it does not
        predict that price will stop there.
      </p>

      <form onSubmit={load} className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Ticker, e.g. SPY"
          className="jv-input w-48"
          aria-label="Ticker symbol"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !ticker.trim()} className="jv-btn">
          {loading ? "Loading chains…" : "Pull the heat map"}
        </button>
        <span className="text-xs" style={{ color: "var(--text-2)" }}>
          Loads up to 12 expirations inside 45 days, so it takes several seconds. Open interest is the prior day&apos;s figure.
        </span>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-4">
          <div className="jv-card">
            <div className="jv-br-b" />
            <div className="flex flex-wrap gap-x-6 gap-y-3 items-end">
              <Seg label="View" items={VIEWS} value={view} onChange={setView} />
              <Seg label="Expirations" items={WINDOWS} value={windowDays} onChange={setWindowDays} />
              <Seg label="Strike range (dollars from spot)" items={ranges.map((r, i) => [i, `±$${r}`] as [number, string])} value={rangeIdx} onChange={setRangeIdx} />
              <Seg label="Colour scale" items={SCALES} value={scale} onChange={setScale} />
            </div>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            {[
              [`$${data.spot.toFixed(2)}`, `${data.underlying} last price`],
              [money(data.callTotalM), "call gamma per 1% move"],
              [money(data.putTotalM), "put gamma per 1% move"],
              [money(gross), "gross (calls + puts)"],
              [data.callWalls.length ? data.callWalls.join(", ") : "N/A", "largest call gamma above spot (call walls)"],
              [data.putWalls.length ? data.putWalls.join(", ") : "N/A", "largest put gamma below spot (put walls)"],
              [data.flip === null ? "none in ±15%" : `$${data.flip.toFixed(2)}`, "zero-gamma level, all expirations"],
            ].map(([a, b]) => (
              <div key={b} className="jv-card" style={{ padding: 12 }}>
                <div className="jv-br-b" />
                <div className="font-mono text-lg" style={{ color: "var(--text-0)" }}>{a}</div>
                <div className="text-xs" style={{ color: "var(--text-2)" }}>{b}</div>
              </div>
            ))}
          </div>

          <div className="jv-card">
            <div className="jv-br-b" />
            <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
              {data.underlying}: {VIEWS.find((v) => v[0] === view)?.[1]}, {shownCols} expiration{shownCols === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-2 text-xs mb-3" style={{ color: "var(--text-1)" }}>
              {view === "net" ? (
                <>
                  <span>puts dominate</span>
                  <i style={{ display: "inline-block", height: 10, width: 140, borderRadius: 2, background: `linear-gradient(90deg, ${PUT_COLOR}, var(--ink-800), ${CALL_COLOR})` }} />
                  <span>calls dominate</span>
                </>
              ) : (
                <>
                  <span>less</span>
                  <i style={{ display: "inline-block", height: 10, width: 140, borderRadius: 2, background: `linear-gradient(90deg, var(--ink-800), ${baseColor(view, 1)})` }} />
                  <span>more gamma</span>
                </>
              )}
            </div>
            <HeatMap data={data} view={view} windowDays={windowDays} scale={scale} rangeDollars={rangeDollars} />
            <p className="text-xs mt-3" style={{ color: "var(--text-2)" }}>
              Units: dollars of stock a 1% move in {data.underlying} would require hedging, per strike and date, from open interest. Colours use a
              square-root scale. Showing strikes within ${rangeDollars} of the ${data.spot.toFixed(2)} spot; the totals, walls and zero-gamma level use every
              strike loaded. {data.contractCount.toLocaleString("en-US")} contracts across {data.expirations.length} expirations, pulled {data.asOf.slice(0, 16).replace("T", " ")} UTC.
            </p>
          </div>

          <div className="jv-card">
            <div className="jv-br-b" />
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>How to read this, and what it cannot tell you</div>
            <ul className="text-sm flex flex-col gap-2 pl-5 list-disc" style={{ color: "var(--text-1)" }}>
              <li><b style={{ color: "var(--text-0)" }}>The sign is an assumption.</b> Net assumes market makers are long the calls and short the puts customers trade against. Public data cannot confirm who holds which side, so Calls only and Puts only show where the gamma sits without assuming anything. The zero-gamma level is the same under either sign.</li>
              <li><b style={{ color: "var(--text-0)" }}>Near expirations dominate.</b> Gamma per contract rises sharply as expiry approaches, so the leftmost columns carry most of the heat. Switch the colour scale to Each expiry to see the later dates on their own scale.</li>
              <li><b style={{ color: "var(--text-0)" }}>Gross is a ceiling, not a forecast.</b> It adds every contract as if dealers held all of it. Real net dealer positions are smaller.</li>
              <li><b style={{ color: "var(--text-0)" }}>Walls</b> are the strikes with the most call gamma above spot and the most put gamma below spot, the same definition as the Options dashboard (method gex-v2).</li>
            </ul>
          </div>

          {data.dataLimitations.map((d) => (
            <div key={d.slice(0, 40)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
