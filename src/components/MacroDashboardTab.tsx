"use client";

import { useState } from "react";
import { INDICATOR_LIBRARY } from "@/lib/agents/research-agent/skills/indicator-metadata";
import { IndicatorChart } from "./IndicatorChart";

export function MacroDashboardTab() {
  const flagship = INDICATOR_LIBRARY.filter((i) => i.isFlagship);
  const others = INDICATOR_LIBRARY.filter((i) => !i.isFlagship);
  const [selectedOther, setSelectedOther] = useState(others[0]?.id ?? "");

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-xl font-semibold mb-1">Six Flagship Indicators</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Chosen to span growth/business cycle, labor, credit conditions, inflation, and
          consumer strength — not just headline GDP and CPI.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {flagship.map((i) => (
            <IndicatorChart key={i.id} indicatorId={i.id} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-1">More Indicators</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Everything else in the library — pick one to chart it.
        </p>
        <select
          value={selectedOther}
          onChange={(e) => setSelectedOther(e.target.value)}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm w-full sm:w-auto"
        >
          {others.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label} ({i.classification})
            </option>
          ))}
        </select>
        {selectedOther && (
          <div className="mt-4 max-w-xl">
            <IndicatorChart indicatorId={selectedOther} />
          </div>
        )}
      </div>
    </div>
  );
}
