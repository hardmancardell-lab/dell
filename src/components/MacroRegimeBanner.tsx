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
    <div
      className="px-3 py-2 mb-4 text-xs"
      style={{ border: "1px solid var(--verdict-dim)", background: "rgba(240, 168, 104, 0.06)", color: "var(--verdict)" }}
    >
      <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-2 w-full text-left">
        <span className="font-semibold uppercase tracking-wide" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
          Macro Regime
        </span>
        <span style={{ color: "var(--text-0)" }}>{outlook.regimeTag.label}</span>
        <span style={{ color: "var(--text-2)" }}>·</span>
        <span style={{ color: "var(--text-0)" }}>{VOL_REGIME_LABEL[tp.volRegime] ?? tp.volRegime}</span>
        <span className="ml-auto" style={{ color: "var(--verdict)" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1 pt-2" style={{ borderTop: "1px solid var(--verdict-dim)" }}>
          <span style={{ color: "var(--text-1)" }}>
            Calendar-effects priority: {tp.calendarEffectsPriority.length > 0 ? tp.calendarEffectsPriority.join(", ") : "none flagged"}
          </span>
          <span style={{ color: "var(--text-1)" }}>Mean-reversion window confidence: {tp.meanReversionWindowConfidence}</span>
          <span style={{ color: "var(--text-2)" }}>
            From Economic Outlook v{outlook.meta.versionId} (as of {outlook.meta.asOfDate}) — see the full narrative under Macro →
            Economic Outlook.
          </span>
        </div>
      )}
    </div>
  );
}
