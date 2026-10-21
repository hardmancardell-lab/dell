/**
 * Error codes of the Lab routes. The base codes are the mailbox ones (FAYE_MAILBOX_CONTRACT.md section 8); this adds the Lab-specific
 * ones. As everywhere in Faye, the friendly sentence is written HERE from the code. Nothing a database says is copied into a response,
 * and no response ever repeats the text of something that was refused. Sentences are grade 8 or lower (a test checks it).
 */
import { errorBody, HTTP_STATUS, isFayeErrorCode, type FayeErrorCode } from "../mailbox/errors";
import { jsonResponse } from "../mailbox/http";

export type LabExtraCode = "not_ready" | "held_out_wall" | "confirm_required" | "text_rejected" | "conflict" | "limit_reached";
export type LabErrorCode = FayeErrorCode | LabExtraCode;

const EXTRA: Record<LabExtraCode, { status: number; error: string }> = {
  not_ready: { status: 503, error: "The Lab is not set up yet. The database step has not been run." },
  held_out_wall: { status: 409, error: "Exam questions must never be taught, or the test stops working. I did not do that." },
  confirm_required: { status: 409, error: "This test is long and uses the same model as chat. Confirm to start it." },
  text_rejected: { status: 422, error: "That looks like a password, key or account number, so I did not save it." },
  conflict: { status: 409, error: "That clashes with something you already saved." },
  limit_reached: { status: 409, error: "You have reached the limit. Delete some items to add more." },
};

/** Lab wording for the shared codes (the mailbox sentences talk about chat, not the Lab). */
const SHARED: Partial<Record<FayeErrorCode, string>> = {
  disabled: "The Lab is switched off for now.",
  not_found: "That item was not found.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  too_large: "That is too long. Make it shorter.",
  bad_request: "That did not look right. Check it and try again.",
  faye_offline: "Faye is resting, so no test can start. Try again in a bit.",
  unavailable: "The Lab is not set up yet. The database step has not been run.",
};

const DETAIL_OK = /^[a-z_]{1,32}$/;

/** More exact sentences for a few (code, detail) pairs. */
const BY_DETAIL: Record<string, string> = {
  "conflict:already_train": "That question is already a training question. It cannot also be an exam question.",
  "conflict:already_heldout": "That question is already an exam question. It cannot also be a training question.",
  "conflict:duplicate": "You already have that.",
  "conflict:dismissed": "That correction was dismissed. Bring it back first.",
  "conflict:already_used": "That correction was already used.",
  "conflict:already_decided": "That note was already decided.",
  "conflict:not_dismissed": "That correction is not dismissed.",
  "rate_limited:in_flight": "A test is already waiting or running. Wait for it to finish.",
  "rate_limited:queue_full": "Faye has a full queue right now. Try again soon.",
  "rate_limited:route": "Too many requests. Wait a moment and try again.",
  "rate_limited:long_runs": "You have started enough long tests for today. Try again tomorrow.",
  "bad_request:rejected": "That did not pass the checks for length and characters.",
  "confirm_required:long": "This test takes 30 to 40 minutes and uses the same model as chat. Confirm to start it.",
};

export function isExtraCode(x: unknown): x is LabExtraCode {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(EXTRA, x);
}

export function toLabCode(x: unknown, fallback: LabErrorCode = "server_error"): LabErrorCode {
  if (isExtraCode(x)) return x;
  return isFayeErrorCode(x) ? x : fallback;
}

export function labStatus(code: LabErrorCode): number {
  return isExtraCode(code) ? EXTRA[code].status : HTTP_STATUS[code];
}

export function labSentence(code: LabErrorCode, detail?: unknown): string {
  const d = typeof detail === "string" && DETAIL_OK.test(detail) ? detail : "";
  if (d && BY_DETAIL[`${code}:${d}`]) return BY_DETAIL[`${code}:${d}`];
  if (isExtraCode(code)) return EXTRA[code].error;
  return SHARED[code] ?? errorBody(code).error;
}

export function labError(code: LabErrorCode, extra: { detail?: unknown; retryAfterSec?: number } = {}): Response {
  const body: { ok: false; code: LabErrorCode; error: string; detail?: string; retry_after_sec?: number } = {
    ok: false,
    code,
    error: labSentence(code, extra.detail),
  };
  if (typeof extra.detail === "string" && DETAIL_OK.test(extra.detail)) body.detail = extra.detail;
  const headers: Record<string, string> = {};
  if (typeof extra.retryAfterSec === "number" && Number.isFinite(extra.retryAfterSec) && extra.retryAfterSec > 0) {
    body.retry_after_sec = Math.min(86_400, Math.ceil(extra.retryAfterSec));
    headers["retry-after"] = String(body.retry_after_sec);
  }
  return jsonResponse(body, labStatus(code), headers);
}
