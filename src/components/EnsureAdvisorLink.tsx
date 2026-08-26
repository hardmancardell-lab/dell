"use client";

import { useEffect } from "react";

const SESSION_FLAG = "dellegate-advisor-link-checked";

/**
 * Fixes a real gap found live: an advisor-managed client's account only
 * ever gets linked to their real login (getAdvisorClientByUser's lazy
 * link, hit via GET /api/my-portfolio) when they happen to open the
 * Portfolio Tracking Agent tab specifically. A client who logs in and
 * lands anywhere else first (Research Agent, Assistant, etc.) never
 * triggers it, sees no sign their account is "theirs," and has no reason
 * to know Portfolio Tracker is where the link would have happened —
 * confirmed live: a real client's account sat unlinked for a week because
 * of exactly this. Mounted once at the true root (layout.tsx) so the
 * link check fires on first load regardless of which tab is active,
 * gated by a sessionStorage flag so it only ever fires once per tab.
 */
export function EnsureAdvisorLink() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_FLAG)) return;
    sessionStorage.setItem(SESSION_FLAG, "1");
    fetch("/api/my-portfolio").catch(() => {
      // Silent — this is a background side effect (the linking itself),
      // not a data fetch anything on screen depends on. A logged-out
      // visitor legitimately 401s here; that's expected, not an error.
    });
  }, []);

  return null;
}
