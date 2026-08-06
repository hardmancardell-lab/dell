import type { JournalInstrumentType } from "@/lib/agents/trading-agent/types";

// Options are ×100 notional per contract, same convention as
// paper-trading-engine.ts's notionalMultiplier — shares are ×1.
export function journalMultiplier(instrumentType: JournalInstrumentType): number {
  return instrumentType === "shares" ? 1 : 100;
}

export function computeJournalRealizedPnl(
  instrumentType: JournalInstrumentType,
  quantity: number,
  entryPrice: number,
  exitPrice: number
): number {
  return (exitPrice - entryPrice) * quantity * journalMultiplier(instrumentType);
}

export function computeJournalCostBasis(
  instrumentType: JournalInstrumentType,
  quantity: number,
  entryPrice: number
): number {
  return quantity * entryPrice * journalMultiplier(instrumentType);
}
