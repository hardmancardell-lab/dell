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
    <div className="flex flex-col gap-6">
      <p className="text-sm" style={{ color: "var(--text-2)" }}>
        How the macro environment translates into industry-level risk and opportunity —
        which indicators matter most for each industry, and why.
      </p>
      <div className="flex flex-col gap-4">
        {INDUSTRY_IMPACTS.map((industry) => (
          <div key={industry.id} className="jv-card">
            <div className="jv-br-b" />
            <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>{industry.name}</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {industry.primaryDrivers.map((driverId) => {
                const meta = INDICATOR_LIBRARY.find((i) => i.id === driverId);
                const label = meta?.label ?? driverId;
                const glossaryTerm = DRIVER_GLOSSARY_TERM[driverId];
                return (
                  <span key={driverId} className="jv-badge c-neutral">
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
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-1)" }}>
              {industry.analysis}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
