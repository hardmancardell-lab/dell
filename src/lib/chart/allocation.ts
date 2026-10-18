import type { AllocationSlice } from "@/lib/agents/trading-agent/types";

/** Adds a Cash slice (uninvested reserve) so the chart reflects total funds, not just holdings. */
export function withCashSlice(slices: AllocationSlice[], cashBalance: number, grandTotal: number): AllocationSlice[] {
  const rescaled = slices.map((s) => ({ ...s, percent: grandTotal > 0 ? (s.value / grandTotal) * 100 : 0 }));
  if (cashBalance > 0) {
    rescaled.push({ label: "Cash", value: cashBalance, percent: grandTotal > 0 ? (cashBalance / grandTotal) * 100 : 0 });
  }
  return rescaled;
}
