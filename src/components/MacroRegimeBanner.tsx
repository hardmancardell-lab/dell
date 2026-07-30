"use client";

import { useEffect, useState } from "react";
import type { EconomicOutlook } from "@/lib/agents/economic-outlook/types";

const VOL_REGIME_LABEL: Record<string, string> = {
  low_vol_grind: "Low-Vol Grind",
  elevated_event_risk: "Elevated Event Risk",
  high_vol_regime_break: "High-Vol Regime Break",
};

/**
 * Reads the latest Economic Outlook's regime tag + trading parameters and surfaces them
 * compactly wherever a Trading Agent tool (backtest, calendar effects, mean reversion, options)
 * could use that context. Renders nothing if no outlook has been generated yet or the request
 * fails — this is supplementary context, never a blocker for the underlying tool.
 */
export function MacroRegimeBanner() {
  const [outlook, setOutlook] = useState<EconomicOutlook | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/economic-outlook/latest")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && json.meta) setOutlook(json as EconomicOutlook);
      })
      .catch(() => {});
  }, []);

  if (!outlook) return null;

  const tp = outlook.tradingParameters;

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/20 px-3 py-2 mb-4 text-xs text-indigo-900 dark:text-indigo-300">
      <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-2 w-full text-left">
        <span className="font-semibold uppercase tracking-wide">Macro Regime</span>
        <span>{outlook.regimeTag.label}</span>
        <span className="text-indigo-500 dark:text-indigo-500">·</span>
        <span>{VOL_REGIME_LABEL[tp.volRegime] ?? tp.volRegime}</span>
        <span className="ml-auto text-indigo-500">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1 border-t border-indigo-200 dark:border-indigo-900 pt-2">
          <span>
            Calendar-effects priority: {tp.calendarEffectsPriority.length > 0 ? tp.calendarEffectsPriority.join(", ") : "none flagged"}
          </span>
          <span>Mean-reversion window confidence: {tp.meanReversionWindowConfidence}</span>
          <span className="text-indigo-500 dark:text-indigo-500">
            From Economic Outlook v{outlook.meta.versionId} (as of {outlook.meta.asOfDate}) — see the full narrative under Macro →
            Economic Outlook.
          </span>
        </div>
      )}
    </div>
  );
}
