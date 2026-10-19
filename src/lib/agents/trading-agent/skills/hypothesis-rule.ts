import type { StrategyHypothesis } from "../types";

/**
 * Which statistics rule judged a ledger row?
 *
 * Rows written since the statistics fix (fix batch B, item 4) were corrected for the whole run: the family size is in
 * the fdr_family_size column and also written as text in the exit rule ("Corrected for N hypotheses tested together in
 * this run."). Rows written before that fix were judged with the old, weaker rule (a family of 5, a normal-curve test,
 * a win-rate filter), so a "validated" label on them cannot be trusted the same way.
 *
 * There is no rule-version column. The family size is the honest marker: a row with no family size anywhere was judged
 * under the old rule. The text is also read, so this works before the database column exists and for rows the
 * backfill has not reached.
 */

const FAMILY_TEXT = /Corrected for (\d{1,9}) hypotheses tested together/i;

/** Reads N from "Corrected for N hypotheses tested together in this run." Returns null when absent or not at least 1. */
export function parseFdrFamilySize(exitRule: string | null | undefined): number | null {
  if (typeof exitRule !== "string") return null;
  const m = FAMILY_TEXT.exec(exitRule);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** The family size from the column when it holds a real value, otherwise from the exit-rule text, otherwise null. */
export function effectiveFdrFamilySize(h: Pick<StrategyHypothesis, "fdrFamilySize" | "exitRule">): number | null {
  const col = h.fdrFamilySize;
  if (typeof col === "number" && Number.isInteger(col) && col >= 1) return col;
  return parseFdrFamilySize(h.exitRule);
}

/** True when the row has no family size anywhere, meaning it was judged under the older, weaker test. */
export function isLegacyRuleHypothesis(h: Pick<StrategyHypothesis, "fdrFamilySize" | "exitRule">): boolean {
  return effectiveFdrFamilySize(h) === null;
}

/** "validated" under the current rule only. Legacy rows never count, whatever their stored status says. */
export function isValidatedUnderCurrentRule(h: Pick<StrategyHypothesis, "status" | "fdrFamilySize" | "exitRule">): boolean {
  return h.status === "validated" && !isLegacyRuleHypothesis(h);
}

export const LEGACY_VALIDATED_LABEL = "Validated under an older, weaker test";
