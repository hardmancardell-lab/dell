/**
 * Error codes of the Faye mailbox (contract: FAYE_MAILBOX_CONTRACT.md section 8). The friendly sentence is built HERE from the
 * code; nothing a database, a worker or a model says is ever copied into an error response.
 */
export type FayeErrorCode =
  | "faye_offline"
  | "rate_limited"
  | "too_large"
  | "worker_lost"
  | "expired"
  | "not_allowed"
  | "auth_required"
  | "bad_request"
  | "not_found"
  | "disabled"
  | "generation_failed"
  | "server_error"
  | "unavailable";

export const HTTP_STATUS: Record<FayeErrorCode, number> = {
  faye_offline: 503,
  rate_limited: 429,
  too_large: 413,
  worker_lost: 502,
  expired: 410,
  not_allowed: 403,
  auth_required: 401,
  bad_request: 400,
  not_found: 404,
  disabled: 503,
  generation_failed: 502,
  server_error: 500,
  unavailable: 503,
};

export const FRIENDLY: Record<FayeErrorCode, string> = {
  faye_offline: "Faye is resting right now. Your notes are still here. Try again in a bit.",
  rate_limited: "Faye is busy or you hit today's limit. Wait a moment and try again.",
  too_large: "That request is too large for Faye. Ask a shorter question.",
  worker_lost: "Faye lost her train of thought. Please ask again.",
  expired: "Faye did not pick that up in time, so I dropped it. Please ask again.",
  not_allowed: "Faye is not available for this account.",
  auth_required: "Sign in to use Faye.",
  bad_request: "Faye could not read that request.",
  not_found: "That conversation was not found.",
  disabled: "Faye is switched off for now.",
  generation_failed: "Faye hit a problem while answering. Please ask again.",
  server_error: "Something went wrong on our side. Please try again.",
  unavailable: "Faye is not set up yet.",
};

const KNOWN = new Set<string>(Object.keys(HTTP_STATUS));

export function isFayeErrorCode(x: unknown): x is FayeErrorCode {
  return typeof x === "string" && KNOWN.has(x);
}

/** Maps anything a database or worker reported to a code we know; unknown values become `fallback`. */
export function toKnownCode(x: unknown, fallback: FayeErrorCode = "server_error"): FayeErrorCode {
  return isFayeErrorCode(x) ? x : fallback;
}

export interface ErrorBody {
  ok: false;
  code: FayeErrorCode;
  error: string;
  retry_after_sec?: number;
  detail?: string;
}

const DETAIL_OK = /^[a-z_]{1,32}$/;

export function errorBody(code: FayeErrorCode, extra: { retryAfterSec?: number; detail?: unknown } = {}): ErrorBody {
  const body: ErrorBody = { ok: false, code, error: FRIENDLY[code] };
  if (typeof extra.retryAfterSec === "number" && Number.isFinite(extra.retryAfterSec) && extra.retryAfterSec > 0) {
    body.retry_after_sec = Math.min(86_400, Math.ceil(extra.retryAfterSec));
  }
  if (typeof extra.detail === "string" && DETAIL_OK.test(extra.detail)) body.detail = extra.detail;
  return body;
}
