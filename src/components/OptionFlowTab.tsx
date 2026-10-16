"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OPTION_FLOW_SYMBOLS, loggingStatus, sessionDateET } from "@/lib/agents/trading-agent/skills/option-flow-snapshot";
import type { OptionFlowRow } from "@/lib/agents/trading-agent/skills/option-flow-snapshot";
import { toEasternParts } from "@/lib/agents/trading-agent/skills/time-windows";

/**
 * Intraday put/call log viewer. Shows what the 5-minute logger recorded for one name and one session: raw measures
 * only. There are deliberately no bullish/bearish labels and no signal here; the two competing readings are scored
 * later on forward data (OPTION_FLOW_LOG_NOTES.md).
 */

interface ApiResponse {
  symbol: string;
  date: string;
  sessions: string[];
  snapshots: OptionFlowRow[];
  serverTime?: number;
}

// Colours chosen to stay apart for colour-blind viewers and to carry no direction: blue = by volume, gold = by premium, teal = new-volume bars.
const VOL_COLOR = "#3987e5";
const PREM_COLOR = "#e0b020";
const BAR_COLOR = "#34a89f";

const OPEN_MIN = 570; // 9:30 ET
const CLOSE_MIN = 960; // 16:00 ET
const GAP_MIN = 7.5; // a longer gap between snapshots is drawn as a break

/** Minutes since ET midnight, with the seconds as a fraction. */
const etMinutes = (ms: number) => toEasternParts(ms).minutesSinceMidnight + (ms % 60_000) / 60_000;
const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;
const etClock = (ms: number) => clock(toEasternParts(ms).minutesSinceMidnight);
const ratio = (v: number | null) => (v === null ? "–" : v.toFixed(2));
const int = (v: number | null) => (v === null ? "–" : Math.round(v).toLocaleString("en-US"));
const usd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000).toLocaleString("en-US")}K`);
const pct1 = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1)}%`);

