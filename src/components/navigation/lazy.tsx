"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrappers for the navigation surfaces, so the Study Library, the group workspace and the command palette add nothing
 * to the first-load JavaScript of the home route. Same pattern as src/app/page-tabs.tsx.
 */
function Loading() {
  return (
    <div role="status" aria-live="polite" style={{ minHeight: 120 }}>
      <p className="text-sm" style={{ color: "var(--text-2, #7b8ca2)" }}>Loading…</p>
    </div>
  );
}

export const StudiesTab = dynamic(() => import("./StudiesTab").then((m) => m.StudiesTab), { loading: Loading });
export const NewsHubTab = dynamic(() => import("@/components/NewsHubTab").then((m) => m.NewsHubTab), { loading: Loading });
export const AssetGroupWorkspace = dynamic(() => import("./AssetGroupWorkspace").then((m) => m.AssetGroupWorkspace), { loading: Loading });
