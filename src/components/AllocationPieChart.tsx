"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { allocationSliceColor } from "@/lib/agents/trading-agent/allocation-colors";
import type { AllocationSlice } from "@/lib/agents/trading-agent/types";

// Pure helper lives in src/lib/chart/allocation.ts (unit-tested without loading recharts); re-exported for the existing importers.
export { withCashSlice } from "@/lib/chart/allocation";

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
              <Cell key={s.label} fill={allocationSliceColor(chartData.map((c) => c.label), i)} stroke="var(--ink-950)" />
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
