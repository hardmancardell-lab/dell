"use client";

import { useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { VwapBandStudyResult } from "@/lib/agents/trading-agent/skills/vwap-band-study";
import type { ForwardRange, GroupSummary } from "@/lib/agents/trading-agent/skills/vwap-band-engine";
import type { SignalLogView, SignalScanResult } from "@/lib/agents/trading-agent/skills/vwap-signal-service";

const DAYS_OPTIONS = [60, 90, 120, 180];
const K_OPTIONS = [1.5, 2, 2.5];
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

const C = {
  signal: "var(--signal)",
  danger: "var(--danger)",
  line: "var(--line)",
  lineB: "var(--line-bright)",
  t0: "var(--text-0)",
  t2: "var(--text-2)",
  mono: "var(--font-mono)",
};

const pct = (v: number | null | undefined, d = 3) => (v === null || v === undefined ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const plain = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "N/A" : `${v.toFixed(d)}%`);

function niceStep(range: number): number {
  const raw = (range || 1) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

/** Average fade return per group with its 95% bootstrap range. Grey = under 15 trades. */
function ReturnForest({ rows }: { rows: GroupSummary[] }) {
  const shown = rows.filter((r) => r.n > 0 && r.avgReturnPct !== null && r.ciLowerPct !== null && r.ciUpperPct !== null);
  if (shown.length === 0) return null;
  const lo = Math.min(...shown.map((r) => r.ciLowerPct as number), 0);
  const hi = Math.max(...shown.map((r) => r.ciUpperPct as number), 0);
  const step = niceStep(hi - lo);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const W = 520, left = 34, right = 24, rowH = 44, H = shown.length * rowH + 36;
  const x = (v: number) => left + ((v - a) / (b - a)) * (W - left - right);
  const ticks: number[] = [];
  for (let v = a; v <= b + step * 1e-6; v += step) ticks.push(Number(v.toFixed(6)));
  // enough decimals that neighbouring ticks never print the same label (forex ranges are tiny)
  const tickDecimals = Math.max(2, Math.ceil(-Math.log10(step)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Average return per trade by volume class with 95% range">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={0} y2={H - 22} style={{ stroke: C.line }} />
          <text x={x(t)} y={H - 6} textAnchor="middle" style={{ fill: C.t2, fontSize: 10, fontFamily: C.mono }}>
            {t > 0 ? "+" : ""}
            {t.toFixed(tickDecimals)}%
          </text>
        </g>
      ))}
      <line x1={x(0)} x2={x(0)} y1={0} y2={H - 22} style={{ stroke: C.lineB, strokeWidth: 1.5 }} />
      {shown.map((r, i) => {
        const cy = i * rowH + 30;
        const color = r.smallSample ? C.t2 : C.signal;
        return (
          <g key={r.label}>
            <text x={0} y={cy - 16} style={{ fill: C.t0, fontSize: 11 }}>
              {r.label} · n = {r.n}
              {r.smallSample ? " · small sample" : ""}
            </text>
            <line x1={x(r.ciLowerPct as number)} x2={x(r.ciUpperPct as number)} y1={cy} y2={cy} style={{ stroke: color, strokeWidth: 3, strokeLinecap: "round" }} />
            <circle cx={x(r.avgReturnPct as number)} cy={cy} r={5} style={{ fill: color }} />
          </g>
        );
      })}
    </svg>
  );
}

