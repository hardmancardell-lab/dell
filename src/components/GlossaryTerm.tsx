"use client";

import { useState, type ReactNode } from "react";
import { getGlossaryEntry as getTradingGlossaryEntry } from "@/lib/agents/trading-agent/skills/glossary";

interface GlossaryEntryLike {
  label: string;
  definition: string;
}

/**
 * Wraps a label with a small "info" icon that toggles an inline popover
 * showing that term's glossary definition on click. No new dependency —
 * plain state + absolute positioning, dismissable by clicking the icon
 * again or clicking elsewhere.
 *
 * `getEntry` defaults to the trading-agent glossary (unchanged for the ~15
 * existing call sites) but accepts any lookup with the same shape — e.g.
 * research-agent/skills/glossary.ts's getResearchGlossaryEntry — so this one
 * component serves every agent's jargon instead of forking a near-identical
 * copy per agent.
 */
export function GlossaryTerm({
  term,
  children,
  getEntry = getTradingGlossaryEntry,
}: {
  term: string;
  children: ReactNode;
  getEntry?: (term: string) => GlossaryEntryLike | undefined;
}) {
  const [open, setOpen] = useState(false);
  const entry = getEntry(term);

  if (!entry) return <>{children}</>;

  return (
    <span className="relative inline-flex items-center gap-1">
      {children}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`What does ${entry.label} mean?`}
        className="jv-glossary-icon text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-xs align-super cursor-help"
      >
        ⓘ
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="jv-glossary-popover absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg p-3 text-left normal-case">
            <div className="text-sm font-semibold mb-1">{entry.label}</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">{entry.definition}</div>
          </div>
        </>
      )}
    </span>
  );
}
