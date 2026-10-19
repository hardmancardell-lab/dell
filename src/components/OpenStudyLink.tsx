"use client";

import type { ReactNode } from "react";
import { useAppNavigationOptional } from "@/lib/navigation/app-navigation";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

/**
 * A text link that opens a registry study (see src/lib/navigation/study-registry.ts) in place, with an optional ticker.
 * Outside the navigation provider it renders as plain text, so the sentence around it still reads correctly.
 */
export function OpenStudyLink({ studyId, assetClass, ticker, children }: { studyId: string; assetClass?: AssetClass; ticker?: string; children: ReactNode }) {
  const nav = useAppNavigationOptional();
  if (!nav) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => nav.openStudy(studyId, { assetClass, ticker })}
      className="underline underline-offset-2 hover:no-underline"
      style={{ color: "var(--signal)", background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}
    >
      {children}
    </button>
  );
}
