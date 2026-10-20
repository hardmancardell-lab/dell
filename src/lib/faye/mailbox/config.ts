/** Feature flag and limits for the Faye mailbox. Contract: FAYE_MAILBOX_CONTRACT.md sections 1 and 10. */

export type Env = Record<string, string | undefined>;

/** FAYE_MAILBOX_ENABLED must be exactly "1" or "true" (any case). Unset or anything else = off. */
export function mailboxEnabled(env: Env = process.env): boolean {
  const v = (env.FAYE_MAILBOX_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export const LIMITS = {
  questionChars: 4000,
  /** The portfolio state sent with a chat turn is rebuilt from an allowlist and trimmed to this many serialized characters. */
  stateChars: 1500,
  /** Opaque run state of a continue turn (server.py MAX_STATE_BYTES). */
  continueStateBytes: 200 * 1024,
  continueResultsBytes: 1_500_000,
  continueResultsKeys: 64,
  /** Whole request body the create route will read. */
  bodyBytes: 2 * 1024 * 1024,
  provenanceBytes: 8 * 1024,
  memoryItems: 6,
  memoryChars: 900,
  memoryItemMinChars: 3,
  memoryItemMaxChars: 200,
  /** Long poll. */
  waitDefaultMs: 8000,
  waitMaxMs: 12000,
  pollIntervalMs: 300,
} as const;

/** Best-effort per-instance limits on top of the database caps (the database is the real limit). */
export const ROUTE_RATE = {
  createPerMinute: 30,
  pollPerMinute: 600,
  statusPerMinute: 120,
} as const;
