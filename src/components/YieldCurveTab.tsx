"use client";

import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { YieldCurveResult } from "@/lib/agents/trading-agent/types";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="jv-label">{label}</div>
      <div className="jv-cond c-neutral" style={{ fontSize: 18 }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          {sub}
        </div>
      )}
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
    <div className="jarvis">
      <div className="flex items-center justify-between">
        <p className="jv-lede" style={{ marginBottom: 0 }}>
          The full trackable Treasury yield curve (1 month through 30 years) plus high-yield and
          investment-grade credit spreads — every real tenor point this app can source from FRED.
        </p>
        <button onClick={load} disabled={loading} className="jv-btn shrink-0 ml-4" style={{ padding: "6px 16px" }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="jv-card mt-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-6 mt-6">
          <div className="jv-card h-72">
            <div className="jv-br-b" />
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="tenor" tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} unit="%" stroke="var(--line)" />
                <Tooltip
                  formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)}%` : v)}
                  contentStyle={{ background: "var(--ink-800)", border: "1px solid var(--line-bright)", fontSize: 12 }}
                  labelStyle={{ color: "var(--text-0)" }}
                  itemStyle={{ color: "var(--text-1)" }}
                />
                <Line type="monotone" dataKey="yield" stroke="var(--signal)" strokeWidth={2} dot={{ r: 3, fill: "var(--signal)" }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {data.points.map((p) => (
              <StatCard key={p.seriesId} label={p.tenorLabel} value={p.value !== null ? `${p.value.toFixed(2)}%` : "N/A"} sub={p.date || undefined} />
            ))}
          </div>

          <div>
            <div className="jv-strip-title">Credit Spreads</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.creditSpreads.map((s) => (
                <StatCard key={s.seriesId} label={s.label} value={`${s.value.toFixed(2)}%`} sub={s.date} />
              ))}
            </div>
          </div>

          <div>
            <div className="jv-strip-title">Curve Inversions</div>
            {data.inversions.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>
                No adjacent-tenor inversions currently detected.
              </p>
            ) : (
              <ul className="text-sm flex flex-col gap-1" style={{ color: "var(--text-1)" }}>
                {data.inversions.map((inv) => (
                  <li key={`${inv.fromTenor}-${inv.toTenor}`} className="jv-card" style={{ borderColor: "var(--danger)" }}>
                    {inv.fromTenor} yields more than {inv.toTenor} — inverted segment.
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
