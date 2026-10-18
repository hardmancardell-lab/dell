"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAppNavigation } from "@/lib/navigation/app-navigation";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { buildPaletteItems, itemsForKeys, searchPalette, type PaletteItem } from "@/lib/navigation/palette-items";
import { useStudyPrefs } from "./use-study-prefs";

/**
 * The command palette: one search box for every study, every tab and every watchlist ticker. Opened by Ctrl+K / Cmd+K or the
 * Search button in the nav (see PaletteHost). It is a modal dialog: focus moves into the search box, Tab stays inside, Escape
 * closes, and focus returns to whatever had it before. The list follows the ARIA combobox/listbox pattern so a screen
 * reader hears the highlighted result as the arrow keys move.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useAppNavigation();
  const { entries } = useWatchlist();
  const { prefs, pushRecent, togglePin } = useStudyPrefs();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const all = useMemo(
    () => buildPaletteItems({ lastAssetClass: nav.lastAssetClass, watchlist: entries.map((e) => ({ symbol: e.symbol, assetClass: e.assetClass })) }),
    [nav.lastAssetClass, entries]
  );

  // Empty query: pinned favourites, then recents, then everything. Typing: ranked matches.
  const sections = useMemo(() => {
    if (query.trim()) return [{ label: null as string | null, items: searchPalette(all, query) }];
    const pinned = itemsForKeys(all, prefs.pins);
    const pinnedKeys = new Set(pinned.map((i) => i.key));
    const recent = itemsForKeys(all, prefs.recents).filter((i) => !pinnedKeys.has(i.key));
    const shown = new Set([...pinnedKeys, ...recent.map((i) => i.key)]);
    const rest = all.filter((i) => !shown.has(i.key));
    return [
      { label: "Pinned", items: pinned },
      { label: "Recent", items: recent },
      { label: "Everything", items: rest },
    ].filter((s) => s.items.length > 0);
  }, [all, query, prefs.pins, prefs.recents]);

  const flat: PaletteItem[] = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(() => {
    returnFocus.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement && document.contains(el)) el.focus();
    };
  }, []);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    pushRecent(item.key);
    nav.navigate({ ...item.target });
    onClose();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter" && e.target === inputRef.current) {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Tab") {
      // Focus trap: the tab stops are the search box, the Close button and the pin button.
      const stops = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const current = flat[active];
  let index = -1;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "color-mix(in srgb, var(--ink-950) 72%, transparent)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 12px 12px" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--ink-900)",
          border: "1px solid var(--line-bright)",
          borderRadius: 8,
          color: "var(--text-0)",
        }}
      >
        <div className="flex items-center gap-2 px-3 py-3 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
          <h2 id={titleId} className="sr-only">
            Search studies, tabs and tickers
          </h2>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat.length ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Search studies, tabs and tickers"
            placeholder="Search studies, tabs, tickers…"
            autoComplete="off"
            spellCheck={false}
            className="jv-input flex-1"
            style={{ minHeight: 44, fontSize: 16 }}
          />
          <button type="button" className="jv-btn-outline" style={{ minHeight: 44, minWidth: 44 }} onClick={onClose} aria-label="Close search">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div style={{ overflowY: "auto" }}>
          <p role="status" aria-live="polite" className="sr-only">
            {flat.length === 0 ? "No results" : `${flat.length} results`}
          </p>
          {flat.length === 0 ? (
            <p className="text-sm p-4" style={{ color: "var(--text-1)" }}>
              Nothing matches “{query.trim()}”. Try a study name, a market, or a ticker like AAPL.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Results" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {sections.map((sec) => (
                <li key={sec.label ?? "results"} role="presentation">
                  {sec.label && (
                    <div className="jv-label" role="presentation" style={{ padding: "10px 16px 4px", marginBottom: 0 }}>
                      {sec.label}
                    </div>
                  )}
                  <ul role="group" aria-label={sec.label ?? "Results"} style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {sec.items.map((item) => {
                      index += 1;
                      const i = index;
                      const selected = i === active;
                      const pinned = prefs.pins.includes(item.key);
                      return (
                        <li
                          key={item.key}
                          id={optionId(i)}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(i)}
                          onClick={() => choose(item)}
                          className="flex items-center justify-between gap-3"
                          style={{
                            minHeight: 44,
                            padding: "8px 16px",
                            cursor: "pointer",
                            background: selected ? "var(--ink-700)" : "transparent",
                            borderLeft: `3px solid ${selected ? "var(--signal)" : "transparent"}`,
                          }}
                        >
                          <span style={{ minWidth: 0 }}>
                            <span className="block text-sm" style={{ color: "var(--text-0)" }}>
                              {pinned && <span style={{ color: "var(--signal)" }}>★ </span>}
                              {item.title}
                            </span>
                            <span className="block text-xs" style={{ color: "var(--text-2)" }}>
                              {item.subtitle}
                            </span>
                          </span>
                          <span className="text-xs shrink-0" style={{ color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
                            {item.kind}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs shrink-0" style={{ borderTop: "1px solid var(--line)", color: "var(--text-2)" }}>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close
          </span>
          {current && current.kind !== "tab" && (
            <button type="button" className="jv-btn-outline" style={{ minHeight: 36 }} onClick={() => togglePin(current.key)}>
              {prefs.pins.includes(current.key) ? "Unpin" : "Pin"} “{current.title}”
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
