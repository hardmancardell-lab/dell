import type { ReactNode } from "react";

/**
 * Shared jarvis-system stat tile — was independently redefined nearly
 * identically across ~8 files; this is the union of every prop shape those
 * copies needed (label as ReactNode covers the GlossaryTerm-wrapped label
 * cases, tone covers the up/down/neutral color cases).
 */
export function StatCard({
  label,
  value,
  sub,
  tone,
  valueSize = 18,
}: {
  label: ReactNode;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "neutral";
  valueSize?: number;
}) {
  const color = tone === "up" ? "var(--signal)" : tone === "down" ? "var(--danger)" : "var(--text-0)";
  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="jv-label">{label}</div>
      <div className="jv-cond c-neutral" style={{ fontSize: valueSize, color }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
