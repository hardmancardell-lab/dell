"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { useAppNavigationOptional } from "@/lib/navigation/app-navigation";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  tabs,
  size = "primary",
  theme = "default",
  mobileDropdown = false,
  navLevel,
  navParentId,
  ariaLabel,
}: {
  tabs: TabItem[];
  // Accessible name of the tab list (and of the mobile dropdown). Defaults
  // to a generic label per size; call sites with several rows on one screen
  // should pass something specific ("Trading sections").
  ariaLabel?: string;
  size?: "primary" | "secondary" | "tertiary";
  // "jarvis" — the app's in-progress redesign direction. Opt-in per call
  // site so unredesigned agents keep the current look untouched; only pass
  // this where the surrounding content is also wrapped in the .jarvis CSS
  // scope (globals.css), since the styling below leans on its custom
  // properties.
  theme?: "default" | "jarvis";
  // Swap to a <select> below the sm breakpoint instead of the normal
  // horizontally-scrollable button row. Opt-in per call site — only
  // Portfolio Tracker's secondary tab bar actually has enough tabs to need
  // this (7, reported as not fitting on mobile). Everywhere else, including
  // the primary agent switcher, a hidden-by-default dropdown made it
  // non-obvious that other agents existed at all, so it defaults off.
  mobileDropdown?: boolean;
  // Opt-in: when set (and an AppNavigationProvider is in scope), the active
  // tab is read from the provider's navigation state and clicks write back to
  // it, which is what makes the tab addressable by URL (reload, Back/Forward,
  // shared links) and by navigateTo (Assistant, onboarding wizard).
  // "primary" uses state.primaryId; "secondary" uses state.secondaryId when
  // state.primaryId === navParentId; "tertiary" uses state.tab when
  // state.secondaryId === navParentId (an asset-class group's own tab row).
  // Without a navLevel, or outside a provider, the tabs keep their own state.
  navLevel?: "primary" | "secondary" | "tertiary";
  navParentId?: string;
}) {
  const [localActive, setLocalActive] = useState(tabs[0]?.id);
  const { track } = useTrackEvent();
  const nav = useAppNavigationOptional();
  const navControlled = Boolean(nav && navLevel);
  let navActive: string | undefined;
  if (nav && navLevel === "primary") navActive = nav.state.primaryId;
  else if (nav && navLevel === "secondary") navActive = nav.state.primaryId === navParentId ? nav.state.secondaryId : undefined;
  else if (nav && navLevel === "tertiary") navActive = nav.state.secondaryId === navParentId ? nav.state.tab : undefined;
  const active = navControlled ? navActive : localActive;
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
  const uid = useId();
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listLabel = ariaLabel ?? (size === "primary" ? "Agents" : size === "secondary" ? "Sections" : "Views");
  const tabDomId = (id: string) => `${uid}-tab-${id}`;
  const panelDomId = (id: string) => `${uid}-panel-${id}`;

  // WAI-ARIA tabs pattern, automatic activation: roving tabindex (only the
  // active tab is a Tab stop), Left/Right wrap, Home/End jump to the ends.
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const t = tabs[next];
    selectTab(t.id, t.label);
    btnRefs.current[next]?.focus();
  }

  function tabProps(t: TabItem, index: number) {
    const selected = t.id === activeTab?.id;
    return {
      ref: (el: HTMLButtonElement | null) => {
        btnRefs.current[index] = el;
      },
      id: tabDomId(t.id),
      role: "tab" as const,
      type: "button" as const,
      "aria-selected": selected,
      "aria-controls": selected ? panelDomId(t.id) : undefined,
      tabIndex: selected ? 0 : -1,
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => onTabKeyDown(e, index),
      onClick: () => selectTab(t.id, t.label),
    };
  }

  const panel = activeTab ? (
    <div role="tabpanel" id={panelDomId(activeTab.id)} aria-labelledby={tabDomId(activeTab.id)}>
      {activeTab.content}
    </div>
  ) : null;

  function selectTab(id: string, label: string) {
    if (nav && navLevel) nav.select(navLevel, id, navParentId);
    else setLocalActive(id);
    track("tab_view", { tab: label, metadata: { level: size, tabId: id } });
  }

  if (size === "tertiary") {
    return (
      <div>
        <div role="tablist" aria-label={listLabel} className="flex flex-wrap gap-2 mb-6">
          {tabs.map((t, i) =>
            theme === "jarvis" ? (
              <button
                key={t.id}
                {...tabProps(t, i)}
                className={`px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider border transition-colors ${
                  t.id === activeTab?.id
                    ? "bg-[var(--signal)] text-[var(--ink-950)] border-[var(--signal)] font-semibold"
                    : "border-[var(--line-control)] text-[var(--text-1)] hover:border-[var(--signal-dim)]"
                }`}
              >
                {t.label}
              </button>
            ) : (
              <button
                key={t.id}
                {...tabProps(t, i)}
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
        {panel}
      </div>
    );
  }

  const isPrimary = size === "primary";

  const buttonRow = (
    <div className={`overflow-x-auto overscroll-x-contain ${isPrimary ? "mb-8" : "mb-6"}`}>
      <div role="tablist" aria-label={listLabel} className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800 w-max min-w-full">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            {...tabProps(t, i)}
            className={`${isPrimary ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"} shrink-0 whitespace-nowrap font-medium border-b-2 -mb-px transition-colors ${
              t.id === activeTab?.id
                ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (!mobileDropdown) {
    return (
      <div>
        {buttonRow}
        {panel}
      </div>
    );
  }

  return (
    <div>
      {/* Narrow screens: a dropdown, so a 7-8-tab row never has to be
          discovered by scrolling sideways. Swapped for the button row at
          the sm breakpoint and up, where there's room for it. */}
      <div className={`sm:hidden ${isPrimary ? "mb-8" : "mb-6"}`}>
        <select
          aria-label={`${listLabel} (choose a section)`}
          value={activeTab?.id}
          onChange={(e) => {
            const t = tabs.find((tab) => tab.id === e.target.value);
            if (t) selectTab(t.id, t.label);
          }}
          className="w-full rounded-lg border border-zinc-400 dark:border-zinc-500 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-medium"
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="hidden sm:block">{buttonRow}</div>
      {panel}
    </div>
  );
}
