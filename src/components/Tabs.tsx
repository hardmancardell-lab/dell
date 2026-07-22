"use client";

import { useState, type ReactNode } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  tabs,
  size = "primary",
  theme = "default",
}: {
  tabs: TabItem[];
  size?: "primary" | "secondary" | "tertiary";
  // "jarvis" — the app's in-progress redesign direction. Opt-in per call
  // site so unredesigned agents keep the current look untouched; only pass
  // this where the surrounding content is also wrapped in the .jarvis CSS
  // scope (globals.css), since the styling below leans on its custom
  // properties.
  theme?: "default" | "jarvis";
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
  const { track } = useTrackEvent();

  function selectTab(id: string, label: string) {
    setActive(id);
    track("tab_view", { tab: label, metadata: { level: size, tabId: id } });
  }

  if (size === "tertiary") {
    return (
      <div>
        <div className="flex flex-wrap gap-2 mb-6">
          {tabs.map((t) =>
            theme === "jarvis" ? (
              <button
                key={t.id}
                onClick={() => selectTab(t.id, t.label)}
                className={`px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider border transition-colors ${
                  t.id === activeTab?.id
                    ? "bg-[var(--signal)] text-[var(--ink-950)] border-[var(--signal)] font-semibold"
                    : "border-[var(--line)] text-[var(--text-1)] hover:border-[var(--line-bright)]"
                }`}
              >
                {t.label}
              </button>
            ) : (
              <button
                key={t.id}
                onClick={() => selectTab(t.id, t.label)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  t.id === activeTab?.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }`}
              >
                {t.label}
              </button>
            )
          )}
        </div>
        <div>{activeTab?.content}</div>
      </div>
    );
  }

  const isPrimary = size === "primary";

  return (
    <div>
      <div
        className={`flex gap-1 border-b border-zinc-200 dark:border-zinc-800 ${
          isPrimary ? "mb-8" : "mb-6"
        }`}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id, t.label)}
            className={`${isPrimary ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"} font-medium border-b-2 -mb-px transition-colors ${
              t.id === activeTab?.id
                ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
}
