"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { computeJournalPositionMetrics, journalMultiplier } from "@/lib/agents/trading-agent/skills/journal-log";
import {
  JOURNAL_EMOTION_TAGS,
  JOURNAL_MISTAKE_TAGS,
  JOURNAL_STRATEGY_TAGS,
} from "@/lib/agents/trading-agent/types";
import type {
  JournalAnalytics,
  JournalEmotionTag,
  JournalInstrumentType,
  JournalPosition,
  JournalSource,
} from "@/lib/agents/trading-agent/types";

const inputStyle = {
  background: "var(--ink-900)",
  border: "1px solid var(--line)",
  color: "var(--text-0)",
  fontFamily: "var(--font-mono)",
} as const;

const selectStyle = { background: "var(--ink-900)", border: "1px solid var(--line)", color: "var(--text-0)" } as const;

function fmtMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function fmtR(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(0)}%`;
}

function pnlColor(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "var(--text-2)";
  return n >= 0 ? "var(--signal)" : "var(--danger)";
}

function positionLabel(p: JournalPosition): string {
  if (p.instrumentType === "shares") return `${p.ticker} shares`;
  return `${p.ticker} $${p.strikePrice} ${p.instrumentType === "call" ? "Call" : "Put"} · exp ${p.expirationDate}`;
}

function strategyLabel(p: JournalPosition): string {
  if (p.strategy === "other" && p.strategyOther) return p.strategyOther;
  return JOURNAL_STRATEGY_TAGS.find((s) => s.value === p.strategy)?.label ?? p.strategy;
}

const STRATEGY_PLAYBOOK: { value: string; label: string; definition: string; whereToBacktest: string }[] = [
  {
    value: "event_catalyst",
    label: "Event / Volatility Catalyst",
    definition: "A specific, dated catalyst (earnings, lockup expiration, FDA decision, macro print) is expected to move the underlying or its implied vol.",
    whereToBacktest: "Options → Dashboard (GEX Signal, IV term structure) and Currency/Futures Macro Drivers for the news side.",
  },
  {
    value: "pm_volume_momentum",
    label: "Premarket Volume Momentum",
    definition: "Unusual premarket volume relative to its rolling average, used as an early signal of a move that may continue into the session.",
    whereToBacktest: "Equities → Dashboard (PM-Volume Anomaly scan) and Backtest tab (Volume Displacement signal).",
  },
  {
    value: "weekly_swing",
    label: "Weekly Swing",
    definition: "A multi-day directional position sized around a weekly thesis rather than an intraday trigger.",
    whereToBacktest: "Equities → Calendar Effects (day-of-week) and ORB Strategy tabs.",
  },
  {
    value: "mean_reversion",
    label: "Mean Reversion",
    definition: "Price has moved statistically far from its rolling mean (z-score) with no fresh catalyst — bet on reversion toward the mean.",
    whereToBacktest: "Equities/Currency/Futures/Commodities → Backtest tab (Mean Reversion Oversold/Overbought signal).",
  },
  {
    value: "hedge",
    label: "Hedge / Risk Offset",
    definition: "Taken to offset risk in another position (e.g. a call bought against event risk on a name you're structurally bearish, or vice versa) — sized by the risk being offset, not by directional conviction alone.",
    whereToBacktest: "Options → Strategy Guide (collar/protective-put patterns) and this app's payoff calculator.",
  },
];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${url} failed.`);
  return data;
}

