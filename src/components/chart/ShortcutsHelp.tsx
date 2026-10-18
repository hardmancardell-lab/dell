"use client";

import { useEffect, useRef } from "react";
import { CHART_SHORTCUTS } from "@/lib/chart/shortcuts";
import { CHART_CHROME } from "@/lib/chart/colors";

const GROUPS = ["Drawing", "View", "Selected drawing", "Help"] as const;

/** Small popover listing the chart's keyboard shortcuts. A real button with aria-expanded; Escape and an outside click close it. */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <span ref={root} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="chart-shortcuts-panel"
        aria-keyshortcuts="?"
        data-testid="shortcuts-button"
        onClick={() => onOpenChange(!open)}
        className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border"
        style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }}
      >
        Shortcuts (?)
      </button>
      {open && (
        <div
          id="chart-shortcuts-panel"
          role="region"
          aria-label="Chart keyboard shortcuts"
          data-testid="shortcuts-panel"
          className="jv-card"
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20, width: "min(92vw, 380px)", boxShadow: CHART_CHROME.popShadow }}
        >
          <p className="text-[11px] mb-2" style={{ color: "var(--text-2)" }}>
            Active while focus is inside the chart section (not while typing in a box).
          </p>
          {GROUPS.map((g) => (
            <div key={g} className="mb-2">
              <div className="jv-label" style={{ fontSize: 10 }}>
                {g}
              </div>
              <ul className="text-xs" style={{ color: "var(--text-1)" }}>
                {CHART_SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.id} className="flex justify-between gap-3 py-0.5">
                    <span>{s.action}</span>
                    <kbd className="font-mono" style={{ color: "var(--text-0)", border: "1px solid var(--line-control)", padding: "0 6px" }}>
                      {s.key === " " ? "Space" : s.key}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
