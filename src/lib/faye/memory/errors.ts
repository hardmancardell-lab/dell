/**
 * Error codes of the Faye memory routes. The base codes are the mailbox ones (FAYE_MAILBOX_CONTRACT.md section 8); this adds the
 * memory-specific ones. As in the mailbox, the friendly sentence is built HERE from the code - nothing a database says is copied
 * into a response, and no response ever repeats the text of a note that was refused.
 */
import { errorResponse, jsonResponse } from "../mailbox/http";
import { isFayeErrorCode, type FayeErrorCode } from "../mailbox/errors";

export type MemoryExtraCode = "text_rejected" | "conflict" | "limit_reached" | "paused" | "reauth_required";
export type MemoryErrorCode = FayeErrorCode | MemoryExtraCode;

const EXTRA: Record<MemoryExtraCode, { status: number; error: string }> = {
  text_rejected: { status: 422, error: "That note was not saved because it breaks the rules for what Faye may keep." },
  conflict: { status: 409, error: "That change conflicts with a note you already have." },
  limit_reached: { status: 409, error: "You have reached the limit of notes. Delete some to add more." },
  paused: { status: 409, error: "Learning is paused. Resume it in About me to let Faye propose notes." },
  reauth_required: { status: 403, error: "For your safety, sign in again first, then try once more." },
};

const DETAIL_OK = /^[a-z_]{1,32}$/;

export function isExtraCode(x: unknown): x is MemoryExtraCode {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(EXTRA, x);
}

/** Maps anything the database reported to a code we know; unknown values become `fallback`. */
export function toMemoryCode(x: unknown, fallback: MemoryErrorCode = "server_error"): MemoryErrorCode {
  if (isExtraCode(x)) return x;
  return isFayeErrorCode(x) ? x : fallback;
}

export function memError(code: MemoryErrorCode, extra: { detail?: unknown; retryAfterSec?: number } = {}): Response {
  if (!isExtraCode(code)) return errorResponse(code, extra);
  const body: { ok: false; code: MemoryExtraCode; error: string; detail?: string } = { ok: false, code, error: EXTRA[code].error };
  if (typeof extra.detail === "string" && DETAIL_OK.test(extra.detail)) body.detail = extra.detail;
  return jsonResponse(body, EXTRA[code].status);
}
