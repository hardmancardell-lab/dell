"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IndicatorSeriesResult } from "@/lib/agents/research-agent/skills/indicator-library";
import type { IndicatorClassification } from "@/lib/agents/research-agent/skills/indicator-metadata";

const CLASSIFICATION_STYLES: Record<IndicatorClassification, string> = {
  leading: "c-signal",
  coincident: "c-neutral",
  lagging: "c-neutral",
};

function ClassificationBadge({ classification }: { classification: IndicatorClassification }) {
  return <span className={`jv-badge ${CLASSIFICATION_STYLES[classification]} capitalize`}>{classification}</span>;
}

export function IndicatorChart({ indicatorId }: { indicatorId: string }) {
  const [data, setData] = useState<IndicatorSeriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/indicator-series?id=${indicatorId}&limit=60`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(json.error ?? "Unknown error");
        else setData(json as IndicatorSeriesResult);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [indicatorId]);

  if (loading) {
    return (
      <div className="jv-card h-[320px] flex items-center justify-center text-sm" style={{ color: "var(--text-2)" }}>
        <div className="jv-br-b" />
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="jv-card text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold text-sm" style={{ color: "var(--text-0)" }}>{data.meta.label}</h3>
        <ClassificationBadge classification={data.meta.classification} />
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-2)" }}>{data.meta.classificationNote}</p>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data.points}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-2)" }} stroke="var(--line)" minTickGap={40} />
          <YAxis tick={{ fontSize: 10, fill: "var(--text-2)" }} stroke="var(--line)" domain={["auto", "auto"]} width={45} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 4, background: "var(--ink-900)", border: "1px solid var(--line)" }}
            labelStyle={{ color: "var(--text-2)" }}
            itemStyle={{ color: "var(--text-0)" }}
          />
          <Line type="monotone" dataKey="value" stroke="var(--signal)" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-sm mt-3" style={{ color: "var(--text-1)" }}>{data.meta.description}</p>
      <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>Unit: {data.meta.unit}</p>
    </div>
  );
}
