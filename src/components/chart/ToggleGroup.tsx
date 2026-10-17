"use client";

import type { ReactNode } from "react";

export interface ToggleOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/**
 * Small segmented control: a labelled group of buttons where exactly one is pressed. Buttons carry aria-pressed, so the
 * state is read out and never relies on colour alone. Styled like the timeframe buttons.
 */
export function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  name,
}: {
  label: string;
  value: T;
  options: readonly ToggleOption<T>[];
  onChange: (v: T) => void;
  /** data-testid prefix for the buttons (used by the DOM checks on the test page). */
  name?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
        {label}
      </span>
      <div className="flex">
        {options.map((o, i) => {
          const pressed = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={pressed}
              disabled={o.disabled}
              title={o.title}
              data-testid={name ? `${name}-${o.value}` : undefined}
              onClick={() => onChange(o.value)}
              className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                marginLeft: i === 0 ? 0 : -1,
                ...(pressed
                  ? { background: "var(--signal)", color: "var(--ink-950)", borderColor: "var(--signal)", fontWeight: 600 }
                  : { borderColor: "var(--line-control)", color: "var(--text-1)" }),
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
