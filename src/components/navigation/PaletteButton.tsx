"use client";

import { usePathname } from "next/navigation";
import { OPEN_PALETTE_EVENT } from "./palette-event";

/**
 * The visible "Search" button in the top nav, so the palette is discoverable without knowing the shortcut. Only shown on the
 * home page, where the palette is mounted. `forceShow` is for the test page.
 */
export function PaletteButton({ forceShow = false }: { forceShow?: boolean }) {
  const pathname = usePathname();
  if (!forceShow && pathname !== "/") return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex items-center gap-2"
      style={{
        minHeight: 44,
        padding: "0 14px",
        background: "transparent",
        color: "var(--text-1)",
        border: "1px solid var(--line-control)",
        fontSize: 13,
        borderRadius: 6,
      }}
    >
      <span aria-hidden="true">⌕</span>
      <span>Search</span>
      <kbd className="hidden sm:inline text-xs" style={{ color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
        Ctrl K
      </kbd>
    </button>
  );
}
