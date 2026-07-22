"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IndicatorSeriesResult } from "@/lib/agents/research-agent/skills/indicator-library";
import type { IndicatorClassification } from "@/lib/agents/research-agent/skills/indicator-metadata";

const CLASSIFICATION_STYLES: Record<IndicatorClassification, string> = {
  leading: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
  coincident: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400",
  lagging: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function ClassificationBadge({ classification }: { classification: IndicatorClassification }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${CLASSIFICATION_STYLES[classification]}`}>
      {classification}
    </span>
  );
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
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950 h-[320px] flex items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 text-red-700 dark:text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold text-sm">{data.meta.label}</h3>
        <ClassificationBadge classification={data.meta.classification} />
      </div>
      <p className="text-xs text-zinc-500 mb-4">{data.meta.classificationNote}</p>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data.points}>
          <CartesianGrid strokeDasharray="3 3" stroke="#71717a" opacity={0.2} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} minTickGap={40} />
          <YAxis tick={{ fontSize: 10, fill: "#71717a" }} domain={["auto", "auto"]} width={45} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            labelStyle={{ color: "#71717a" }}
          />
          <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-3">{data.meta.description}</p>
      <p className="text-xs text-zinc-400 mt-2">Unit: {data.meta.unit}</p>
    </div>
  );
}
