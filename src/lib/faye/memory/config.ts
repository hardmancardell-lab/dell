/** Feature flag and limits for Faye memory. Default OFF: only the exact values "1" or "true" turn it on. */

export type Env = Record<string, string | undefined>;

export function memoryEnabled(env: Env = process.env): boolean {
  const v = (env.FAYE_MEMORY_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export const MEMORY_LIMITS = {
  /** Pack budget (contract section 6 and design 3.5): 6 items, 900 characters, about 225 tokens. */
  packItems: 6,
  packChars: 900,
  /** Style notes that ride along on every question (design 3.5, "always-on style card"). */
  styleCard: 2,
  /** Candidates fetched for ranking. */
  candidateFetch: 80,
  /** Per-instance, best-effort limits on top of the database (the real limits are the database checks). */
  readPerMinute: 120,
  writePerMinute: 60,
  rememberPerMinute: 60,
  heavyPerTenMin: 5,
  bodyBytes: 32 * 1024,
  /** A note must be this young a sign-in to export or delete everything. */
  recentSessionMinutes: 30,
} as const;

/** Minutes since sign-in that still count as a "recent session". FAYE_RECENT_SESSION_MINUTES overrides, clamped to 1..240. */
export function recentSessionMinutes(env: Env = process.env): number {
  const n = Number(env.FAYE_RECENT_SESSION_MINUTES);
  if (!Number.isFinite(n) || n <= 0) return MEMORY_LIMITS.recentSessionMinutes;
  return Math.max(1, Math.min(240, Math.floor(n)));
}
