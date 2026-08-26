"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "@/lib/agents/trading-agent/types";

const CHART_COLORS = ["#4fe8d0", "#f0a868", "#7c9eff", "#e8637a", "#c792ea", "#82e0aa", "#ffd166", "#5eead4"];

/** Adds a Cash slice (uninvested reserve) so the chart reflects total funds, not just holdings. */
export function withCashSlice(slices: AllocationSlice[], cashBalance: number, grandTotal: number): AllocationSlice[] {
  const rescaled = slices.map((s) => ({ ...s, percent: grandTotal > 0 ? (s.value / grandTotal) * 100 : 0 }));
  if (cashBalance > 0) {
    rescaled.push({ label: "Cash", value: cashBalance, percent: grandTotal > 0 ? (cashBalance / grandTotal) * 100 : 0 });
  }
  return rescaled;
}

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function AllocationPieChart({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  if (slices.length === 0) return null;
  const chartData = slices.map((s) => ({ ...s, displayName: `${s.label} (${s.percent.toFixed(1)}%)` }));
  return (
    <div>
      <h3 className="jv-strip-title mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="displayName" cx="50%" cy="45%" outerRadius={80} paddingAngle={2}>
            {chartData.map((s, i) => (
              <Cell key={s.label} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="var(--ink-950)" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "var(--ink-900)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 12 }}
            formatter={(value) => fmtUsd(Number(value))}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-1)" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
