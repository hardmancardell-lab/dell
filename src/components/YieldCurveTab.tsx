"use client";

import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { YieldCurveResult } from "@/lib/agents/trading-agent/types";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

export function YieldCurveTab() {
  const [data, setData] = useState<YieldCurveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/yield-curve");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setData(json as YieldCurveResult);
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

  const chartData = data?.points.map((p) => ({ tenor: p.tenorLabel, yield: p.value })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          The full trackable Treasury yield curve (1 month through 30 years) plus high-yield and
          investment-grade credit spreads — every real tenor point this app can source from FRED.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50 shrink-0 ml-4"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)}%` : v)} />
                <Line type="monotone" dataKey="yield" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {data.points.map((p) => (
              <StatCard
                key={p.seriesId}
                label={p.tenorLabel}
                value={p.value !== null ? `${p.value.toFixed(2)}%` : "N/A"}
                sub={p.date || undefined}
              />
            ))}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Credit Spreads</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.creditSpreads.map((s) => (
                <StatCard key={s.seriesId} label={s.label} value={`${s.value.toFixed(2)}%`} sub={s.date} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Curve Inversions</h3>
            {data.inversions.length === 0 ? (
              <p className="text-sm text-zinc-500">No adjacent-tenor inversions currently detected.</p>
            ) : (
              <ul className="text-sm text-zinc-700 dark:text-zinc-300 space-y-1">
                {data.inversions.map((inv) => (
                  <li key={`${inv.fromTenor}-${inv.toTenor}`} className="rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2">
                    {inv.fromTenor} yields more than {inv.toTenor} — inverted segment.
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
