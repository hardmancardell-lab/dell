"use client";

import { useState } from "react";
import { INDICATOR_LIBRARY } from "@/lib/agents/research-agent/skills/indicator-metadata";
import { IndicatorChart } from "./IndicatorChart";

export function MacroDashboardTab() {
  const flagship = INDICATOR_LIBRARY.filter((i) => i.isFlagship);
  const others = INDICATOR_LIBRARY.filter((i) => !i.isFlagship);
  const [selectedOther, setSelectedOther] = useState(others[0]?.id ?? "");

  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="jv-strip-title">Six Flagship Indicators</div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Chosen to span growth/business cycle, labor, credit conditions, inflation, and
          consumer strength — not just headline GDP and CPI.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {flagship.map((i) => (
            <IndicatorChart key={i.id} indicatorId={i.id} />
          ))}
        </div>
      </section>

      <section>
        <div className="jv-strip-title">More Indicators</div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Everything else in the library — pick one to chart it.
        </p>
        <select
          value={selectedOther}
          onChange={(e) => setSelectedOther(e.target.value)}
          className="jv-select w-full sm:w-auto"
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
      </section>
    </div>
  );
}
