/**
 * Pure rules for Delta Defender (the Expert-tier arcade game), split out so they can be tested without a
 * live options chain or a Phaser canvas (scripts/quality/literacy.test.mts runs them on Black-Scholes chains).
 *
 * Audit finding (2026-10): with a fixed $2,000 of capital and a "clear" bonus that needed all 8 contracts,
 * the 30 XP clear was unaffordable on modeled SPY chains (the 8 contracts nearest spot cost $2,330 to
 * $5,764 at their bids), and a run with zero clicks still paid 15 XP.
 *
 * Fix: the goal is to engage CLEAR_TARGET contracts (not all 8), and the starting capital is sized from the
 * real chain so that goal is always reachable but a free-for-all is not: capital = the cheapest CLEAR_TARGET
 * contracts' total cost plus CAPITAL_SLACK, rounded up to the next $100. High-delta (in-the-money) contracts
 * cost the most, so chasing score with the biggest deltas leaves you short of the goal.
 */
export const MAX_TARGETS = 8;
export const CLEAR_TARGET = 5;
export const CAPITAL_SLACK = 1.25;
export const XP_ON_CLEAR = 30;
export const XP_ON_ATTEMPT = 15;
export const CONTRACT_MULTIPLIER = 100;

export interface PricedContract {
  bid: number;
}

export interface DeltaRoundPlan {
  capital: number;
  clearTarget: number;
}

/** Dollar cost to engage a contract: its real bid times the 100-share multiplier. */
export const contractCost = (c: PricedContract): number => c.bid * CONTRACT_MULTIPLIER;

export function planDeltaRound(contracts: PricedContract[]): DeltaRoundPlan {
  const clearTarget = Math.min(CLEAR_TARGET, contracts.length);
  const cheapest = contracts.map(contractCost).sort((a, b) => a - b).slice(0, clearTarget);
  const need = cheapest.reduce((a, b) => a + b, 0);
  const capital = Math.max(100, Math.ceil((need * CAPITAL_SLACK) / 100) * 100);
  return { capital, clearTarget };
}

export interface DeltaOutcome {
  xp: number;
  cleared: boolean;
  /** False when nothing was engaged: no XP is paid and the module is not marked complete. */
  award: boolean;
}

export function deltaOutcome(engaged: number, clearTarget: number): DeltaOutcome {
  if (engaged <= 0) return { xp: 0, cleared: false, award: false };
  const cleared = engaged >= clearTarget;
  return { xp: cleared ? XP_ON_CLEAR : XP_ON_ATTEMPT, cleared, award: true };
}
