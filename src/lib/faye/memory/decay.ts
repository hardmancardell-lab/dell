/**
 * Decay and conflict handling for Faye memory (design 3.7). Pure functions; the database applies the same rules when it
 * retires faded notes (faye_memory_purge) and when a newer approved note in the same slot replaces an older one
 * (faye_memory_supersede). The pack builder applies them again at read time, so a stale or conflicting row can never reach a prompt.
 *
 *  - Observed and model-proposed notes lose half their confidence every 90 days without being seen again; below 25 they are faded.
 *  - Stated and taught notes (the owner's own words) never decay.
 *  - One approved note per slot: the newest wins, the older one is retired and kept (linked by `supersedes`) until the owner deletes it.
 */
import type { Candidate } from "./types";

export const DECAY_HALF_LIFE_DAYS = 90;
export const FADED_BELOW = 25;
const DAY_MS = 86_400_000;

type DecayInput = Pick<Candidate, "source" | "confidence" | "last_observed_at" | "created_at">;

/** Confidence after decay, 0..100 (fractional). */
export function effectiveConfidence(item: DecayInput, now: number): number {
  const base = Math.max(0, Math.min(100, Number(item.confidence) || 0));
  if (item.source !== "observed" && item.source !== "proposed_by_model") return base;
  const seen = Date.parse(item.last_observed_at || item.created_at);
  if (!Number.isFinite(seen)) return base;
  const days = Math.max(0, (now - seen) / DAY_MS);
  return base * Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
}

export function isFaded(item: DecayInput, now: number): boolean {
  return effectiveConfidence(item, now) < FADED_BELOW;
}

/** Keeps one note per slot (the most recently approved or updated); notes without a slot are all kept. Input order is preserved. */
export function resolveSlotConflicts<T extends Pick<Candidate, "id" | "slot" | "updated_at" | "approved_at">>(items: T[]): T[] {
  const newest = new Map<string, T>();
  const stamp = (x: T) => Date.parse(x.approved_at || x.updated_at) || 0;
  for (const it of items) {
    if (!it.slot) continue;
    const cur = newest.get(it.slot);
    if (!cur || stamp(it) > stamp(cur) || (stamp(it) === stamp(cur) && it.id > cur.id)) newest.set(it.slot, it);
  }
  return items.filter((it) => !it.slot || newest.get(it.slot) === it);
}
