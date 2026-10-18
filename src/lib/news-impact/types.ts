/**
 * Shared shapes for the News Impact study. Pure types: no network, no env, no React.
 *
 * The study answers two questions for one asset, with the project's usual statistics (n-1 SD, exact t, Benjamini-Hochberg,
 * seeded block bootstrap):
 *   A. Do dated company events (SEC filings) move it more than ordinary days do?   (business, or idiosyncratic, sensitivity)
 *   B. How much of its movement is market-wide, and do scheduled macro days move it more?   (systematic exposure)
 * Everything reports "moves with", never "causes".
 */

import type { AssetClass } from "@/lib/agents/trading-agent/types";

export type ImpactAssetClass = AssetClass;

/** One daily bar, already on a calendar date key (YYYY-MM-DD; Eastern for stocks and forex, UTC for crypto). */
export interface PriceBar {
  date: string;
  close: number;
  volume: number;
}

export interface FactorSpec {
  symbol: string;
  /** Plain label used in sentences, for example "the US stock market". */
  label: string;
  /** Short label for chart legends, for example "Stock market". */
  short: string;
}

export interface FactorPlan {
  assetClass: ImpactAssetClass;
  /** Factors in the order they are added. The first one is also the market-model benchmark for the event study. */
  factors: FactorSpec[];
  /** What the leftover share is called for this class, for example "company-specific". */
  ownLabel: string;
  /** True when the code has a dated own-event source for this class (SEC filings for stocks). */
  hasOwnEvents: boolean;
  /** Plain notes on what was chosen and why, and what is missing. */
  notes: string[];
}

/** An event with a calendar date, before it is mapped onto a trading day. */
export interface DatedEvent {
  /** YYYY-MM-DD, the first day on which the market could react. */
  date: string;
  type: string;
  label: string;
}

export interface EventTypeDef {
  id: string;
  label: string;
}

/** One comparison of an event group against ordinary days, on one measure. */
export interface GroupTest {
  /** Number of event observations used. */
  n: number;
  /** Number of ordinary-day observations. */
  nBase: number;
  eventMean: number | null;
  eventMedian: number | null;
  baseMean: number | null;
  baseMedian: number | null;
  /** eventMean / baseMean for the absolute-move measures (1 = no difference); null for volume. */
  ratio: number | null;
  ratioLo: number | null;
  ratioHi: number | null;
  /** eventMean - baseMean (in the measure's own units). */
  diff: number | null;
  diffLo: number | null;
  diffHi: number | null;
  /** Standard error of the ordinary-day mean as a share of that mean (so the reader can see it is small). */
  baseSePct: number | null;
  t: number | null;
  df: number | null;
  p: number | null;
  /** Benjamini-Hochberg adjusted p across the whole table of the asset. */
  pAdj: number | null;
  /** Fewer events than the row minimum: shown greyed, never framed as a finding. */
  thin: boolean;
  /** Enough events to say anything at all. */
  enough: boolean;
}

export interface EventGroupResult {
  id: string;
  label: string;
  /** Events mapped to a trading day, before thinning. */
  nEvents: number;
  day0: GroupTest;
  car: GroupTest;
  volume: GroupTest;
  /** Mean absolute abnormal return in percent on event days and on ordinary days (readable units). */
  absArPctEvent: number | null;
  absArPctBase: number | null;
}

export type EffectWord = "clearly-larger" | "somewhat-larger" | "no-clear-difference" | "smaller" | "not-enough";

export interface EventStudyResult {
  groups: EventGroupResult[];
  pooled: EventGroupResult;
  effect: EffectWord;
  /** Largest ratio the pooled interval cannot rule out (the limit of detection), or null. */
  ratioCannotRuleOut: number | null;
  testsInFamily: number;
  minHeadlineEvents: number;
  minTypeEvents: number;
}