function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function Seg<T extends string>({ label, items, value, onChange }: { label: string; items: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5 max-w-full">
      <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-2)" }}>{label}</div>
      <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md" style={{ border: "1px solid var(--line-bright)" }}>
        {items.map((v, i) => {
          const on = v === value;
          return (
            <button
              key={v}
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
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Pt { row: OptionFlowRow; x: number; min: number }

function Charts({ rows, hover, setHover }: { rows: OptionFlowRow[]; hover: number | null; setHover: (i: number | null) => void }) {
  const W = 900, left = 52, right = 14, plotW = W - left - right;
  const P1 = { top: 26, h: 170 }, P2 = { top: 252, h: 170 }, P3 = { top: 478, h: 110 };
  const axisY = P3.top + P3.h + 20;
  const H = axisY + 12;
  const xOf = (min: number) => left + ((Math.min(CLOSE_MIN, Math.max(OPEN_MIN, min)) - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN)) * plotW;

  const pts: Pt[] = rows.map((row) => {
    const min = etMinutes(Date.parse(row.actual_fetch_time));
    return { row, min, x: xOf(min) };
  });

  // Runs of consecutive snapshots with no long gap between them; a gap breaks the line and is shaded.
  const runs: Pt[][] = [];
  const gaps: [number, number][] = [];
  pts.forEach((p, i) => {
    if (i > 0 && p.min - pts[i - 1].min > GAP_MIN) {
      runs.push([p]);
      gaps.push([pts[i - 1].x, p.x]);
    } else if (runs.length === 0) runs.push([p]);
    else runs[runs.length - 1].push(p);
  });

  const line = (run: Pt[], get: (r: OptionFlowRow) => number | null, y: (v: number) => number) => {
    let d = "", pen = false;
    for (const p of run) {
      const v = get(p.row);
      if (v === null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${p.x.toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // Panel 1: cumulative put/call by volume and premium.
  const cum = pts.flatMap((p) => [p.row.pc_volume, p.row.pc_premium]).filter((v): v is number => v !== null);
  const t1 = niceTicks(Math.max(1.2, ...cum) * 1.08);
  const max1 = t1[t1.length - 1];
  const y1 = (v: number) => P1.top + P1.h - (v / max1) * P1.h;

  // Panel 2: put/call of the new volume per interval as bars, cumulative-by-volume line behind. Bars past the cap are clipped and marked.
  const bars = pts.map((p) => p.row.pc_new_volume).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const cap = Math.max(2, quantile(bars, 0.9) * 1.5, ...cum.map((v) => v * 1.0));
  const t2 = niceTicks(Math.min(cap, Math.max(...bars, 1)) * 1.08);
  const max2 = t2[t2.length - 1];
  const y2 = (v: number) => P2.top + P2.h - (Math.min(v, max2) / max2) * P2.h;
  const barW = Math.max(2, Math.min(10, (plotW * 5) / (CLOSE_MIN - OPEN_MIN) * 0.7));

  // Panel 3: spot.
  const spots = pts.map((p) => p.row.spot);
  const sMin = Math.min(...spots), sMax = Math.max(...spots);
  const pad = Math.max((sMax - sMin) * 0.15, sMax * 0.0005);
  const y3 = (v: number) => P3.top + P3.h - ((v - (sMin - pad)) / (sMax - sMin + 2 * pad)) * P3.h;
  const t3 = [sMin, (sMin + sMax) / 2, sMax];

  const hourTicks = [570, 600, 660, 720, 780, 840, 900, 960];
  const hp = hover !== null ? pts[hover] : null;

  const grid = (top: number, h: number) => (
    <g>
      {hourTicks.map((m) => <line key={m} x1={xOf(m)} x2={xOf(m)} y1={top} y2={top + h} stroke="var(--line)" strokeWidth={1} />)}
      <rect x={left} y={top} width={plotW} height={h} fill="none" stroke="var(--line-bright)" />
    </g>
  );

  return (
    <div className="overflow-x-auto">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Intraday put/call charts" style={{ display: "block", width: "100%", minWidth: 640, height: "auto" }} onMouseLeave={() => setHover(null)}>
      {/* Panel titles */}
      <text x={left} y={16} fontSize={12} fill="var(--text-0)">Cumulative put/call, day to date</text>
      <g fontSize={11.5}>
        <line x1={left + 232} x2={left + 252} y1={12} y2={12} stroke={VOL_COLOR} strokeWidth={2.2} /><text x={left + 257} y={16} fill="var(--text-1)">by volume</text>
        <line x1={left + 330} x2={left + 350} y1={12} y2={12} stroke={PREM_COLOR} strokeWidth={2.2} /><text x={left + 355} y={16} fill="var(--text-1)">by premium</text>
      </g>
      <text x={left} y={P2.top - 10} fontSize={12} fill="var(--text-0)">Put/call of only the new volume in each interval</text>
      <g fontSize={11.5}>
        <rect x={left + 308} y={P2.top - 19} width={10} height={10} fill={BAR_COLOR} opacity={0.85} /><text x={left + 322} y={P2.top - 10} fill="var(--text-1)">new volume</text>
        <line x1={left + 400} x2={left + 420} y1={P2.top - 14} y2={P2.top - 14} stroke="var(--text-1)" strokeWidth={1.4} /><text x={left + 425} y={P2.top - 10} fill="var(--text-1)">cumulative by volume</text>
        <rect x={left + 555} y={P2.top - 19} width={10} height={10} fill="none" stroke={BAR_COLOR} strokeDasharray="2 2" /><text x={left + 569} y={P2.top - 10} fill="var(--text-1)">flagged (volume dropped)</text>
      </g>
      <text x={left} y={P3.top - 10} fontSize={12} fill="var(--text-0)">Spot (underlying last price at each snapshot)</text>

      {/* Gap bands */}
      {gaps.map(([a, b], i) => (
        <g key={i}>
          {[P1, P2, P3].map((p, k) => <rect key={k} x={a} y={p.top} width={b - a} height={p.h} fill="var(--line)" opacity={0.45} />)}
          <text x={(a + b) / 2} y={P1.top + 12} textAnchor="middle" fontSize={10.5} fill="var(--text-2)">no snapshots</text>
        </g>
      ))}

      {/* Panel 1 */}
      {grid(P1.top, P1.h)}
      {t1.map((v) => (
        <g key={v}>
          <line x1={left} x2={left + plotW} y1={y1(v)} y2={y1(v)} stroke="var(--line)" strokeDasharray={v === 1 ? undefined : "2 4"} />
          <text x={left - 6} y={y1(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-2)">{v}</text>
        </g>
      ))}
      {1 <= max1 && <line x1={left} x2={left + plotW} y1={y1(1)} y2={y1(1)} stroke="var(--text-2)" strokeWidth={1} strokeDasharray="5 4" />}
      {runs.map((run, i) => (
        <g key={i}>
          <path d={line(run, (r) => r.pc_volume, y1)} fill="none" stroke={VOL_COLOR} strokeWidth={2} strokeLinejoin="round" />
          <path d={line(run, (r) => r.pc_premium, y1)} fill="none" stroke={PREM_COLOR} strokeWidth={2} strokeLinejoin="round" />
          {run.length === 1 && run[0].row.pc_volume !== null && <circle cx={run[0].x} cy={y1(run[0].row.pc_volume)} r={2.5} fill={VOL_COLOR} />}
        </g>
      ))}

      {/* Panel 2 */}
      {grid(P2.top, P2.h)}
      {t2.map((v) => (
        <g key={v}>
          <line x1={left} x2={left + plotW} y1={y2(v)} y2={y2(v)} stroke="var(--line)" strokeDasharray="2 4" />
          <text x={left - 6} y={y2(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-2)">{v}</text>
        </g>
      ))}
      {1 <= max2 && <line x1={left} x2={left + plotW} y1={y2(1)} y2={y2(1)} stroke="var(--text-2)" strokeWidth={1} strokeDasharray="5 4" />}
      {pts.map((p, i) => {
        const v = p.row.pc_new_volume;
        if (v === null) return null;
        const top = y2(v), base = P2.top + P2.h;
        const flagged = p.row.clamped || p.row.stale;
        return (
          <g key={i}>
            <rect x={p.x - barW / 2} y={top} width={barW} height={Math.max(1, base - top)} fill={flagged ? "none" : BAR_COLOR} stroke={flagged ? BAR_COLOR : "none"} strokeDasharray={flagged ? "2 2" : undefined} opacity={0.85} />
            {v > max2 && <path d={`M${p.x - 3.5},${P2.top + 7} L${p.x + 3.5},${P2.top + 7} L${p.x},${P2.top + 1} Z`} fill="var(--text-0)"><title>{`Clipped: ${v.toFixed(2)}`}</title></path>}
          </g>
        );
      })}
      {runs.map((run, i) => (
        <path key={i} d={line(run, (r) => r.pc_volume, y2)} fill="none" stroke="var(--text-1)" strokeWidth={1.4} strokeLinejoin="round" />
      ))}

      {/* Panel 3 */}
      {grid(P3.top, P3.h)}
      {t3.map((v, i) => (
        <g key={i}>
          <line x1={left} x2={left + plotW} y1={y3(v)} y2={y3(v)} stroke="var(--line)" strokeDasharray="2 4" />
          <text x={left - 6} y={y3(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-2)">{v.toFixed(2)}</text>
        </g>
      ))}
      {runs.map((run, i) => (
        <path key={i} d={line(run, (r) => r.spot, y3)} fill="none" stroke="var(--text-0)" strokeWidth={1.8} strokeLinejoin="round" />
      ))}

      {/* Shared time axis (US Eastern) */}
      {hourTicks.map((m) => (
        <text key={m} x={xOf(m)} y={axisY} textAnchor="middle" fontSize={11} fill="var(--text-2)">{clock(m)}</text>
      ))}
      <text x={left + plotW} y={axisY + 12} textAnchor="end" fontSize={10.5} fill="var(--text-2)">US Eastern. Each point sits at the time the snapshot was actually fetched.</text>

      {/* Hover */}
      {hp && (
        <g pointerEvents="none">
          <line x1={hp.x} x2={hp.x} y1={P1.top} y2={P3.top + P3.h} stroke="var(--text-1)" strokeWidth={1} strokeDasharray="3 3" />
        </g>
      )}
      {pts.map((p, i) => {
        const prev = pts[i - 1], next = pts[i + 1];
        const x0 = prev ? (prev.x + p.x) / 2 : left, x1 = next ? (next.x + p.x) / 2 : left + plotW;
        return <rect key={i} x={x0} y={P1.top} width={Math.max(2, x1 - x0)} height={P3.top + P3.h - P1.top} fill="transparent" onMouseEnter={() => setHover(i)} />;
      })}
    </svg>
    </div>
  );
}

export function OptionFlowTab() {
  const [symbol, setSymbol] = useState<string>(OPTION_FLOW_SYMBOLS[0]);
  const [date, setDate] = useState<string | null>(null); // null = today in New York (server default)
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  // Null until mounted: the clock is read in an effect so the server render and the first client render agree (no hydration mismatch).
  const [nowMs, setNowMs] = useState<number | null>(null);
  const reqId = useRef(0);

  const today = nowMs === null ? null : sessionDateET(nowMs);
  const viewing = date ?? today;

  useEffect(() => { setNowMs(Date.now()); }, []);

  const load = useCallback(async (quiet: boolean) => {
    if (!viewing) return;
    const id = ++reqId.current;
    if (!quiet) setLoading(true);
    try {
      const q = new URLSearchParams({ symbol, date: viewing });
      const res = await fetch(`/api/option-flow?${q.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (id !== reqId.current) return;
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        setData(null);
      } else {
        setError(null);
        setData(json as ApiResponse);
      }
    } catch (err) {
      if (id === reqId.current) setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [symbol, viewing]);

  useEffect(() => { setHover(null); void load(false); }, [load]);

  // Keep the status chip and today's data fresh while the tab is open.
  useEffect(() => {
    const t = setInterval(() => {
      setNowMs(Date.now());
      if (viewing && viewing === sessionDateET(Date.now())) void load(true);
    }, 60_000);
    return () => clearInterval(t);
  }, [load, viewing]);

  const rows = useMemo(() => data?.snapshots ?? [], [data]);
  const first = rows[0], last = rows[rows.length - 1];
  const lastFetchMs = last ? Date.parse(last.actual_fetch_time) : null;
  const status = nowMs !== null && viewing ? loggingStatus({ lastFetchMs, nowMs, viewingDate: viewing }) : null;
  const dates = useMemo(() => {
    const set = new Set<string>([...(today ? [today] : []), ...(data?.sessions ?? [])]);
    if (date) set.add(date);
    return [...set].sort().reverse();
  }, [data, today, date]);

  const chip = (() => {
    if (!status) return { cls: "c-neutral", text: "Checking…" };
    const ago = status.minutesAgo;
    switch (status.state) {
      case "running": return { cls: "c-signal", text: `Logging is running. Last snapshot ${ago} min ago.` };
      case "delayed": return { cls: "", text: `Last snapshot ${ago} min ago. Logging looks delayed.`, warn: true };
      case "not_running": return { cls: "c-danger", text: "Logging is not running: no snapshots yet for this session." };
      case "closed": return { cls: "c-neutral", text: lastFetchMs === null ? "Market closed. No snapshots for this date." : `Market closed. Last snapshot ${etClock(lastFetchMs)} ET.` };
      default: return { cls: "c-neutral", text: lastFetchMs === null ? "Past session. No snapshots logged." : `Past session. Last snapshot ${etClock(lastFetchMs)} ET.` };
    }
  })();

  const hp = hover !== null ? rows[hover] : null;
  const shown = hp ?? last;

  return (
    <div className="jarvis">
      <div className="jv-card mb-4" style={{ borderColor: "var(--verdict-dim)" }}>
        <div className="jv-br-b" />
        <p className="text-sm" style={{ color: "var(--verdict)" }}>
          Log only. No signal yet: both the flow reading (high put/call is bearish) and the contrarian reading (high put/call is bullish) are being recorded and will be scored on forward data.
        </p>
      </div>

      <p className="jv-lede">
        Raw put/call flow recorded every 5 minutes through the regular session for the names below: volume, premium and open interest on the front
        expirations, the volume added since the previous snapshot, and a rough count of trades at the ask or the bid. Each point is plotted at the time
        its snapshot was actually fetched, so a pause in logging shows as a gap rather than being smoothed over.
      </p>

      <div className="jv-card mb-4">
        <div className="jv-br-b" />
        <div className="flex flex-wrap gap-x-6 gap-y-3 items-end">
          <Seg label="Symbol" items={[...OPTION_FLOW_SYMBOLS]} value={symbol} onChange={(s) => { setSymbol(s); setDate(null); }} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="option-flow-date" className="text-xs uppercase tracking-wider" style={{ color: "var(--text-2)" }}>Session</label>
            <select id="option-flow-date" className="jv-select" value={viewing ?? ""} onChange={(e) => setDate(e.target.value === today ? null : e.target.value)}>
              {dates.map((d) => <option key={d} value={d}>{d}{d === today ? " (today)" : ""}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-2)" }}>Status</div>
            <span
              className={`jv-badge ${chip.cls}`}
              role="status"
              style={chip.warn ? { color: "var(--verdict)", borderColor: "var(--verdict-dim)", background: "rgba(240, 168, 104, 0.08)" } : undefined}
            >
              {chip.text}
            </span>
          </div>
          <button type="button" className="jv-btn" onClick={() => void load(false)} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>
      )}

      {data && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            {[
              [String(rows.length), "snapshots logged"],
              [first ? `${etClock(Date.parse(first.actual_fetch_time))} ET` : "–", "first snapshot (fetched)"],
              [last ? `${etClock(Date.parse(last.actual_fetch_time))} ET` : "–", "last snapshot (fetched)"],
              [shown ? ratio(shown.pc_volume) : "–", hp ? `put/call by volume at ${etClock(Date.parse(hp.actual_fetch_time))}` : "put/call by volume, latest"],
              [shown ? ratio(shown.pc_premium) : "–", "put/call by premium"],
              [shown ? ratio(shown.pc_new_volume) : "–", "put/call of new volume"],
              [shown ? ratio(shown.pc_oi) : "–", "put/call by open interest"],
              [shown ? shown.spot.toFixed(2) : "–", `${symbol} spot`],
            ].map(([a, b]) => (
              <div key={b} className="jv-card" style={{ padding: 12 }}>
                <div className="jv-br-b" />
                <div className="font-mono text-lg" style={{ color: "var(--text-0)" }}>{a}</div>
                <div className="text-xs" style={{ color: "var(--text-2)" }}>{b}</div>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="jv-card text-sm" style={{ color: "var(--text-1)" }}>
              No snapshots for {symbol} on {viewing}. The logger runs on weekdays from 9:30 to 16:00 ET once the table exists and the schedule is enabled.
            </div>
          ) : (
            <div className="jv-card">
              <div className="jv-br-b" />
              <Charts rows={rows} hover={hover} setHover={setHover} />
              <p className="text-xs mt-3" style={{ color: "var(--text-2)" }}>
                {hp
                  ? `${etClock(Date.parse(hp.actual_fetch_time))} ET: spot ${hp.spot.toFixed(2)}; cumulative put/call ${ratio(hp.pc_volume)} by volume, ${ratio(hp.pc_premium)} by premium; new-volume put/call ${ratio(hp.pc_new_volume)}.`
                  : "Hover the charts to read a single snapshot. The dashed line is put/call = 1. Bars above the scale are clipped and marked with a triangle."}
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <div className="jv-card">
              <div className="jv-br-b" />
              <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>Raw rows, {symbol} {viewing}</div>
              <div className="overflow-auto" style={{ maxHeight: 420 }}>
                <table className="jv-table">
                  <thead>
                    <tr>
                      <th>Fetched (ET)</th><th>Bucket</th>
                      <th className="jv-num">Spot</th>
                      <th className="jv-num">Call vol</th><th className="jv-num">Put vol</th>
                      <th className="jv-num">P/C vol</th><th className="jv-num">P/C prem</th><th className="jv-num">P/C OI</th>
                      <th className="jv-num">New calls</th><th className="jv-num">New puts</th><th className="jv-num">P/C new</th>
                      <th className="jv-num">Call@ask</th><th className="jv-num">Call@bid</th><th className="jv-num">Put@ask</th><th className="jv-num">Put@bid</th><th className="jv-num">Unclass.</th>
                      <th className="jv-num">IV near</th><th className="jv-num">IV next</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.snapshot_time} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={i === hover ? { background: "var(--ink-800)" } : undefined}>
                        <td>{etClock(Date.parse(r.actual_fetch_time))}</td>
                        <td>{etClock(Date.parse(r.snapshot_time))}</td>
                        <td className="jv-num">{r.spot.toFixed(2)}</td>
                        <td className="jv-num">{int(r.call_volume)}</td><td className="jv-num">{int(r.put_volume)}</td>
                        <td className="jv-num">{ratio(r.pc_volume)}</td><td className="jv-num">{ratio(r.pc_premium)}</td><td className="jv-num">{ratio(r.pc_oi)}</td>
                        <td className="jv-num">{int(r.new_call_volume)}</td><td className="jv-num">{int(r.new_put_volume)}</td><td className="jv-num">{ratio(r.pc_new_volume)}</td>
                        <td className="jv-num">{int(r.agg_call_buy)}</td><td className="jv-num">{int(r.agg_call_sell)}</td><td className="jv-num">{int(r.agg_put_buy)}</td><td className="jv-num">{int(r.agg_put_sell)}</td><td className="jv-num">{int(r.agg_unclassified)}</td>
                        <td className="jv-num">{pct1(r.iv_atm_near)}</td><td className="jv-num">{pct1(r.iv_atm_next)}</td>
                        <td style={{ color: r.flags.some((f) => f !== "first_of_session") ? "var(--verdict)" : "var(--text-2)" }}>{r.flags.join(", ") || "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs mt-3" style={{ color: "var(--text-2)" }}>
                Volume and premium cover the expirations within 10 calendar days (at most 6); open interest covers 45 days. New volume is the change since the
                previous snapshot, clamped at 0 if the provider&apos;s cumulative figure dropped. The ask/bid columns are a crude proxy (the last trade price
                against the quote at snapshot time), not trade-by-trade classification, and volume that cannot be placed is counted as unclassified.
                Premium is volume x mid x 100 at snapshot time. Put/call is blank when there are no calls.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
