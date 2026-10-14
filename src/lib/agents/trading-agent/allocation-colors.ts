// Pure, zero-dependency colour choice for the allocation pie charts, kept apart from AllocationPieChart.tsx so it can be
// tested without loading recharts.

export const ALLOCATION_COLORS = ["#4fe8d0", "#f0a868", "#7c9eff", "#e8637a", "#c792ea", "#82e0aa", "#ffd166", "#5eead4"];

/** Labels that always get the same colour, whatever else is in the chart. Crypto's orange is not in the rotating palette. */
const FIXED_LABEL_COLORS: Record<string, string> = {
  Crypto: "#f7931a",
};

/**
 * The colour for the slice at `index` in a chart whose slices are `labels`. Crypto keeps a stable colour; the
 * others take the rotating palette in order, counting only the slices that are not fixed so adding a Crypto slice does
 * not shift every other slice's colour.
 */
export function allocationSliceColor(labels: string[], index: number): string {
  const label = labels[index];
  if (FIXED_LABEL_COLORS[label]) return FIXED_LABEL_COLORS[label];
  const rotatingIndex = labels.slice(0, index).filter((l) => !FIXED_LABEL_COLORS[l]).length;
  return ALLOCATION_COLORS[rotatingIndex % ALLOCATION_COLORS.length];
}
