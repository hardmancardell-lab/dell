"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { OPEN_PALETTE_EVENT } from "./palette-event";

// The palette itself loads only when it is first opened; this host (a key listener) is all that ships with the page.
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });

/**
 * Mount once inside AppNavigationProvider. Opens the command palette on Ctrl+K / Cmd+K, or when the Search button in the nav
 * (PaletteButton) dispatches OPEN_PALETTE_EVENT.
 */
export function PaletteHost() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Fetch the palette chunk once the page is idle, so the first Ctrl+K does not lose keystrokes to a loading delay.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const warm = () => void import("./CommandPalette");
    if (w.requestIdleCallback) w.requestIdleCallback(warm);
    else setTimeout(warm, 2000);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  return open ? <CommandPalette onClose={close} /> : null;
}