function GroupTable({ rows }: { rows: GroupSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
            <th className={TH_CLASS}>Group</th>
            <th className={TH_CLASS}>Trades</th>
            <th className={TH_CLASS}>Reached VWAP</th>
            <th className={TH_CLASS}>Stopped</th>
            <th className={TH_CLASS}>Held to close</th>
            <th className={TH_CLASS}>Avg return</th>
            <th className={TH_CLASS}>95% range</th>
            <th className={TH_CLASS}>Win rate</th>
            <th className={TH_CLASS}>Median hold</th>
          </tr>
        </thead>
        <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderBottom: "1px solid var(--ink-800)", opacity: r.n === 0 ? 0.5 : 1 }}>
              <td className={`${TD_CLASS} font-medium`} style={{ color: "var(--text-0)" }}>
                {r.label}
                {r.smallSample && r.n > 0 && <span className="jv-badge c-neutral" style={{ marginLeft: 8 }}>small sample</span>}
              </td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{r.n}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{plain(r.hitVwapPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{plain(r.stoppedPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{plain(r.heldToCloseOutPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{pct(r.avgReturnPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                {r.ciLowerPct !== null && r.ciUpperPct !== null ? `[${r.ciLowerPct.toFixed(3)}, ${r.ciUpperPct.toFixed(3)}]` : "N/A"}
              </td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{plain(r.winRatePct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                {r.medianHoldBars !== null ? `${r.medianHoldBars} bars (${r.medianHoldBars * 5} min)` : "N/A"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RangeTable({ rows }: { rows: ForwardRange[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
            <th className={TH_CLASS}>After a</th>
            <th className={TH_CLASS}>Horizon</th>
            <th className={TH_CLASS}>Touches</th>
            <th className={TH_CLASS}>Lower (10th pct)</th>
            <th className={TH_CLASS}>Median</th>
            <th className={TH_CLASS}>Mean</th>
            <th className={TH_CLASS}>Upper (90th pct)</th>
            <th className={TH_CLASS}>Moved toward VWAP</th>
          </tr>
        </thead>
        <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
          {rows.map((r) => (
            <tr key={`${r.side}-${r.horizon}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
              <td className={`${TD_CLASS} font-medium`} style={{ color: "var(--text-0)" }}>{r.side === "upper" ? "upper-band touch" : "lower-band touch"}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{r.horizon}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{r.n}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{pct(r.lowerPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{pct(r.medianPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{pct(r.meanPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{pct(r.upperPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{plain(r.towardVwapPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The result panel on its own, so it can be rendered (and tested) without the form or a network call. */
export function VwapBandStudyView({ result }: { result: VwapBandStudyResult }) {
  const gamma = result.gamma && "grossPer1PctUsd" in result.gamma ? result.gamma : null;
  const gammaMsg = result.gamma && "unavailable" in result.gamma ? result.gamma.unavailable : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="text-sm" style={{ color: "var(--text-2)" }}>
        {result.ticker} ({result.assetKind === "forex" ? "London session" : "New York session"}): {result.sessionsTested} session(s) tested after the
        volume baseline, {result.overall.n} band touch(es) at &plusmn;{result.params.k} σ.
        {result.bandWidth && <> Average band half-width &plusmn;{result.bandWidth.meanPct.toFixed(3)}% of VWAP.</>}
      </div>

      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
          What the numbers show
        </div>
        <ul className="text-sm flex flex-col gap-1" style={{ color: "var(--text-1)", paddingLeft: 18, listStyle: "disc" }}>
          {result.readout.map((r) => (
            <li key={r.slice(0, 40)}>{r}</li>
          ))}
        </ul>
      </div>

      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="jv-eyebrow" style={{ marginBottom: 4 }}>
          Does volume at the touch matter?
        </div>
        <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
          Average fade return by volume class
        </div>
        <p className="text-xs mt-1 mb-3" style={{ color: "var(--text-2)" }}>
          Each dot is the average return per trade (short an upper touch, long a lower one) with its 95% bootstrap range. A range that
          crosses zero cannot be told from nothing. Grey means under 15 trades.
        </p>
        <ReturnForest rows={result.byVolumeClass} />
      </div>

      <GroupTable rows={result.byVolumeClass} />
      <GroupTable rows={result.bySide} />

      <div className="jv-card">
        <div className="jv-br-b" />
        <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
          Lower and upper % after a touch, per horizon
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
          Percent change from the touch bar&apos;s close. Lower and upper are the 10th and 90th percentiles, so 80% of outcomes fell between
          them.
        </p>
        <RangeTable rows={result.forwardRanges} />
      </div>

      {gamma && (
        <div className="jv-card">
          <div className="jv-br-b" />
          <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
            Gamma context (a flag, not a gate)
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
            {gamma.note}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="jv-label">Gross dollar gamma per 1% move</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>${(gamma.grossPer1PctUsd / 1e6).toFixed(1)}M</div>
            </div>
            <div>
              <div className="jv-label">As % of a normal day&apos;s dollar volume</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>{gamma.grossPctOfDailyDollarVolume.toFixed(1)}% ({gamma.size})</div>
            </div>
            <div>
              <div className="jv-label">Net, dealers long calls / short puts</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>{gamma.netCommonConventionUsd >= 0 ? "+" : "−"}${(Math.abs(gamma.netCommonConventionUsd) / 1e6).toFixed(1)}M</div>
            </div>
            <div>
              <div className="jv-label">Net, dealers short calls / long puts</div>
              <div className="font-mono" style={{ color: "var(--text-0)" }}>{gamma.netAppConventionUsd >= 0 ? "+" : "−"}${(Math.abs(gamma.netAppConventionUsd) / 1e6).toFixed(1)}M</div>
            </div>
          </div>
        </div>
      )}
      {gammaMsg && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          Gamma context: {gammaMsg}
        </div>
      )}

      {result.dataLimitations.map((d) => (
        <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
          {d}
        </div>
      ))}

      <details className="jv-card">
        <div className="jv-br-b" />
        <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
          Trade log (newest {result.trades.length})
        </summary>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                <th className={TH_CLASS}>Date</th>
                <th className={TH_CLASS}>Touch</th>
                <th className={TH_CLASS}>Entry</th>
                <th className={TH_CLASS}>Volume Z</th>
                <th className={TH_CLASS}>Exit</th>
                <th className={TH_CLASS}>Bars held</th>
                <th className={TH_CLASS}>Fade return</th>
              </tr>
            </thead>
            <tbody>
              {[...result.trades].reverse().map((t, idx) => (
                <tr key={`${t.dateKey}-${t.entryTimeMs}-${idx}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-0)" }}>{t.dateKey}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{t.side}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{t.entryPrice.toFixed(result.assetKind === "forex" ? 3 : 2)}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{t.volumeZ === null ? "N/A" : `${t.volumeZ.toFixed(1)} (${t.volumeClass})`}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{t.exitReason}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{t.barsHeld}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: t.fadeReturnPct >= 0 ? "var(--signal)" : "var(--danger)" }}>{pct(t.fadeReturnPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const timeLabel = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The forward-test log: touches caught as they happen, kept apart from touches found after the fact. */
export function VwapSignalLogView({ log, scan }: { log: SignalLogView | null; scan: SignalScanResult | null }) {
  const s = log?.summary;
  return (
    <div className="flex flex-col gap-4">
      {scan && (
        <div className="jv-card text-sm" style={{ color: "var(--text-2)" }}>
          <div className="jv-br-b" />
          <div style={{ color: "var(--text-0)" }}>
            Scanned {scan.ticker}: {scan.sessionRunning ? `session ${scan.newestSessionDate} is running` : `latest session ${scan.newestSessionDate ?? "N/A"} is finished`};{" "}
            {scan.currentSession.length} band touch{scan.currentSession.length === 1 ? "" : "es"} in it.
          </div>
          {scan.saved && (
            <div className="mt-1">
              Saved {scan.saved.inserted} new, updated {scan.saved.updated}, {scan.saved.unchanged} already logged
              {scan.saved.skippedOld > 0 ? `, ${scan.saved.skippedOld} older touches not logged (they were not seen live)` : ""}.
            </div>
          )}
          {scan.saveNote && <div className="mt-1" style={{ color: "var(--verdict)" }}>{scan.saveNote}</div>}
          {scan.notes.map((n) => (
            <div key={n} className="mt-1">{n}</div>
          ))}
        </div>
      )}

      {log && !log.available && (
        <div className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
          Signal log unavailable: {log.unavailableReason}
        </div>
      )}

      {log && log.available && s && (
        <div className="jv-card">
          <div className="jv-br-b" />
          <div className="jv-label mb-2">Forward test (touches seen live)</div>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <div>
              <div className="jv-label">Logged</div>
              <div className="font-mono" style={{ color: C.t0 }}>{s.total} ({s.open} open, {s.closed} closed)</div>
            </div>
            <div>
              <div className="jv-label">Closed, seen live</div>
              <div className="font-mono" style={{ color: C.t0 }}>{s.live.n} <span style={{ color: C.t2 }}>(+{s.backfillClosed} backfilled, not counted)</span></div>
            </div>
            <div>
              <div className="jv-label">Avg fade return, live</div>
              <div className="font-mono" style={{ color: s.live.smallSample ? C.t2 : C.t0 }}>
                {pct(s.live.avgReturnPct)}
                {s.live.ciLowerPct !== null && s.live.ciUpperPct !== null && (
                  <span style={{ color: C.t2 }}> ({pct(s.live.ciLowerPct)} to {pct(s.live.ciUpperPct)})</span>
                )}
              </div>
            </div>
            <div>
              <div className="jv-label">Win rate / reached VWAP / stopped</div>
              <div className="font-mono" style={{ color: C.t0 }}>{plain(s.live.winRatePct)} / {plain(s.live.targetPct)} / {plain(s.live.stopPct)}</div>
            </div>
          </div>
          <div className="text-xs mt-3" style={{ color: C.t2 }}>{s.note}</div>
        </div>
      )}

      {log && log.available && log.signals.length > 0 && (
        <details className="jv-card">
          <div className="jv-br-b" />
          <summary className="text-sm font-medium cursor-pointer" style={{ color: C.t0 }}>
            Saved signals (newest {log.signals.length})
          </summary>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: C.t2, borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className={TH_CLASS}>Entry</th>
                  <th className={TH_CLASS}>Symbol</th>
                  <th className={TH_CLASS}>Touch</th>
                  <th className={TH_CLASS}>Volume Z</th>
                  <th className={TH_CLASS}>Seen</th>
                  <th className={TH_CLASS}>Status</th>
                  <th className={TH_CLASS}>Fade return</th>
                </tr>
              </thead>
              <tbody>
                {log.signals.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: C.t0 }}>{timeLabel(r.entryTimeMs)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: C.t2 }}>{r.symbol}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: C.t2 }}>{r.side}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: C.t2 }}>{r.volumeZ === null ? "N/A" : `${r.volumeZ.toFixed(1)} (${r.volumeClass})`}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: C.t2 }}>{r.source === "live" ? `live (+${r.detectedLagMin}m)` : `backfill (+${r.detectedLagMin}m)`}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: C.t2 }}>{r.status === "open" ? "open" : r.exitReason}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: r.status === "open" ? C.t2 : r.fadeReturnPct >= 0 ? C.signal : C.danger }}>
                      {pct(r.fadeReturnPct)}{r.status === "open" ? " (marked)" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Intraday VWAP band study: what happened after price touched session VWAP +/- k sigma, split by the volume
 * Z-score at the touch, with exit-based trades and the lower/upper range per horizon. Research only: it reports
 * history, it never places or proposes an order. Works for equities (NY session) and forex pairs (London
 * session, OANDA tick volume).
 */
export function VwapBandStudyTab({ defaultTicker = "SPY" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [days, setDays] = useState(90);
  const [k, setK] = useState(2);
  const [logVolume, setLogVolume] = useState(false);
  const [result, setResult] = useState<VwapBandStudyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<SignalLogView | null>(null);
  const [scan, setScan] = useState<SignalScanResult | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const { track } = useTrackEvent();

  async function loadLog() {
    setLogBusy(true);
    setLogError(null);
    try {
      const res = await fetch(`/api/vwap-signals?ticker=${encodeURIComponent(ticker.trim())}`);
      const json = await res.json();
      if (!res.ok) setLogError(json.error ?? "Unknown error");
      else setLog(json as SignalLogView);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLogBusy(false);
    }
  }

  async function scanNow() {
    if (!ticker.trim()) return;
    setLogBusy(true);
    setLogError(null);
    try {
      const res = await fetch("/api/vwap-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: ticker.trim(), k, logVolume }),
      });
      const json = await res.json();
      if (!res.ok) {
        setLogError(json.error ?? "Unknown error");
      } else {
        setScan(json as SignalScanResult);
        track("backtest_run", { tab: "Backtest", symbol: ticker, metadata: { study: "vwap-signal-scan", k, logVolume } });
        const logRes = await fetch(`/api/vwap-signals?ticker=${encodeURIComponent(ticker.trim())}`);
        if (logRes.ok) setLog((await logRes.json()) as SignalLogView);
      }
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLogBusy(false);
    }
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/vwap-band-study?ticker=${encodeURIComponent(ticker.trim())}&days=${days}&k=${k}&logVolume=${logVolume}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Backtest", symbol: ticker, metadata: { endpoint: "vwap-band-study", status: res.status } });
      } else {
        setResult(json as VwapBandStudyResult);
        track("backtest_run", { tab: "Backtest", symbol: ticker, metadata: { study: "vwap-band-study", days, k, logVolume } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Backtest", symbol: ticker, metadata: { endpoint: "vwap-band-study", status: 0 } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Walks real 5-minute bars session by session and measures what happened after price touched today&apos;s VWAP &plusmn; k standard
        deviations, split by how unusual the volume was at that moment (a Z-score against the same time of day over the prior 20
        sessions). Trades are simulated to VWAP, a stop at 3 standard deviations, or the close. It reports history only: nothing here
        places or suggests an order, and results are before spread, slippage and fees.
      </p>

      <form onSubmit={run} className="flex flex-wrap gap-3 mb-6 items-center">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="SPY or GBP/JPY" className="jv-input w-36" aria-label="Ticker or forex pair" />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="jv-select" aria-label="Lookback days">
          {DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
        <select value={k} onChange={(e) => setK(Number(e.target.value))} className="jv-select" aria-label="Band width in standard deviations">
          {K_OPTIONS.map((v) => (
            <option key={v} value={v}>
              &plusmn;{v} σ band
            </option>
          ))}
        </select>
        <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={logVolume} onChange={(e) => setLogVolume(e.target.checked)} />
          Z-score on log volume
        </label>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run VWAP Band Study"}
        </button>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && <VwapBandStudyView result={result} />}

      <div className="mt-8 flex flex-col gap-3">
        <div className="jv-label">Signal log (forward test)</div>
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Scanning looks at the latest bars, records any band touch, and later fills in how it ended. A touch counts as seen live only if the
          scan caught it within {10} minutes; anything found later is saved as backfill and kept out of the results. It logs research
          signals only and places no orders.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <button type="button" onClick={scanNow} disabled={logBusy} className="jv-btn">
            {logBusy ? "Working…" : "Scan now and log"}
          </button>
          <button type="button" onClick={loadLog} disabled={logBusy} className="jv-btn">
            Show saved log
          </button>
        </div>
        {logError && (
          <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            {logError}
          </div>
        )}
        {(log || scan) && <VwapSignalLogView log={log} scan={scan} />}
      </div>
    </div>
  );
}
