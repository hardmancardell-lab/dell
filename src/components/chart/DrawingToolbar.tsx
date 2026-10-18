"use client";

import { DRAWING_COLORS } from "@/lib/chart/colors";
import type { DrawTool, DrawingUiState } from "./DrawingController";

const TOOLS: { id: DrawTool; label: string; short: string; key: string }[] = [
  { id: "select", label: "Select and move drawings", short: "Select", key: "V" },
  { id: "hline", label: "Draw a horizontal line", short: "H-line", key: "H" },
  { id: "trend", label: "Draw a trend line", short: "Trend line", key: "T" },
  { id: "rect", label: "Draw a rectangle", short: "Rectangle", key: "R" },
];

/**
 * Drawing tools toolbar. Every control is a real button with a text label (colour swatches carry the colour name), the
 * tool buttons report aria-pressed, and the hint line is a polite live region so the next step is read out.
 */
export function DrawingToolbar({
  state,
  onTool,
  onColor,
  onDelete,
  onClear,
  onAddHLineAtLast,
}: {
  state: DrawingUiState;
  onTool: (t: DrawTool) => void;
  onColor: (hex: string) => void;
  onDelete: () => void;
  onClear: () => void;
  onAddHLineAtLast: () => void;
}) {
  const btn = "px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="mb-3" role="toolbar" aria-label="Drawing tools" data-testid="drawing-toolbar">
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-1)" }}>
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
          Draw
        </span>
        {TOOLS.map((t) => {
          const pressed = state.tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={btn}
              aria-pressed={pressed}
              aria-keyshortcuts={t.key}
              title={`${t.label} (${t.key})`}
              data-testid={`tool-${t.id}`}
              onClick={() => onTool(t.id)}
              style={pressed ? { background: "var(--signal)", color: "var(--ink-950)", borderColor: "var(--signal)", fontWeight: 600 } : { borderColor: "var(--line-control)", color: "var(--text-1)" }}
            >
              {t.short}
            </button>
          );
        })}
        <button type="button" className={btn} onClick={onAddHLineAtLast} title="Add a horizontal line at the last price (keyboard-friendly)" data-testid="tool-hline-last" style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }}>
          H-line at last price
        </button>
        <span role="group" aria-label="Drawing colour" className="flex items-center gap-1">
          {DRAWING_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Colour ${c.label}`}
              aria-pressed={state.color.toLowerCase() === c.hex.toLowerCase()}
              title={c.label}
              data-testid={`color-${c.id}`}
              onClick={() => onColor(c.hex)}
              style={{
                width: 18,
                height: 18,
                background: c.hex,
                border: state.color.toLowerCase() === c.hex.toLowerCase() ? "2px solid var(--text-0)" : "1px solid var(--line-control)",
              }}
            />
          ))}
        </span>
        <button type="button" className={btn} onClick={onDelete} disabled={!state.selectedId} data-testid="drawing-delete" style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }}>
          Delete selected
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            if (typeof window === "undefined" || window.confirm(`Remove all ${state.count} drawings on this chart?`)) onClear();
          }}
          disabled={state.count === 0}
          data-testid="drawing-clear"
          style={{ borderColor: "var(--line-control)", color: "var(--text-1)" }}
        >
          Clear all{state.count > 0 ? ` (${state.count})` : ""}
        </button>
      </div>
      <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }} aria-live="polite" data-testid="drawing-hint">
        {state.hint} Drawings are saved in this browser for this symbol and timeframe.
      </p>
    </div>
  );
}
