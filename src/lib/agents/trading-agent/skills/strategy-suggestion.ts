import { getExpirations } from "@/lib/data/tradier";
import { fetchOptionsChain, fetchQuote } from "@/lib/data/market-data";
import { getDailyBars } from "./daily-bars";
import {
  closeSuggestion,
  findSuggestionForToday,
  insertSuggestion,
  isStrategySuggestionDbConfigured,
  listOpenSuggestions,
} from "@/lib/data/strategy-suggestion-db";
import type { MarketOptionContract } from "@/lib/data/market-data-types";
import type {
  GuidedTradeSignal,
  OptionStrategyVariant,
  PaperOptionRight,
  StrategySuggestion,
  SuggestedOptionContract,
} from "../types";

// meanReversionOverbought is this app's only short-side guided signal (see
// STRATEGY_DIRECTION in historical-backtest.ts) — every other type is long.
function directionFor(strategyType: string): "long" | "short" {
  return strategyType === "meanReversionOverbought" ? "short" : "long";
}

// Converts the signal's own trading-day horizon into a calendar-day buffer
// for expiration selection — ~1.4 calendar days per trading day (weekends),
// plus a flat 10-day cushion so the option doesn't expire right as the
// signal's horizon resolves (theta/early-assignment risk near expiration).
function minCalendarDaysOut(horizonDays: number): number {
  return Math.ceil(horizonDays * 1.4) + 10;
}

async function pickExpiration(ticker: string, horizonDays: number, todayDateKey: string): Promise<string | null> {
  const expirations = await getExpirations(ticker);
  if (expirations.length === 0) return null;
  const minDate = new Date(todayDateKey);
  minDate.setDate(minDate.getDate() + minCalendarDaysOut(horizonDays));
  const minDateKey = minDate.toISOString().slice(0, 10);
  return expirations.find((e) => e >= minDateKey) ?? expirations[expirations.length - 1];
}

function closestByStrike(contracts: MarketOptionContract[], targetPrice: number): MarketOptionContract | null {
  if (contracts.length === 0) return null;
  return contracts.reduce((best, c) => (Math.abs(c.strikePrice - targetPrice) < Math.abs(best.strikePrice - targetPrice) ? c : best));
}

const TARGET_SHORT_LEG_DELTA = 0.3;

/** Short leg for a debit spread: closest to 0.30 absolute delta, strictly further OTM than the long leg. */
function pickShortLeg(contracts: MarketOptionContract[], longStrike: number, direction: "long" | "short"): MarketOptionContract | null {
  const otmCandidates = contracts.filter((c) => (direction === "long" ? c.strikePrice > longStrike : c.strikePrice < longStrike));
  if (otmCandidates.length === 0) return null;
  return otmCandidates.reduce((best, c) =>
    Math.abs(Math.abs(c.delta) - TARGET_SHORT_LEG_DELTA) < Math.abs(Math.abs(best.delta) - TARGET_SHORT_LEG_DELTA) ? c : best
  );
}

interface StructurePick {
  expirationDate: string;
  optionRight: PaperOptionRight;
  longContract: MarketOptionContract;
  shortContract: MarketOptionContract | null; // set only for debit_spread
}

/**
 * Real chain-based structure selection — no synthetic pricing. Long leg is
 * always the strike closest to the live underlying price (ATM); the debit
 * spread's short leg is the real contract closest to 0.30 absolute delta,
 * further out of the money. Returns null wherever the ticker has no
 * options chain, no expiration far enough out, or the chain has no
 * contracts on the needed side — a real, disclosed gap, not a guess.
 */
async function pickStructure(ticker: string, horizonDays: number, direction: "long" | "short", variant: OptionStrategyVariant, todayDateKey: string): Promise<StructurePick | null> {
  const [quote, expirationDate] = await Promise.all([fetchQuote(ticker), pickExpiration(ticker, horizonDays, todayDateKey)]);
  if (!expirationDate) return null;

  const chain = await fetchOptionsChain(ticker, expirationDate);
  const optionRight: PaperOptionRight = direction === "long" ? "call" : "put";
  const sideContracts = optionRight === "call" ? chain.calls : chain.puts;
  const longContract = closestByStrike(sideContracts, quote.lastPrice);
  if (!longContract) return null;

  if (variant === "long_option") {
    return { expirationDate, optionRight, longContract, shortContract: null };
  }

  const shortContract = pickShortLeg(sideContracts, longContract.strikePrice, direction);
  if (!shortContract) return null;
  return { expirationDate, optionRight, longContract, shortContract };
}

/**
 * The internal, admin-only forward-testing ledger the user asked for:
 * every real guided-signal occurrence gets BOTH strategy variants recorded
 * here automatically — independent of whether any client places the
 * client-facing single-leg suggestion — so real forward (not backtested)
 * performance can be compared across structures over time. Idempotent per
 * (ticker, strategyType, variant, day): a signal still triggering on a
 * later poll of the same day never double-inserts.
 */
