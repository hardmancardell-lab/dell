"use client";

import type { ReactNode } from "react";
import { GlossaryTerm } from "./GlossaryTerm";
import { getResearchGlossaryEntry } from "@/lib/agents/research-agent/skills/glossary";

/**
 * A thin client-side wrapper around GlossaryTerm bound to the research-agent
 * glossary. Needed specifically for use from page.tsx (a Server Component) —
 * a Server Component can't pass a plain function prop like `getEntry` across
 * the server/client boundary (only "use server" actions can cross that way),
 * so this wrapper resolves the lookup function client-side instead. Client
 * components (IndustryImpactTab.tsx, SecurityAnalystTab.tsx, etc.) can keep
 * passing getEntry={getResearchGlossaryEntry} to <GlossaryTerm> directly —
 * that's a client-to-client prop, which is fine.
 */
export function ResearchGlossaryTerm({ term, children }: { term: string; children: ReactNode }) {
  return (
    <GlossaryTerm term={term} getEntry={getResearchGlossaryEntry}>
      {children}
    </GlossaryTerm>
  );
}