export function TradeJournalTab() {
  const [positions, setPositions] = useState<JournalPosition[] | null>(null);
  const [analytics, setAnalytics] = useState<JournalAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlaybook, setShowPlaybook] = useState(false);

  // Log-trade form state
  const [ticker, setTicker] = useState("");
  const [instrumentType, setInstrumentType] = useState<JournalInstrumentType>("call");
  const [source, setSource] = useState<JournalSource>("live");
  const [strikePrice, setStrikePrice] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [strategy, setStrategy] = useState(JOURNAL_STRATEGY_TAGS[0].value);
  const [strategyOther, setStrategyOther] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [emotionTag, setEmotionTag] = useState<JournalEmotionTag | "">("");
  const [quantity, setQuantity] = useState("1");
  const [entryPrice, setEntryPrice] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [thesis, setThesis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [posData, analyticsData] = await Promise.all([
        fetchJson<{ positions: JournalPosition[] }>("/api/journal"),
        fetchJson<{ analytics: JournalAnalytics }>("/api/journal/analytics"),
      ]);
      setPositions(posData.positions);
      setAnalytics(analyticsData.analytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await fetchJson("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          instrumentType,
          source,
          strikePrice: instrumentType === "shares" ? null : Number(strikePrice),
          expirationDate: instrumentType === "shares" ? null : expirationDate,
          strategy,
          strategyOther: strategy === "other" ? strategyOther.trim() || null : null,
          stopLoss: stopLoss ? Number(stopLoss) : null,
          targetPrice: targetPrice ? Number(targetPrice) : null,
          emotionTag: emotionTag || null,
          quantity: Number(quantity),
          entryPrice: Number(entryPrice),
          entryDate: entryDate ? new Date(entryDate).toISOString() : undefined,
          thesis: thesis.trim() || null,
        }),
      });
      setTicker("");
      setStrikePrice("");
      setExpirationDate("");
      setStopLoss("");
      setTargetPrice("");
      setEmotionTag("");
      setQuantity("1");
      setEntryPrice("");
      setEntryDate("");
      setThesis("");
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  const open = positions?.filter((p) => p.status === "open") ?? [];

  const equityCurveData = useMemo(
    () => analytics?.equityCurve.map((pt, i) => ({ trade: i + 1, cumulativePnl: pt.cumulativePnl, date: pt.date })) ?? [],
    [analytics]
  );

  const strategyLeaderboard = useMemo(() => (analytics ? [...analytics.byStrategy].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1)) : []), [analytics]);

  type GridRow = {
    id: string;
    ticker: string;
    instrument: string;
    strike: number | null;
    expiration: string | null;
    source: JournalSource;
    strategy: string;
    status: string;
    qtyOpen: number;
    avgEntry: number | null;
    stopLoss: number | null;
    targetPrice: number | null;
    realizedPnl: number;
    realizedR: number | null;
    result: string;
    followedPlan: boolean | null;
    emotion: string;
    opened: string;
    closed: string | null;
  };

  const gridRows = useMemo<GridRow[]>(() => {
    if (!positions) return [];
    return positions.map((p) => {
      const m = computeJournalPositionMetrics(p.fills, p.instrumentType, p.stopLoss);
      return {
        id: p.id,
        ticker: p.ticker,
        instrument: p.instrumentType,
        strike: p.strikePrice,
        expiration: p.expirationDate,
        source: p.source,
        strategy: strategyLabel(p),
        status: p.status,
        qtyOpen: m.openQuantity,
        avgEntry: m.avgEntryPrice,
        stopLoss: p.stopLoss,
        targetPrice: p.targetPrice,
        realizedPnl: m.realizedPnl,
        realizedR: m.realizedR,
        result: p.status === "open" ? "Open" : m.realizedPnl > 0 ? "Win" : m.realizedPnl < 0 ? "Loss" : "Flat",
        followedPlan: p.followedPlan,
        emotion: p.emotionTag ?? "—",
        opened: p.openedAt,
        closed: p.closedAt,
      };
    });
  }, [positions]);

  const GRID_COLUMNS: { key: keyof GridRow; label: string }[] = [
    { key: "ticker", label: "Ticker" },
    { key: "instrument", label: "Type" },
    { key: "strike", label: "Strike" },
    { key: "expiration", label: "Exp" },
    { key: "source", label: "Source" },
    { key: "strategy", label: "Strategy" },
    { key: "status", label: "Status" },
    { key: "qtyOpen", label: "Qty Open" },
    { key: "avgEntry", label: "Avg Entry" },
    { key: "stopLoss", label: "Stop" },
    { key: "targetPrice", label: "Target" },
    { key: "realizedPnl", label: "Realized P&L" },
    { key: "realizedR", label: "R" },
    { key: "result", label: "Result" },
    { key: "followedPlan", label: "Followed Plan" },
    { key: "emotion", label: "Emotion" },
    { key: "opened", label: "Opened" },
    { key: "closed", label: "Closed" },
  ];

  const [sortKey, setSortKey] = useState<keyof GridRow>("opened");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterStrategy, setFilterStrategy] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");

  function toggleSort(key: keyof GridRow) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const strategyOptions = useMemo(() => Array.from(new Set(gridRows.map((r) => r.strategy))).sort(), [gridRows]);

  const visibleRows = useMemo(() => {
    let rows = gridRows;
    if (filterStrategy !== "all") rows = rows.filter((r) => r.strategy === filterStrategy);
    if (filterStatus !== "all") rows = rows.filter((r) => r.status === filterStatus);
    if (filterSource !== "all") rows = rows.filter((r) => r.source === filterSource);
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      if (typeof av === "boolean" && typeof bv === "boolean") return av === bv ? 0 : av ? -1 : 1;
      return String(av).localeCompare(String(bv));
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [gridRows, filterStrategy, filterStatus, filterSource, sortKey, sortDir]);

  function downloadCsv() {
    const headers = GRID_COLUMNS.map((c) => c.label);
    const lines = [headers.join(",")];
    for (const row of visibleRows) {
      const cells = GRID_COLUMNS.map((c) => {
        const v = row[c.key];
        const s = v === null || v === undefined ? "" : String(v);
        return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="jarvis flex flex-col gap-8">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Your real trades — logged with a thesis and a stop before entry, and an honest account of what happened
        after. Modeled on the professional-journal genre (Edgewonk/TradeZella/Tradervue): risk defined in R before
        you enter, strategy-labeled results, and the patterns in your own data — not a broker connection, and no
        orders are placed from here.
      </p>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="font-medium">Could not load journal</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {loading && <p style={{ color: "var(--text-2)" }}>Loading journal…</p>}

      {analytics && analytics.closedCount > 0 && (
        <div>
          <div className="jv-label mb-3">Performance — Risk Management Scorecard</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="jv-card jv-br-b">
              <div className="jv-label">Win Rate ({analytics.closedCount} closed)</div>
              <div className="jv-stat">{fmtPct(analytics.winRate)}</div>
            </div>
            <div className="jv-card jv-br-b">
              <div className="jv-label">Expectancy</div>
              <div className="jv-stat" style={{ color: pnlColor(analytics.expectancyR) }}>
                {fmtR(analytics.expectancyR)}
              </div>
            </div>
            <div className="jv-card jv-br-b">
              <div className="jv-label">Profit Factor</div>
              <div className="jv-stat">{analytics.profitFactorR !== null ? analytics.profitFactorR.toFixed(2) : "—"}</div>
            </div>
            <div className="jv-card jv-br-b">
              <div className="jv-label">Total Realized P&amp;L</div>
              <div className="jv-stat" style={{ color: pnlColor(analytics.totalRealizedPnl) }}>
                {fmtMoney(analytics.totalRealizedPnl)}
              </div>
            </div>
            <div className="jv-card jv-br-b">
              <div className="jv-label">Avg Win / Avg Loss</div>
              <div className="jv-stat">
                {fmtR(analytics.avgWinR)} / {fmtR(analytics.avgLossR)}
              </div>
            </div>
            <div className="jv-card jv-br-b">
              <div className="jv-label">Current Streak</div>
              <div className="jv-stat" style={{ color: analytics.currentStreak.type === "win" ? "var(--signal)" : analytics.currentStreak.type === "loss" ? "var(--danger)" : "var(--text-0)" }}>
                {analytics.currentStreak.type ? `${analytics.currentStreak.count} ${analytics.currentStreak.type}${analytics.currentStreak.count > 1 ? "s" : ""}` : "—"}
              </div>
            </div>
            <div className="jv-card jv-br-b">
              <div className="jv-label">Plan Adherence</div>
              <div className="jv-stat">{fmtPct(analytics.planAdherenceRate)}</div>
            </div>
            <div className="jv-card jv-br-b">
              <div className="jv-label">No-Stop Rate</div>
              <div className="jv-stat" style={{ color: analytics.noStopRate && analytics.noStopRate > 0 ? "var(--danger)" : "var(--signal)" }}>
                {fmtPct(analytics.noStopRate)}
              </div>
            </div>
          </div>

          {strategyLeaderboard.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <div className="jv-label mb-2">Strategy Win Rates (ranked)</div>
              <table className="jv-table">
                <thead>
                  <tr>
                    {["Rank", "Strategy", "Trades", "Win %", "Expectancy", "Total P&L"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {strategyLeaderboard.map((s, i) => (
                    <tr key={s.strategy}>
                      <td className="jv-num">{i + 1}</td>
                      <td className="font-medium">{s.strategy}</td>
                      <td className="jv-num">{s.count}</td>
                      <td className="jv-num" style={{ color: s.winRate !== null && s.winRate >= 50 ? "var(--signal)" : "var(--danger)" }}>
                        {fmtPct(s.winRate)}
                      </td>
                      <td className="jv-num" style={{ color: pnlColor(s.expectancyR) }}>
                        {fmtR(s.expectancyR)}
                      </td>
                      <td className="jv-num" style={{ color: pnlColor(s.totalRealizedPnl) }}>
                        {fmtMoney(s.totalRealizedPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {equityCurveData.length > 1 && (
            <div className="jv-card mb-4" style={{ height: 220 }}>
              <div className="jv-label mb-2">Equity Curve (cumulative realized P&amp;L)</div>
              <ResponsiveContainer width="100%" height="85%">
                <LineChart data={equityCurveData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="trade" tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" tickFormatter={(v) => fmtMoney(Number(v))} width={90} />
                  <Tooltip
                    formatter={(v) => fmtMoney(Number(v))}
                    labelFormatter={(t) => `Trade #${t}`}
                    contentStyle={{ background: "var(--ink-800)", border: "1px solid var(--line-bright)", color: "var(--text-0)", fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="cumulativePnl" stroke="var(--signal)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="overflow-x-auto">
              <div className="jv-label mb-2">By Day of Week</div>
              <table className="jv-table">
                <thead>
                  <tr>
                    {["Day", "N", "Win %", "Avg R"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analytics.byDayOfWeek.map((d) => (
                    <tr key={d.dayOfWeek}>
                      <td>{d.dayOfWeek}</td>
                      <td className="jv-num">{d.count}</td>
                      <td className="jv-num">{fmtPct(d.winRate)}</td>
                      <td className="jv-num" style={{ color: pnlColor(d.avgR) }}>
                        {fmtR(d.avgR)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <div className="jv-label mb-2">By Emotion at Entry</div>
              <table className="jv-table">
                <thead>
                  <tr>
                    {["Emotion", "N", "Win %", "Avg R"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analytics.byEmotion.map((em) => (
                    <tr key={em.emotion}>
                      <td className="capitalize">{em.emotion}</td>
                      <td className="jv-num">{em.count}</td>
                      <td className="jv-num">{fmtPct(em.winRate)}</td>
                      <td className="jv-num" style={{ color: pnlColor(em.avgR) }}>
                        {fmtR(em.avgR)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {analytics.mistakeFrequency.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <div className="jv-label mb-2">Mistake Frequency</div>
              <table className="jv-table">
                <thead>
                  <tr>
                    {["Mistake", "Times", "Total P&L Impact"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analytics.mistakeFrequency.map((m) => (
                    <tr key={m.mistake}>
                      <td>{m.mistake}</td>
                      <td className="jv-num">{m.count}</td>
                      <td className="jv-num" style={{ color: pnlColor(m.totalPnlImpact) }}>
                        {fmtMoney(m.totalPnlImpact)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {analytics.dataLimitations.length > 0 && (
            <div className="jv-card" style={{ borderColor: "var(--verdict)" }}>
              {analytics.dataLimitations.map((d, i) => (
                <p key={i} className="text-sm" style={{ color: "var(--verdict)" }}>
                  {d}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="jv-card">
        <button onClick={() => setShowPlaybook((v) => !v)} className="jv-label" style={{ cursor: "pointer" }}>
          {showPlaybook ? "▾" : "▸"} Strategy Playbook — what each label means &amp; where to backtest it
        </button>
        {showPlaybook && (
          <div className="mt-3 flex flex-col gap-3">
            {STRATEGY_PLAYBOOK.map((s) => (
              <div key={s.value}>
                <div className="font-medium text-sm">{s.label}</div>
                <div className="text-sm" style={{ color: "var(--text-1)" }}>
                  {s.definition}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                  Backtest it: {s.whereToBacktest}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="jv-card">
        <div className="jv-label mb-3">Log a New Trade</div>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. SPCX" required className="px-3 py-2 text-sm" style={inputStyle} />
          <select value={instrumentType} onChange={(e) => setInstrumentType(e.target.value as JournalInstrumentType)} className="px-3 py-2 text-sm" style={selectStyle}>
            <option value="call">Call</option>
            <option value="put">Put</option>
            <option value="shares">Shares</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as JournalSource)} className="px-3 py-2 text-sm" style={selectStyle}>
            <option value="live">Live (real broker)</option>
            <option value="paper">Paper Trading practice</option>
          </select>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="px-3 py-2 text-sm" style={selectStyle}>
            {JOURNAL_STRATEGY_TAGS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {strategy === "other" && (
            <input value={strategyOther} onChange={(e) => setStrategyOther(e.target.value)} placeholder="Name your strategy" className="px-3 py-2 text-sm col-span-2" style={inputStyle} />
          )}
          {instrumentType !== "shares" && (
            <input value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} type="number" step="0.5" placeholder="Strike" required className="px-3 py-2 text-sm" style={inputStyle} />
          )}
          {instrumentType !== "shares" && (
            <input value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} type="date" required className="px-3 py-2 text-sm" style={inputStyle} />
          )}
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            type="number"
            min="1"
            step="1"
            placeholder={instrumentType === "shares" ? "Shares" : "Contracts"}
            required
            className="px-3 py-2 text-sm"
            style={inputStyle}
          />
          <input value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} type="number" step="0.01" placeholder="Entry price" required className="px-3 py-2 text-sm" style={inputStyle} />
          <input
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            type="number"
            step="0.01"
            placeholder="Stop-loss price (defines 1R)"
            className="px-3 py-2 text-sm"
            style={inputStyle}
          />
          <input value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} type="number" step="0.01" placeholder="Target price" className="px-3 py-2 text-sm" style={inputStyle} />
          <select value={emotionTag} onChange={(e) => setEmotionTag(e.target.value as JournalEmotionTag | "")} className="px-3 py-2 text-sm" style={selectStyle}>
            <option value="">Emotion at entry…</option>
            {JOURNAL_EMOTION_TAGS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
          <input value={entryDate} onChange={(e) => setEntryDate(e.target.value)} type="datetime-local" placeholder="Entry time (default now)" className="px-3 py-2 text-sm" style={inputStyle} />
          <textarea
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="Thesis — why you're taking this trade, going in"
            className="px-3 py-2 text-sm col-span-2 sm:col-span-4"
            style={{ ...inputStyle, fontFamily: "inherit", minHeight: 60 }}
          />
          <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--signal)", color: "var(--ink-950)" }}>
            {submitting ? "Logging…" : "Log Trade"}
          </button>
        </form>
        {!stopLoss && (
          <p className="text-xs mt-2" style={{ color: "var(--verdict)" }}>
            No stop-loss set — you can still log this trade, but R-multiple/expectancy won&apos;t be computable for it. Every top journal (Edgewonk
            especially) treats a missing stop as the single biggest risk-management red flag.
          </p>
        )}
        {submitError && (
          <p className="text-sm mt-2" style={{ color: "var(--danger)" }}>
            {submitError}
          </p>
        )}
      </div>

      {open.length > 0 && (
        <div>
          <div className="jv-label mb-3">Open Positions</div>
          <div className="flex flex-col gap-4">
            {open.map((p) => (
              <OpenPositionCard key={p.id} position={p} onChange={refresh} />
            ))}
          </div>
        </div>
      )}

      {gridRows.length > 0 && (
        <div>
          <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
            <div className="jv-label">All Positions ({visibleRows.length}/{gridRows.length})</div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={filterStrategy} onChange={(e) => setFilterStrategy(e.target.value)} className="px-2 py-1 text-xs" style={selectStyle}>
                <option value="all">All strategies</option>
                {strategyOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-2 py-1 text-xs" style={selectStyle}>
                <option value="all">Open + Closed</option>
                <option value="open">Open only</option>
                <option value="closed">Closed only</option>
              </select>
              <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="px-2 py-1 text-xs" style={selectStyle}>
                <option value="all">Live + Paper</option>
                <option value="live">Live only</option>
                <option value="paper">Paper only</option>
              </select>
              <button onClick={downloadCsv} className="jv-btn-outline text-xs px-3 py-1">
                Export CSV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="jv-table">
              <thead>
                <tr>
                  {GRID_COLUMNS.map((c) => (
                    <th key={c.key} onClick={() => toggleSort(c.key)} style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
                      {c.label}
                      {sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.ticker}</td>
                    <td className="capitalize text-xs">{r.instrument}</td>
                    <td className="jv-num">{r.strike ?? "—"}</td>
                    <td className="text-xs" style={{ color: "var(--text-2)" }}>
                      {r.expiration ?? "—"}
                    </td>
                    <td>
                      <span className={`jv-badge ${r.source === "live" ? "c-signal" : "c-neutral"}`}>{r.source === "live" ? "Live" : "Paper"}</span>
                    </td>
                    <td className="text-xs">{r.strategy}</td>
                    <td className="text-xs capitalize">{r.status}</td>
                    <td className="jv-num">{r.qtyOpen}</td>
                    <td className="jv-num">{r.avgEntry !== null ? r.avgEntry.toFixed(2) : "—"}</td>
                    <td className="jv-num">{r.stopLoss ?? "—"}</td>
                    <td className="jv-num">{r.targetPrice ?? "—"}</td>
                    <td className="jv-num" style={{ color: pnlColor(r.realizedPnl) }}>
                      {fmtMoney(r.realizedPnl)}
                    </td>
                    <td className="jv-num" style={{ color: pnlColor(r.realizedR) }}>
                      {fmtR(r.realizedR)}
                    </td>
                    <td>
                      <span className={`jv-badge ${r.result === "Win" ? "c-signal" : r.result === "Loss" ? "c-danger" : "c-neutral"}`}>{r.result}</span>
                    </td>
                    <td className="text-xs">{r.followedPlan === null ? "—" : r.followedPlan ? "Yes" : "No"}</td>
                    <td className="text-xs capitalize">{r.emotion}</td>
                    <td className="text-xs" style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>
                      {new Date(r.opened).toLocaleDateString()}
                    </td>
                    <td className="text-xs" style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>
                      {r.closed ? new Date(r.closed).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {positions && positions.length === 0 && !loading && <p style={{ color: "var(--text-2)" }}>No trades logged yet — use the form above to log your first one.</p>}
    </div>
  );
}

function OpenPositionCard({ position, onChange }: { position: JournalPosition; onChange: () => void }) {
  const [fillSide, setFillSide] = useState<"buy" | "sell">("sell");
  const [fillQty, setFillQty] = useState("");
  const [fillPrice, setFillPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const [followedPlan, setFollowedPlan] = useState<boolean | null>(position.followedPlan);
  const [mistakeTags, setMistakeTags] = useState<string[]>(position.mistakeTags);
  const [notes, setNotes] = useState(position.notes ?? "");
  const [savingReview, setSavingReview] = useState(false);

  const metrics = computeJournalPositionMetrics(position.fills, position.instrumentType, position.stopLoss);
  const multiplier = journalMultiplier(position.instrumentType);

  async function submitFill() {
    setBusy(true);
    setFillError(null);
    try {
      await fetchJson(`/api/journal/${position.id}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side: fillSide, quantity: Number(fillQty), price: Number(fillPrice) }),
      });
      setFillQty("");
      setFillPrice("");
      onChange();
    } catch (err) {
      setFillError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function saveReview() {
    setSavingReview(true);
    try {
      await fetchJson(`/api/journal/${position.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followedPlan, mistakeTags, notes: notes.trim() || null }),
      });
      onChange();
    } catch {
      // surfaced via the top-level error boundary on next refresh if it persists
    } finally {
      setSavingReview(false);
    }
  }

  function toggleMistake(tag: string) {
    setMistakeTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <div className="jv-card">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div>
          <div className="font-medium">{positionLabel(position)}</div>
          <div className="text-xs" style={{ color: "var(--text-2)" }}>
            {strategyLabel(position)} · <span className={`jv-badge ${position.source === "live" ? "c-signal" : "c-neutral"}`}>{position.source === "live" ? "Live" : "Paper"}</span>
            {position.emotionTag && <> · {position.emotionTag}</>}
          </div>
        </div>
        <div className="text-right">
          <div className="jv-num">{metrics.openQuantity} open</div>
          <div className="text-xs" style={{ color: "var(--text-2)" }}>
            avg {metrics.avgEntryPrice !== null ? metrics.avgEntryPrice.toFixed(2) : "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
        <div>
          <div className="jv-label">Stop</div>
          <div>{position.stopLoss ?? "—"}</div>
        </div>
        <div>
          <div className="jv-label">Target</div>
          <div>{position.targetPrice ?? "—"}</div>
        </div>
        <div>
          <div className="jv-label">Planned Risk</div>
          <div>{fmtMoney(metrics.plannedRiskAmount)}</div>
        </div>
        <div>
          <div className="jv-label">Cost Basis Open</div>
          <div>{fmtMoney(position.fills.reduce((s, f) => (f.side === "buy" ? s + f.quantity : s), 0) > 0 ? metrics.costBasisOpen : null)}</div>
        </div>
      </div>

      {position.thesis && (
        <div className="mt-3 text-sm">
          <div className="jv-label">Thesis</div>
          <div style={{ color: "var(--text-1)" }}>{position.thesis}</div>
        </div>
      )}

      <div className="mt-3 text-xs" style={{ color: "var(--text-2)" }}>
        Fills: {position.fills.map((f) => `${f.side} ${f.quantity} @ ${f.price.toFixed(2)}`).join(" · ")}
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="jv-label mb-2">Add a Fill (average in, take a partial, or close)</div>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={fillSide} onChange={(e) => setFillSide(e.target.value as "buy" | "sell")} className="px-2 py-1 text-xs" style={selectStyle}>
            <option value="buy">Buy (add)</option>
            <option value="sell">Sell (reduce/close)</option>
          </select>
          <input value={fillQty} onChange={(e) => setFillQty(e.target.value)} type="number" step="1" placeholder="Qty" className="px-2 py-1 text-xs w-20" style={inputStyle} />
          <input value={fillPrice} onChange={(e) => setFillPrice(e.target.value)} type="number" step="0.01" placeholder="Price" className="px-2 py-1 text-xs w-24" style={inputStyle} />
          <button onClick={submitFill} disabled={busy || !fillQty || !fillPrice} className="jv-btn-outline text-xs px-3 py-1 disabled:opacity-50">
            {busy ? "Submitting…" : "Add Fill"}
          </button>
          {fillSide === "sell" && (
            <button
              onClick={() => {
                setFillQty(String(metrics.openQuantity));
              }}
              className="text-xs"
              style={{ color: "var(--text-2)" }}
            >
              (fill full remaining qty)
            </button>
          )}
        </div>
        {fillError && (
          <p className="text-xs mt-1" style={{ color: "var(--danger)" }}>
            {fillError}
          </p>
        )}
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="jv-label mb-2">Review — what really happened</div>
        <div className="flex flex-wrap gap-3 items-center mb-2 text-xs">
          <span style={{ color: "var(--text-2)" }}>Followed plan?</span>
          <button onClick={() => setFollowedPlan(true)} className={followedPlan === true ? "jv-btn text-xs px-2 py-1" : "jv-btn-outline text-xs px-2 py-1"}>
            Yes
          </button>
          <button onClick={() => setFollowedPlan(false)} className={followedPlan === false ? "jv-btn text-xs px-2 py-1" : "jv-btn-outline text-xs px-2 py-1"}>
            No
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {JOURNAL_MISTAKE_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleMistake(tag)}
              className="text-xs px-2 py-1"
              style={{
                border: "1px solid var(--line)",
                background: mistakeTags.includes(tag) ? "var(--danger)" : "transparent",
                color: mistakeTags.includes(tag) ? "var(--ink-950)" : "var(--text-2)",
              }}
            >
              {tag}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What really happened — honest post-trade notes"
          className="px-3 py-2 text-sm w-full"
          style={{ ...inputStyle, fontFamily: "inherit", minHeight: 50 }}
        />
        <button onClick={saveReview} disabled={savingReview} className="jv-btn-outline text-xs px-3 py-1 mt-2 disabled:opacity-50">
          {savingReview ? "Saving…" : "Save Review"}
        </button>
      </div>
    </div>
  );
}
