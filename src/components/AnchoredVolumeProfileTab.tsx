"use client";

import { ResearchNotice } from "./ResearchNotice";
import { memo, useMemo, useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { AnchoredVolumeProfileResponse } from "@/lib/agents/trading-agent/skills/anchored-volume-profile-service";
import type { LevelType, ProfileLevel } from "@/lib/agents/trading-agent/skills/anchored-volume-profile";

type AnchorMode = "session" | "previous" | "date" | "multi";

const MULTI_OPTIONS = [2, 3, 5, 10, 20];
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

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

const LEVEL_COLOR: Record<LevelType, string> = { POC: C.t0, VAH: C.verdict, VAL: C.verdict, HVN: C.signal, LVN: C.danger };
const LEVEL_NAME: Record<LevelType, string> = {
  POC: "Point of control",
  VAH: "Value area high",
  VAL: "Value area low",
  HVN: "High-volume node",
  LVN: "Low-volume node",
};

const fmtPrice = (p: number) => p.toFixed(p < 1 ? 4 : 2);
const fmtVol = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
const signed = (v: number, d: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

function niceStep(range: number, target = 6): number {
  const raw = (range || 1) / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

// Intl formatters are expensive to construct (about 0.5 ms each). The chart used to build a new DateTimeFormat for every
// candle on every render (audit F8: 390 bars took 246 ms per render, 10,000 bars 5.4 s); one cached formatter per
// time zone and style brings that to a few ms.
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function cachedFormatter(kind: "time" | "date" | "day", tz: string): Intl.DateTimeFormat {
  const key = `${kind}|${tz}`;
  let f = formatterCache.get(key);
  if (!f) {
    f =
      kind === "time"
        ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
        : kind === "date"
          ? new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" })
          : new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    formatterCache.set(key, f);
  }
  return f;
}

/** Pushes labels apart vertically so none overlap, keeping order. */
function spreadLabels<T extends { y: number }>(items: T[], minGap: number, top: number, bottom: number): (T & { ly: number })[] {
  const sorted = [...items].sort((a, b) => a.y - b.y).map((i) => ({ ...i, ly: i.y }));
  for (let i = 1; i < sorted.length; i++) if (sorted[i].ly < sorted[i - 1].ly + minGap) sorted[i].ly = sorted[i - 1].ly + minGap;
  if (sorted.length && sorted[sorted.length - 1].ly > bottom) {
    sorted[sorted.length - 1].ly = bottom;
    for (let i = sorted.length - 2; i >= 0; i--) if (sorted[i].ly > sorted[i + 1].ly - minGap) sorted[i].ly = sorted[i + 1].ly - minGap;
  }
  for (const s of sorted) s.ly = Math.max(top, s.ly);
  return sorted;
}

const ProfileChart = memo(function ProfileChart({ result }: { result: AnchoredVolumeProfileResponse }) {
  const { candles, profile, levels, lastPrice } = result;
  const W = 960, H = 540, top = 14, bottom = 30, left = 58, right = 108;
  const priceRight = left + (W - left - right) * 0.66;
  const histLeft = priceRight + 10;
  const histRight = W - right;
  const innerH = H - top - bottom;

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const lo0 = Math.min(...lows, profile.low ?? Infinity, lastPrice ?? Infinity);
  const hi0 = Math.max(...highs, profile.high ?? -Infinity, lastPrice ?? -Infinity);
  const pad = (hi0 - lo0) * 0.03 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const y = (p: number) => top + ((hi - p) / (hi - lo)) * innerH;

  const n = candles.length;
  const x = (i: number) => left + ((i + 0.5) / Math.max(1, n)) * (priceRight - left);
  const step = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Number(v.toFixed(6)));

  const maxVol = Math.max(...profile.bins.map((b) => b.volume), 1);
  const histW = histRight - histLeft;
  const vaLo = profile.valueArea?.lowBinIndex ?? -1;
  const vaHi = profile.valueArea?.highBinIndex ?? -2;
  const useCandles = n <= 200;
  const tz = result.calendar === "utc" ? "UTC" : "America/New_York";
  const fmtT = cachedFormatter("time", tz);
  const fmtD = cachedFormatter("date", tz);
  const fmtDay = cachedFormatter("day", tz);

  // x-axis labels: hourly on one-session charts, a date at each session start otherwise
  const { xLabels, seps } = useMemo(() => {
    const xLabels: { i: number; text: string }[] = [];
    const seps: number[] = [];
    // Each candle is formatted once (day key and clock time), not twice per candle as before.
    const dayKeys = candles.map((c) => fmtDay.format(new Date(c.datetime)));
    const multiSession = result.anchor.sessions.length > 1;
    const clock = multiSession ? [] : candles.map((c) => fmtT.format(new Date(c.datetime)));
    candles.forEach((c, i) => {
      const prevDay = i > 0 ? dayKeys[i - 1] : null;
      const d = dayKeys[i];
      if (prevDay !== null && d !== prevDay) seps.push(i);
      if (multiSession) {
        if (prevDay === null || d !== prevDay) xLabels.push({ i, text: fmtD.format(new Date(c.datetime)) });
      } else if (clock[i].endsWith(":00") && (i === 0 || clock[i - 1] !== clock[i])) {
        xLabels.push({ i, text: clock[i].replace(/^24/, "00") });
      }
    });
    return { xLabels, seps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, tz, result.anchor.sessions.length]);
  const maxXLabels = 12;
  const xLabelStride = Math.ceil(xLabels.length / maxXLabels) || 1;

  const lineLabels = spreadLabels(
    [
      ...levels.map((l) => ({ y: y(l.price), text: `${l.type} ${fmtPrice(l.price)}`, color: LEVEL_COLOR[l.type], bold: l.type === "POC" })),
      ...(lastPrice !== null ? [{ y: y(lastPrice), text: `last ${fmtPrice(lastPrice)}`, color: C.t0, bold: true }] : []),
    ],
    12,
    top + 6,
    H - bottom - 2
  );

  const closePath = candles.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c.close).toFixed(1)}`).join(" ");
  const smoothMax = Math.max(...profile.smoothed, 1);
  const smoothPath = profile.bins.map((b, i) => `${i === 0 ? "M" : "L"}${(histLeft + (profile.smoothed[i] / maxVol) * histW).toFixed(1)},${y(b.price).toFixed(1)}`).join(" ");
  const cw = Math.max(1, Math.min(6, ((priceRight - left) / Math.max(1, n)) * 0.7));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`Anchored volume profile for ${result.ticker}: ${result.anchor.label}. POC ${profile.poc ? fmtPrice(profile.poc.price) : "none"}.`} data-testid="avp-chart">
      {/* price grid and axis */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={histRight} y1={y(t)} y2={y(t)} style={{ stroke: C.line }} />
          <text x={left - 6} y={y(t) + 3} textAnchor="end" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
            {fmtPrice(t)}
          </text>
        </g>
      ))}
      {/* node bands, behind everything */}
      {levels
        .filter((l): l is ProfileLevel & { bandLow: number; bandHigh: number } => (l.type === "HVN" || l.type === "LVN") && l.bandLow !== null && l.bandHigh !== null)
        .map((l) => (
          <rect key={`band-${l.type}-${l.price}`} x={left} width={histRight - left} y={y(l.bandHigh)} height={Math.max(2, y(l.bandLow) - y(l.bandHigh))} style={{ fill: LEVEL_COLOR[l.type], opacity: 0.12 }} data-testid={`band-${l.type}`} />
        ))}
      {/* session separators */}
      {seps.map((i) => (
        <line key={`sep-${i}`} x1={x(i) - ((priceRight - left) / Math.max(1, n)) / 2} x2={x(i) - ((priceRight - left) / Math.max(1, n)) / 2} y1={top} y2={H - bottom} style={{ stroke: C.lineB, strokeDasharray: "2 4" }} />
      ))}
      {/* price */}
      {useCandles ? (
        candles.map((c, i) => {
          const up = c.close >= c.open;
          const col = up ? C.signal : C.danger;
          return (
            <g key={c.datetime}>
              <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} style={{ stroke: col, strokeWidth: 1 }} />
              <rect x={x(i) - cw / 2} width={cw} y={Math.min(y(c.open), y(c.close))} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} style={{ fill: col }} />
            </g>
          );
        })
      ) : (
        <path d={closePath} style={{ fill: "none", stroke: C.t1, strokeWidth: 1.25 }} />
      )}
      {/* histogram */}
      <line x1={histLeft} x2={histLeft} y1={top} y2={H - bottom} style={{ stroke: C.lineB }} />
      {profile.bins.map((b, i) => {
        const yTop = y(b.priceHigh);
        const h = Math.max(1, y(b.priceLow) - yTop - 1);
        const inVa = i >= vaLo && i <= vaHi;
        return <rect key={i} x={histLeft + 1} width={Math.max(0, (b.volume / maxVol) * histW)} y={yTop} height={h} style={{ fill: C.signal, opacity: inVa ? 0.62 : 0.26 }} data-testid="avp-bin" />;
      })}
      <path d={smoothPath} style={{ fill: "none", stroke: C.t1, strokeWidth: 1.25 }} data-smoothed-max={smoothMax} />
      {/* level lines across both panels */}
      {levels.map((l) => (
        <line
          key={`lvl-${l.type}-${l.price}`}
          x1={left}
          x2={histRight}
          y1={y(l.price)}
          y2={y(l.price)}
          style={{ stroke: LEVEL_COLOR[l.type], strokeWidth: l.type === "POC" ? 1.75 : 1, strokeDasharray: l.type === "VAH" || l.type === "VAL" ? "6 3" : l.type === "HVN" || l.type === "LVN" ? "2 3" : undefined }}
          data-testid={`level-${l.type}`}
          data-price={l.price}
        />
      ))}
      {lastPrice !== null && <line x1={left} x2={histRight} y1={y(lastPrice)} y2={y(lastPrice)} style={{ stroke: C.t0, strokeWidth: 1, strokeDasharray: "1 3" }} data-testid="last-price" />}
      {/* right-hand labels */}
      {lineLabels.map((l, k) => (
        <g key={`lab-${k}`}>
          {Math.abs(l.ly - l.y) > 2 && <line x1={histRight} x2={histRight + 6} y1={l.y} y2={l.ly} style={{ stroke: C.lineB }} />}
          <text x={histRight + 8} y={l.ly + 3} style={{ fill: l.color, fontSize: 10.5, fontFamily: C.mono, fontWeight: l.bold ? 600 : 400 }}>
            {l.text}
          </text>
        </g>
      ))}
      {/* x labels */}
      {xLabels
        .filter((_, k) => k % xLabelStride === 0)
        .map((l) => (
          <text key={`x-${l.i}`} x={x(l.i)} y={H - 10} textAnchor="middle" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
            {l.text}
          </text>
        ))}
      <text x={(histLeft + histRight) / 2} y={H - 10} textAnchor="middle" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
        volume
      </text>
    </svg>
  );
});

function Legend() {
  const item = (swatch: React.ReactNode, text: string) => (
    <span className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
      {swatch}
      {text}
    </span>
  );
  const line = (color: string, dash?: string, w = 1.5) => (
    <svg width="24" height="8" aria-hidden="true">
      <line x1="0" x2="24" y1="4" y2="4" style={{ stroke: color, strokeWidth: w, strokeDasharray: dash }} />
    </svg>
  );
  const box = (color: string, op: number) => <span style={{ width: 14, height: 10, background: color, opacity: op, display: "inline-block", borderRadius: 2 }} />;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {item(line(C.t0, undefined, 1.75), "POC")}
      {item(line(C.verdict, "6 3"), "VAH / VAL (70% of volume)")}
      {item(box(C.signal, 0.62), "Volume inside the value area")}
      {item(box(C.signal, 0.26), "Volume outside")}
      {item(box(C.signal, 0.2), "HVN band")}
      {item(box(C.danger, 0.2), "LVN band")}
      {item(line(C.t0, "1 3", 1), "Last price")}
    </div>
  );
}

function LevelsTable({ result }: { result: AnchoredVolumeProfileResponse }) {
  const last = result.lastPrice;
  const rows = result.levels;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }} data-testid="avp-levels">
        <thead>
          <tr style={{ color: C.t2, borderBottom: "1px solid var(--line)" }} className="text-left">
            <th className={TH_CLASS}>Level</th>
            <th className={TH_CLASS}>Price</th>
            <th className={TH_CLASS}>Band</th>
            <th className={TH_CLASS}>From last</th>
            <th className={TH_CLASS}>From last %</th>
            <th className={TH_CLASS}>Side</th>
          </tr>
        </thead>
        <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
          {rows.map((l) => {
            const d = last === null ? null : l.price - last;
            return (
              <tr key={`${l.type}-${l.price}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                <td className={`${TD_CLASS} font-medium`} style={{ color: LEVEL_COLOR[l.type] }}>
                  {l.type} <span className="text-xs" style={{ color: C.t2 }}>{LEVEL_NAME[l.type]}</span>
                </td>
                <td className={`${TD_CLASS} font-mono`} style={{ color: C.t0 }}>{fmtPrice(l.price)}</td>
                <td className={`${TD_CLASS} font-mono`} style={{ color: C.t2 }}>{l.bandLow !== null && l.bandHigh !== null ? `${fmtPrice(l.bandLow)} to ${fmtPrice(l.bandHigh)}` : "-"}</td>
                <td className={`${TD_CLASS} font-mono`} style={{ color: C.t1 }}>{d === null ? "N/A" : `${signed(d, l.price < 1 ? 4 : 2)}`}</td>
                <td className={`${TD_CLASS} font-mono`} style={{ color: C.t1 }}>{d === null || !last ? "N/A" : `${signed((d / last) * 100, 2)}%`}</td>
                <td className={`${TD_CLASS} font-mono`} style={{ color: C.t2 }}>{d === null ? "N/A" : d > 0 ? "above" : d < 0 ? "below" : "at price"}</td>
              </tr>
            );
          })}
          {last !== null && (
            <tr style={{ borderTop: "1px solid var(--line-bright)" }}>
              <td className={`${TD_CLASS} font-medium`} style={{ color: C.t0 }}>Last price</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: C.t0 }}>{fmtPrice(last)}</td>
              <td className={TD_CLASS} colSpan={4} style={{ color: C.t2 }}>
                <span className="text-xs">latest 5-minute close{result.lastBarMs ? `, bar of ${new Date(result.lastBarMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The result panel on its own, so it can be rendered (and tested) without the form or a network call. */
export function AnchoredVolumeProfileView({ result }: { result: AnchoredVolumeProfileResponse }) {
  const { profile, anchor } = result;
  if (result.candles.length === 0 || !profile.poc) {
    return (
      <div className="flex flex-col gap-4">
        <div className="jv-card text-sm" style={{ color: C.t1 }}>
          {anchor.label}. There are no bars to build a profile from.
        </div>
        {result.dataLimitations.map((d) => (
          <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: C.verdict }}>
            {d}
          </div>
        ))}
      </div>
    );
  }
  const va = profile.valueArea;
  return (
    <div className="flex flex-col gap-6">
      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <div className="jv-label">{result.ticker}</div>
            <div className="text-lg font-medium" style={{ color: C.t0 }}>{anchor.label}</div>
          </div>
          <div className="text-xs font-mono" style={{ color: C.t2 }}>
            {result.candles.length} five-minute bars · volume {fmtVol(profile.totalVolume)} · bin {profile.binWidth} wide
          </div>
        </div>
        <ProfileChart result={result} />
        <div className="mt-3">
          <Legend />
        </div>
        <p className="text-xs mt-3" style={{ color: C.t2 }}>
          {result.candles.length <= 200 ? "Candles are 5-minute bars." : "The line is the 5-minute close."}{" "}The histogram on the right shares the price axis: each bar is the
          volume that traded in that price bin, spread evenly across each bar&apos;s range. The grey curve is the smoothed profile that the nodes are read from.
        </p>
      </div>

      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div>
            <div className="jv-label">POC</div>
            <div className="font-mono" style={{ color: C.t0 }}>{fmtPrice(profile.poc.price)}</div>
          </div>
          <div>
            <div className="jv-label">Value area</div>
            <div className="font-mono" style={{ color: C.t0 }}>{va ? `${fmtPrice(va.val)} to ${fmtPrice(va.vah)}` : "N/A"}</div>
          </div>
          <div>
            <div className="jv-label">Value area share</div>
            <div className="font-mono" style={{ color: C.t0 }}>{va ? `${(va.coverage * 100).toFixed(1)}%` : "N/A"}</div>
          </div>
          <div>
            <div className="jv-label">Nodes found</div>
            <div className="font-mono" style={{ color: C.t0 }}>{profile.hvns.length} HVN · {profile.lvns.length} LVN</div>
          </div>
        </div>
        <LevelsTable result={result} />
        <p className="text-xs mt-3" style={{ color: C.t2 }}>
          Distances are level minus last price. A level is a place where volume traded earlier, not a forecast: whether price reacts there is a separate question, tested in VOLUME_NODE_STUDY_NOTES.md.
        </p>
      </div>

      {result.dataLimitations.map((d) => (
        <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: C.verdict }}>
          {d}
        </div>
      ))}
    </div>
  );
}

/**
 * Anchored volume profile: pick a ticker and an anchor (today's session, the previous session, from a date, or the last N
 * sessions) and see where volume traded, with the point of control, 70% value area and high/low-volume nodes drawn on the
 * 5-minute price chart. Describes history only: it does not place or suggest an order.
 */
export function AnchoredVolumeProfileTab({ defaultTicker = "SPY" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [mode, setMode] = useState<AnchorMode>("session");
  const [date, setDate] = useState("");
  const [days, setDays] = useState(5);
  const [result, setResult] = useState<AnchoredVolumeProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const sym = ticker.trim();
    if (!sym) return;
    if (mode === "date" && !date) {
      setError("Pick a start date.");
      return;
    }
    const anchor = mode === "date" ? `date:${date}` : mode;
    const qs = new URLSearchParams({ ticker: sym, anchor });
    if (mode === "multi") qs.set("days", String(days));
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/anchored-volume-profile?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Volume Profile", symbol: sym, metadata: { endpoint: "anchored-volume-profile", status: res.status } });
      } else {
        setResult(json as AnchoredVolumeProfileResponse);
        track("volume_profile_run", { tab: "Volume Profile", symbol: sym, metadata: { anchor: mode } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Volume Profile", symbol: sym, metadata: { endpoint: "anchored-volume-profile", status: 0 } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <ResearchNotice source="Alpaca 5-minute bars (IEX feed, one exchange) for stocks; Coinbase for crypto" hypothetical={false}>
        Volume at each price is estimated by spreading every bar across its high-to-low range. A level shows where trading happened, not where price will go.
      </ResearchNotice>
      <p className="jv-lede">
        Shows where volume actually traded over a chosen stretch of 5-minute bars: the busiest price (point of control), the band holding 70% of
        the volume (value area), and the peaks and troughs of the profile (high- and low-volume nodes). Pick the anchor, then read the levels
        against the last price. Each bar&apos;s volume is spread evenly across its high-to-low range, so this is an estimate, not a tick-level
        profile, and a level is only a place where volume traded before: it is not a signal. Regular hours only for stocks; crypto uses UTC days.
      </p>

      <form onSubmit={run} className="flex flex-wrap gap-3 mb-6 items-center">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="SPY or BTC-USD" className="jv-input w-36" aria-label="Ticker" />
        <select value={mode} onChange={(e) => setMode(e.target.value as AnchorMode)} className="jv-select" aria-label="Anchor">
          <option value="session">Today&apos;s session</option>
          <option value="previous">Previous session</option>
          <option value="date">From a date</option>
          <option value="multi">Last N sessions</option>
        </select>
        {mode === "date" && <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="jv-input" aria-label="Start date" />}
        {mode === "multi" && (
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="jv-select" aria-label="Number of sessions">
            {MULTI_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} sessions
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Building…" : "Build Profile"}
        </button>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {result && <AnchoredVolumeProfileView result={result} />}
    </div>
  );
}
