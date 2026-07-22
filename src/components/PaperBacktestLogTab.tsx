"use client";

import { useEffect, useState } from "react";
import type { PaperBacktestLogEntry } from "@/lib/agents/trading-agent/types";

function fmtPct(v: number | null): string {
  return v !== null ? `${v.toFixed(2)}%` : "—";
}

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
    <div>
      <p className="text-zinc-500 mb-6">
        A row is logged automatically every time the GEX &amp; Dealer
        Positioning check runs for a watchlisted underlying (deduped per
        underlying + expiration), starting from whenever this was first
        used — this accumulates real forward outcomes over time rather than
        reconstructing history that isn&apos;t available for free (see
        TRADIER_INTEGRATION_NOTES.md). Once an expiration week has passed,
        realized Mon-Fri returns are backfilled automatically from real daily
        bars the next time this page loads.
      </p>

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500">
          {loading ? "Loading…" : entries ? `${entries.length} logged — ${completed} completed, ${pending} pending realization` : ""}
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={copyJson}
            disabled={!entries || entries.length === 0}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {copied ? "Copied" : "Copy JSON for backtest_engine.py"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {entries && entries.length === 0 && (
        <p className="text-sm text-zinc-500">
          No entries yet — visit the GEX &amp; Dealer Positioning section on the Options Dashboard for a watchlisted underlying to log the first one.
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4">Underlying</th>
                <th className="py-2 pr-4">Signal Date</th>
                <th className="py-2 pr-4">Expiration</th>
                <th className="py-2 pr-4">Label</th>
                <th className="py-2 pr-4">Mon</th>
                <th className="py-2 pr-4">Tue</th>
                <th className="py-2 pr-4">Wed</th>
                <th className="py-2 pr-4">Thu</th>
                <th className="py-2 pr-4">Fri</th>
                <th className="py-2 pr-4">Pinned Near Wall</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.underlying}-${e.expirationDate}`} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4 font-medium">{e.underlying}</td>
                  <td className="py-2 pr-4 text-zinc-500">{e.signalDate}</td>
                  <td className="py-2 pr-4 text-zinc-500">{e.expirationDate}</td>
                  <td className="py-2 pr-4">{e.signalLabel}</td>
                  <td className="py-2 pr-4">{fmtPct(e.monRet)}</td>
                  <td className="py-2 pr-4">{fmtPct(e.tueRet)}</td>
                  <td className="py-2 pr-4">{fmtPct(e.wedRet)}</td>
                  <td className="py-2 pr-4">{fmtPct(e.thuRet)}</td>
                  <td className="py-2 pr-4">{fmtPct(e.friRet)}</td>
                  <td className="py-2 pr-4 text-zinc-500">
                    {e.pinnedNearWall === null ? "pending" : e.pinnedNearWall ? "yes" : "no"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-400 mt-6">
        Minimum bar before treating any label as a real edge rather than
        noise, per options-signals-project/README.md: passes FDR correction
        in-sample AND holds the same sign out-of-sample AND has a bootstrap
        CI that excludes zero — all three. Run{" "}
        <code className="text-zinc-500">python backtest_engine.py</code> on
        the copied JSON once enough rows have completed to check.
      </p>
    </div>
  );
}
