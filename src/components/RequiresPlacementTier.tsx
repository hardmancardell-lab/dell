"use client";

import { useLiteracyProgress } from "@/lib/agents/financial-literacy/literacy-storage";
import { LITERACY_TIER_ORDER } from "@/lib/agents/financial-literacy/types";
import type { LiteracyTier } from "@/lib/agents/financial-literacy/types";

const TIER_LABEL: Record<LiteracyTier, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  expert: "Expert",
};

/**
 * Turns the Financial Literacy placement result into an actual competency
 * gate on the app's more statistically involved tools, rather than leaving
 * it as content nobody is required to engage with. Deliberately narrow in
 * scope today — applied only to the genuinely advanced backtest/scan tools
 * (see page.tsx), not the whole Trading Agent surface, so a first-time
 * visitor can still see live dashboards/charts without hitting a wall.
 * No cross-tab deep link exists in this app (see TryItPointer's own
 * comment) — this gives instructive text, not a button that jumps there.
 */
export function RequiresPlacementTier({ minTier, children }: { minTier: LiteracyTier; children: React.ReactNode }) {
  const { placement, hydrated } = useLiteracyProgress();

  if (!hydrated) return null; // avoid a flash of the locked state before localStorage reads

  const minIndex = LITERACY_TIER_ORDER.indexOf(minTier);
  const placedIndex = placement ? LITERACY_TIER_ORDER.indexOf(placement.tier) : -1;
  const meetsRequirement = placedIndex >= minIndex;

  if (meetsRequirement) return <>{children}</>;

  return (
    <div className="jarvis">
      <div className="jv-card" style={{ maxWidth: 560 }}>
        <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
          {TIER_LABEL[minTier]}-level tool
        </div>
        <p className="text-sm mb-3" style={{ color: "var(--text-1)" }}>
          {placement === null
            ? "This tool assumes concepts covered by the Financial Literacy placement quiz — take it once (a few minutes, no penalty for guessing) to unlock this and see it framed at the right level for you."
            : `You're currently placed at ${TIER_LABEL[placement.tier]}. This tool assumes ${TIER_LABEL[minTier]}-level concepts — work through the ${TIER_LABEL[minTier]} modules in Financial Literacy to unlock it.`}
        </p>
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          Head to the Financial Literacy tab to {placement === null ? "take the placement quiz" : "continue the curriculum"}.
        </p>
      </div>
    </div>
  );
}
