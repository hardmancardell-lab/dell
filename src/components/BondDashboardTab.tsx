"use client";

import { useCallback, useEffect, useState } from "react";
import { TradingDashboardTab } from "./TradingDashboardTab";
import type { BondMacroSnapshot } from "@/lib/agents/trading-agent/types";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="jv-label">{label}</div>
      <div className="jv-cond c-neutral" style={{ fontSize: 20 }}>
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
    <div className="flex flex-col gap-10">
      <div className="jarvis">
        <div className="flex items-center justify-between mb-3">
          <div className="jv-strip-title" style={{ margin: 0 }}>Treasury &amp; Credit Conditions</div>
          <button onClick={load} disabled={loading} className="jv-btn" style={{ padding: "6px 16px" }}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {error && (
          <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            {error}
          </div>
        )}
        {snapshot && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatCard
                label={snapshot.yieldCurveSpread.label}
                value={`${snapshot.yieldCurveSpread.value.toFixed(2)} pp`}
                sub={snapshot.yieldCurveInverted ? "Inverted" : "Not inverted"}
              />
              <StatCard label={snapshot.highYieldSpread.label} value={`${snapshot.highYieldSpread.value.toFixed(2)}%`} sub={snapshot.highYieldSpread.date} />
            </div>
            {snapshot.dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="jv-card mt-4 text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                {d}
              </div>
            ))}
          </>
        )}
      </div>

      <TradingDashboardTab filterAssetClass="bond" />
    </div>
  );
}
