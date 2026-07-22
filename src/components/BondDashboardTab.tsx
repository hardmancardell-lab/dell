"use client";

import { useCallback, useEffect, useState } from "react";
import { TradingDashboardTab } from "./TradingDashboardTab";
import type { BondMacroSnapshot } from "@/lib/agents/trading-agent/types";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

export function BondDashboardTab() {
  const [snapshot, setSnapshot] = useState<BondMacroSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bond-macro");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setSnapshot(json as BondMacroSnapshot);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Treasury &amp; Credit Conditions</h2>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        {snapshot && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label={snapshot.yieldCurveSpread.label}
                value={`${snapshot.yieldCurveSpread.value.toFixed(2)} pp`}
                sub={snapshot.yieldCurveInverted ? "Inverted" : "Not inverted"}
              />
              <StatCard
                label={snapshot.highYieldSpread.label}
                value={`${snapshot.highYieldSpread.value.toFixed(2)}%`}
                sub={snapshot.highYieldSpread.date}
              />
            </div>
            {snapshot.dataLimitations.map((d) => (
              <div
                key={d.slice(0, 30)}
                className="mt-4 rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
              >
                {d}
              </div>
            ))}
          </>
        )}
      </section>

      <TradingDashboardTab filterAssetClass="bond" />
    </div>
  );
}
