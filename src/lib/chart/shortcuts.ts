// Pure: the chart's keyboard shortcuts as data (one source for the handler and the help popover) and the rule for when a
// key press belongs to the chart. Shortcuts only act while focus is inside the chart section and never while typing.

export interface ChartShortcut {
  /** `KeyboardEvent.key` value, compared case-insensitively for letters. */
  key: string;
  /** What it does, in a short phrase. */
  action: string;
  group: "Drawing" | "View" | "Selected drawing" | "Help";
  /** Action id the handler switches on. */
  id: string;
}

export const CHART_SHORTCUTS: readonly ChartShortcut[] = [
  { key: "v", action: "Select and move drawings", group: "Drawing", id: "tool-select" },
  { key: "h", action: "Horizontal line tool", group: "Drawing", id: "tool-hline" },
  { key: "t", action: "Trend line tool", group: "Drawing", id: "tool-trend" },
  { key: "r", action: "Rectangle tool", group: "Drawing", id: "tool-rect" },
  { key: "Escape", action: "Cancel the tool, or deselect", group: "Drawing", id: "cancel" },
  { key: "l", action: "Cycle the price scale: linear, log, percent", group: "View", id: "scale-cycle" },
  { key: "e", action: "Toggle extended hours (intraday stocks)", group: "View", id: "extended" },
  { key: ",", action: "Previous (longer) timeframe", group: "View", id: "tf-prev" },
  { key: ".", action: "Next (shorter) timeframe", group: "View", id: "tf-next" },
  { key: "[", action: "Select the previous drawing", group: "Selected drawing", id: "select-prev" },
  { key: "]", action: "Select the next drawing", group: "Selected drawing", id: "select-next" },
  { key: "Delete", action: "Delete the selected drawing (Backspace too)", group: "Selected drawing", id: "delete" },
  { key: "ArrowUp", action: "Nudge the selected drawing (arrow keys)", group: "Selected drawing", id: "nudge" },
  { key: "?", action: "Show or hide this list", group: "Help", id: "help" },
];

/** The handler's lookup: shortcut id for a key, or null. Arrow keys all map to "nudge"; Backspace to "delete". */
export function shortcutFor(key: string): string | null {
  if (key.startsWith("Arrow")) return "nudge";
  if (key === "Backspace") return "delete";
  const k = key.length === 1 ? key.toLowerCase() : key;
  return CHART_SHORTCUTS.find((s) => (s.key.length === 1 ? s.key.toLowerCase() : s.key) === k)?.id ?? null;
}

/** True when the event target is somewhere a person types: the shortcut must not fire there. */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "INPUT") {
    const type = (el.getAttribute?.("type") ?? "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "range", "color"].includes(type);
  }
  return tag === "TEXTAREA" || tag === "SELECT" || Boolean(el.isContentEditable);
}

/** Moves one step through the timeframe list (ids ordered longest to shortest). Clamps at both ends. */
export function stepTimeframe(order: readonly string[], current: string, dir: 1 | -1): string {
  const i = order.indexOf(current);
  if (i === -1) return order[0] ?? current;
  return order[Math.max(0, Math.min(order.length - 1, i + dir))];
}

export const SCALE_CYCLE = ["linear", "log", "percent"] as const;
