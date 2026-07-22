"use client";

import { useEffect, useState } from "react";
import type { PaperBacktestLogEntry } from "@/lib/agents/trading-agent/types";

function fmtPct(v: number | null): string {
  return v !== null ? `${v.toFixed(2)}%` : "—";
}

const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

export function PaperBacktestLogTab() {
  const [entries, setEntries] = useState<PaperBacktestLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/paper-backtest-log");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setEntries(json.entries as PaperBacktestLogEntry[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function copyJson() {
    if (!entries) return;
    await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const completed = entries?.filter((e) => e.monRet !== null).length ?? 0;
  const pending = (entries?.length ?? 0) - completed;

  return (
    <div className="jarvis">
      <p className="jv-lede">
        A row is logged automatically every time the GEX &amp; Dealer Positioning check runs for a
        watchlisted underlying (deduped per underlying + expiration), starting from whenever this was first
        used — this accumulates real forward outcomes over time rather than reconstructing history that
        isn&apos;t available for free (see TRADIER_INTEGRATION_NOTES.md). Once an expiration week has
        passed, realized Mon-Fri returns are backfilled automatically from real daily bars the next time
        this page loads.
      </p>

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm" style={{ color: "var(--text-2)" }}>
          {loading ? "Loading…" : entries ? `${entries.length} logged — ${completed} completed, ${pending} pending realization` : ""}
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="jv-btn-outline">
            Refresh
          </button>
          <button onClick={copyJson} disabled={!entries || entries.length === 0} className="jv-btn">
            {copied ? "Copied" : "Copy JSON for backtest_engine.py"}
          </button>
        </div>
      </div>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {entries && entries.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          No entries yet — visit the GEX &amp; Dealer Positioning section on the Options Dashboard for a
          watchlisted underlying to log the first one.
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                <th className={TH_CLASS}>Underlying</th>
                <th className={TH_CLASS}>Signal Date</th>
                <th className={TH_CLASS}>Expiration</th>
                <th className={TH_CLASS}>Label</th>
                <th className={TH_CLASS}>Mon</th>
                <th className={TH_CLASS}>Tue</th>
                <th className={TH_CLASS}>Wed</th>
                <th className={TH_CLASS}>Thu</th>
                <th className={TH_CLASS}>Fri</th>
                <th className={TH_CLASS}>Pinned Near Wall</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
              {entries.map((e) => (
                <tr key={`${e.underlying}-${e.expirationDate}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                  <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{e.underlying}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{e.signalDate}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{e.expirationDate}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{e.signalLabel}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(e.monRet)}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(e.tueRet)}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(e.wedRet)}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(e.thuRet)}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(e.friRet)}</td>
                  <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                    {e.pinnedNearWall === null ? "pending" : e.pinnedNearWall ? "yes" : "no"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs mt-6" style={{ color: "var(--text-2)" }}>
        Minimum bar before treating any label as a real edge rather than noise, per
        options-signals-project/README.md: passes FDR correction in-sample AND holds the same sign
        out-of-sample AND has a bootstrap CI that excludes zero — all three. Run{" "}
        <code style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>python backtest_engine.py</code> on
        the copied JSON once enough rows have completed to check.
      </p>
    </div>
  );
}
