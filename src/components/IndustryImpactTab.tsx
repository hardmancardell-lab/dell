"use client";

import { INDUSTRY_IMPACTS } from "@/lib/agents/research-agent/skills/industry-impact";
import { INDICATOR_LIBRARY } from "@/lib/agents/research-agent/skills/indicator-metadata";
import { getResearchGlossaryEntry } from "@/lib/agents/research-agent/skills/glossary";
import { GlossaryTerm } from "@/components/GlossaryTerm";

// Only the genuinely jargon-heavy driver ids get a glossary popover — plain
// -language labels (yield-curve, durable-goods, consumer-sentiment, etc.)
// are self-explanatory enough not to need one.
const DRIVER_GLOSSARY_TERM: Record<string, string> = {
  "sloos-tightening": "sloos",
  cfnai: "cfnai",
};

export function IndustryImpactTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        How the macro environment translates into industry-level risk and opportunity —
        which indicators matter most for each industry, and why.
      </p>
      <div className="space-y-6">
        {INDUSTRY_IMPACTS.map((industry) => (
          <div
            key={industry.id}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950"
          >
            <h3 className="text-lg font-semibold mb-2">{industry.name}</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {industry.primaryDrivers.map((driverId) => {
                const meta = INDICATOR_LIBRARY.find((i) => i.id === driverId);
                const label = meta?.label ?? driverId;
                const glossaryTerm = DRIVER_GLOSSARY_TERM[driverId];
                return (
                  <span
                    key={driverId}
                    className="inline-block rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs font-medium"
                  >
                    {glossaryTerm ? (
                      <GlossaryTerm term={glossaryTerm} getEntry={getResearchGlossaryEntry}>
                        {label}
                      </GlossaryTerm>
                    ) : (
                      label
                    )}
                  </span>
                );
              })}
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {industry.analysis}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