export async function recordSuggestionsForSignal(signal: GuidedTradeSignal, todayDateKey: string): Promise<void> {
  if (!isStrategySuggestionDbConfigured()) return;
  const direction = directionFor(signal.strategyType);
  const horizonMatch = signal.horizonLabel.match(/(\d+)/);
  const horizonDays = horizonMatch ? Number(horizonMatch[1]) : 20;

  for (const variant of ["long_option", "debit_spread"] as OptionStrategyVariant[]) {
    try {
      const existing = await findSuggestionForToday(signal.ticker, signal.strategyType, variant, todayDateKey);
      if (existing) continue;

      const picked = await pickStructure(signal.ticker, horizonDays, direction, variant, todayDateKey);
      if (!picked) continue;

      const entryDebit =
        variant === "long_option" ? picked.longContract.ask : picked.longContract.ask - (picked.shortContract?.bid ?? 0);

      await insertSuggestion({
        ticker: signal.ticker,
        strategyType: signal.strategyType,
        horizonLabel: signal.horizonLabel,
        horizonDays,
        direction,
        variant,
        underlyingSymbol: signal.ticker,
        expirationDate: picked.expirationDate,
        optionRight: picked.optionRight,
        longStrike: picked.longContract.strikePrice,
        shortStrike: picked.shortContract?.strikePrice ?? null,
        entryDebit,
        entryDate: todayDateKey,
        status: "open",
        exitDebit: null,
        exitDate: null,
        realizedPnlPerContract: null,
        closeReason: null,
      });
    } catch {
      // Per-variant isolation, same philosophy as guided-trade-signals.ts's
      // per-ticker isolation — one bad chain lookup never blocks the other
      // variant or the signal response itself.
    }
  }
}

/** Single-leg, ATM, expiring past the given horizon — the same real chain-based pick used for both the client-facing card and the internal ledger, exposed directly for callers that already know ticker/horizon/direction (e.g. the High-Conviction Strategy Playbook) rather than holding a full GuidedTradeSignal. */
export async function getOptionStructureForHypothesis(
  ticker: string,
  horizonDays: number,
  direction: "long" | "short",
  todayDateKey: string
): Promise<SuggestedOptionContract | null> {
  try {
    const picked = await pickStructure(ticker, horizonDays, direction, "long_option", todayDateKey);
    if (!picked) return null;
    return {
      underlyingSymbol: ticker,
      expirationDate: picked.expirationDate,
      optionRight: picked.optionRight,
      strikePrice: picked.longContract.strikePrice,
    };
  } catch {
    return null;
  }
}

/** The client-facing, always-placeable suggestion — single-leg, matches the exact structure just recorded (or a fresh lookup if the ledger write failed/is unconfigured). */
export async function getSuggestedOptionContract(signal: GuidedTradeSignal, todayDateKey: string): Promise<SuggestedOptionContract | null> {
  const direction = directionFor(signal.strategyType);
  const horizonMatch = signal.horizonLabel.match(/(\d+)/);
  const horizonDays = horizonMatch ? Number(horizonMatch[1]) : 20;
  return getOptionStructureForHypothesis(signal.ticker, horizonDays, direction, todayDateKey);
}

/**
 * Cron-callable: closes every open suggestion whose signal horizon has
 * actually elapsed (measured in real trading days via the underlying's own
 * daily bars — the same "N trading days forward" definition the backtest
 * engine itself uses, not a calendar-day approximation), marking it to the
 * live chain's current bid/ask rather than a synthetic settlement price.
 */
export async function resolveMaturedSuggestions(): Promise<{ closed: number; errors: { id: string; error: string }[] }> {
  const errors: { id: string; error: string }[] = [];
  let closed = 0;
  if (!isStrategySuggestionDbConfigured()) return { closed, errors };

  const open = await listOpenSuggestions();
  for (const s of open) {
    try {
      const bars = await getDailyBars(s.ticker, 400);
      const entryIdx = bars.findIndex((b) => b.dateKey === s.entryDate);
      if (entryIdx === -1) continue; // entry day not yet in the bar history's window — try again next run
      const tradingDaysElapsed = bars.length - 1 - entryIdx;
      if (tradingDaysElapsed < s.horizonDays) continue;

      const chain = await fetchOptionsChain(s.ticker, s.expirationDate);
      const sideContracts = s.optionRight === "call" ? chain.calls : chain.puts;
      const longContract = sideContracts.find((c) => c.strikePrice === s.longStrike);
      if (!longContract) {
        errors.push({ id: s.id, error: `Contract no longer quotable (${s.ticker} ${s.expirationDate} $${s.longStrike} ${s.optionRight}) — likely past expiration.` });
        continue;
      }

      let exitDebit: number;
      if (s.variant === "long_option") {
        exitDebit = longContract.bid; // closing a long = selling at the bid
      } else {
        const shortContract = sideContracts.find((c) => c.strikePrice === s.shortStrike);
        if (!shortContract) {
          errors.push({ id: s.id, error: `Short leg no longer quotable (${s.ticker} ${s.expirationDate} $${s.shortStrike} ${s.optionRight}).` });
          continue;
        }
        exitDebit = longContract.bid - shortContract.ask; // sell the long at bid, buy back the short at ask
      }

      const realizedPnlPerContract = (exitDebit - s.entryDebit) * 100;
      const today = new Date().toISOString().slice(0, 10);
      await closeSuggestion(s.id, exitDebit, today, realizedPnlPerContract, `Reached its ${s.horizonDays}-trading-day horizon.`);
      closed++;
    } catch (err) {
      errors.push({ id: s.id, error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  return { closed, errors };
}

export type { StrategySuggestion };
