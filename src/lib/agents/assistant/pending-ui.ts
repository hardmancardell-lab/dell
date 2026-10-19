// Client-side helpers for the Assistant's Confirm / Cancel buttons. Pure, so they can be tested under plain Node.
//
// The server parks a proposed action (submit feedback, open the paper-trading ticket) and returns `pendingConfirmation`
// (see src/app/api/assistant/chat/route.ts and confirmations.ts). The action runs only when the person answers. The
// buttons answer by sending exactly what typing would: the bare message "yes" or "no", through the same send path.
// They are shown only while that proposal is the latest message and has not expired.

/** The exact messages the buttons send. They match isAffirmation / isNegation on the server (the tests check this). */
export const CONFIRM_MESSAGE = "yes";
export const CANCEL_MESSAGE = "no";

export interface PendingUi {
  id: string;
  tool: string;
  /** Plain-language description built by the server from validated input. */
  summary: string;
  /** Epoch milliseconds when the server will forget the proposal. */
  expiresAt: number;
}

/** Reads the response field defensively; anything malformed means "no pending action" (so no buttons). */
export function parsePending(raw: unknown, receivedAt: number): PendingUi | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id || typeof r.tool !== "string" || typeof r.summary !== "string") return null;
  const secs = typeof r.expiresInSec === "number" && Number.isFinite(r.expiresInSec) ? Math.max(0, r.expiresInSec) : 0;
  return { id: r.id, tool: r.tool, summary: r.summary, expiresAt: receivedAt + secs * 1000 };
}

interface MessageWithPending {
  role: "user" | "assistant";
  pending?: PendingUi | null;
}

/**
 * The proposal the buttons should answer, or null. Only the LAST message counts: once the person types anything (or
 * presses a button) the proposal is no longer the latest message and the buttons go away.
 */
export function activePending(messages: MessageWithPending[], now: number): PendingUi | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || !last.pending) return null;
  return last.pending.expiresAt > now ? last.pending : null;
}
