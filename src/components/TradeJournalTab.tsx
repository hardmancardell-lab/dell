"use client";

import { useEffect, useState } from "react";
import { journalMultiplier } from "@/lib/agents/trading-agent/skills/journal-log";
import type { JournalEntry, JournalInstrumentType } from "@/lib/agents/trading-agent/types";

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

function pnlColor(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "var(--text-2)";
  return n >= 0 ? "var(--signal)" : "var(--danger)";
}

function costBasis(entry: JournalEntry): number {
  return entry.quantity * entry.entryPrice * journalMultiplier(entry.instrumentType);
}

function label(entry: JournalEntry): string {
  if (entry.instrumentType === "shares") return `${entry.ticker} shares`;
  return `${entry.ticker} $${entry.strikePrice} ${entry.instrumentType === "call" ? "Call" : "Put"} · exp ${entry.expirationDate}`;
}

/**
 * A real, manually-entered log of the user's own discretionary trades placed
 * at their real broker — distinct from Paper Trading (this app's simulated
 * account) and the Strategy Ledger (automated hypothesis sweeps). No order
 * execution happens here; it's a record of what was traded, why, and the
 * real realized P&L once closed.
 */
export function TradeJournalTab() {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ticker, setTicker] = useState("");
  const [instrumentType, setInstrumentType] = useState<JournalInstrumentType>("call");
  const [strikePrice, setStrikePrice] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [entryPrice, setEntryPrice] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [thesis, setThesis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [exitBusy, setExitBusy] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/journal");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load journal.");
      setEntries(data.entries as JournalEntry[]);
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
      const body = {
        ticker: ticker.trim().toUpperCase(),
        instrumentType,
        strikePrice: instrumentType === "shares" ? null : Number(strikePrice),
        expirationDate: instrumentType === "shares" ? null : expirationDate,
        quantity: Number(quantity),
        entryPrice: Number(entryPrice),
        entryDate: entryDate ? new Date(entryDate).toISOString() : undefined,
        thesis: thesis.trim() || null,
      };
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log trade.");
      setTicker("");
      setStrikePrice("");
      setExpirationDate("");
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

  async function handleClose(id: string) {
    setExitBusy(true);
    try {
      const res = await fetch(`/api/journal/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitPrice: Number(exitPrice) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to close trade.");
      setClosingId(null);
      setExitPrice("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExitBusy(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete entry.");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const open = entries?.filter((e) => e.status === "open") ?? [];
  const closed = entries?.filter((e) => e.status === "closed") ?? [];
  const totalRealized = closed.reduce((sum, e) => sum + (e.realizedPnl ?? 0), 0);
  const wins = closed.filter((e) => (e.realizedPnl ?? 0) > 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;

  return (
    <div className="jarvis flex flex-col gap-8">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Your own real trades, placed at your real broker — logged here with your thesis at entry. Separate from
        Paper Trading (this app&apos;s simulated account) and the Strategy Ledger (automated backtests). No orders
        are executed from this tab; it&apos;s a record, not a broker connection.
      </p>

      {(open.length > 0 || closed.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="jv-card jv-br-b">
            <div className="jv-label">Open Positions</div>
            <div className="jv-stat">{open.length}</div>
          </div>
          <div className="jv-card jv-br-b">
            <div className="jv-label">Realized P&amp;L</div>
            <div className="jv-stat" style={{ color: pnlColor(totalRealized) }}>
              {fmtMoney(totalRealized)}
            </div>
          </div>
          <div className="jv-card jv-br-b">
            <div className="jv-label">Win Rate ({closed.length} closed)</div>
            <div className="jv-stat">{winRate !== null ? `${winRate.toFixed(0)}%` : "—"}</div>
          </div>
        </div>
      )}

      <div className="jv-card">
        <div className="jv-label mb-3">Log a New Trade</div>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="Ticker, e.g. SPCX"
            required
            className="px-3 py-2 text-sm"
            style={inputStyle}
          />
          <select
            value={instrumentType}
            onChange={(e) => setInstrumentType(e.target.value as JournalInstrumentType)}
            className="px-3 py-2 text-sm"
            style={selectStyle}
          >
            <option value="call">Call</option>
            <option value="put">Put</option>
            <option value="shares">Shares</option>
          </select>
          {instrumentType !== "shares" && (
            <input
              value={strikePrice}
              onChange={(e) => setStrikePrice(e.target.value)}
              type="number"
              step="0.5"
              placeholder="Strike"
              required
              className="px-3 py-2 text-sm"
              style={inputStyle}
            />
          )}
          {instrumentType !== "shares" && (
            <input
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              type="date"
              required
              className="px-3 py-2 text-sm"
              style={inputStyle}
            />
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
          <input
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            type="number"
            step="0.01"
            placeholder="Entry price"
            required
            className="px-3 py-2 text-sm"
            style={inputStyle}
          />
          <input
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            type="datetime-local"
            placeholder="Entry time (default now)"
            className="px-3 py-2 text-sm"
            style={inputStyle}
          />
          <textarea
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="Thesis — why you took this trade"
            className="px-3 py-2 text-sm col-span-2 sm:col-span-4"
            style={{ ...inputStyle, fontFamily: "inherit", minHeight: 60 }}
          />
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--signal)", color: "var(--ink-950)" }}
          >
            {submitting ? "Logging…" : "Log Trade"}
          </button>
        </form>
        {submitError && (
          <p className="text-sm mt-2" style={{ color: "var(--danger)" }}>
            {submitError}
          </p>
        )}
      </div>

      {loading && <p style={{ color: "var(--text-2)" }}>Loading journal…</p>}

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="font-medium">Could not load journal</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {open.length > 0 && (
        <div>
          <div className="jv-label mb-3">Open Positions</div>
          <div className="overflow-x-auto">
            <table className="jv-table">
              <thead>
                <tr>
                  {["Position", "Qty", "Entry", "Cost Basis", "Entry Date", "Thesis", ""].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{label(e)}</td>
                    <td className="jv-num">{e.quantity}</td>
                    <td className="jv-num">{fmtMoney(e.entryPrice)}</td>
                    <td className="jv-num">{fmtMoney(costBasis(e))}</td>
                    <td className="text-xs" style={{ color: "var(--text-2)" }}>
                      {new Date(e.entryDate).toLocaleString()}
                    </td>
                    <td className="text-xs" style={{ color: "var(--text-2)", maxWidth: 260, whiteSpace: "normal" }}>
                      {e.thesis}
                    </td>
                    <td>
                      {closingId === e.id ? (
                        <div className="flex gap-2 items-center">
                          <input
                            value={exitPrice}
                            onChange={(ev) => setExitPrice(ev.target.value)}
                            type="number"
                            step="0.01"
                            placeholder="Exit price"
                            className="px-2 py-1 text-xs w-24"
                            style={inputStyle}
                          />
                          <button
                            onClick={() => handleClose(e.id)}
                            disabled={exitBusy || !exitPrice}
                            className="jv-btn-outline text-xs px-2 py-1 disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button onClick={() => setClosingId(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-3 items-center">
                          <button onClick={() => setClosingId(e.id)} className="jv-btn-outline text-xs px-2 py-1">
                            Close
                          </button>
                          <button onClick={() => handleDelete(e.id)} className="text-xs" style={{ color: "var(--text-2)" }}>
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <div className="jv-label mb-3">Closed Trades</div>
          <div className="overflow-x-auto">
            <table className="jv-table">
              <thead>
                <tr>
                  {["Position", "Qty", "Entry", "Exit", "Realized P&L", "Return %", "Closed"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closed.map((e) => {
                  const basis = costBasis(e);
                  const pnl = e.realizedPnl ?? 0;
                  const returnPct = basis > 0 ? (pnl / basis) * 100 : null;
                  return (
                    <tr key={e.id}>
                      <td className="font-medium">{label(e)}</td>
                      <td className="jv-num">{e.quantity}</td>
                      <td className="jv-num">{fmtMoney(e.entryPrice)}</td>
                      <td className="jv-num">{fmtMoney(e.exitPrice)}</td>
                      <td className="jv-num" style={{ color: pnlColor(e.realizedPnl) }}>
                        {fmtMoney(e.realizedPnl)}
                      </td>
                      <td className="jv-num" style={{ color: pnlColor(e.realizedPnl) }}>
                        {returnPct !== null ? `${returnPct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="text-xs" style={{ color: "var(--text-2)" }}>
                        {e.exitDate ? new Date(e.exitDate).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {entries && entries.length === 0 && !loading && (
        <p style={{ color: "var(--text-2)" }}>No trades logged yet — use the form above to log your first one.</p>
      )}
    </div>
  );
}
