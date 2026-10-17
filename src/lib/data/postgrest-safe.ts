/**
 * Shared helpers for building PostgREST query strings from user-influenced values.
 *
 * The audit found that `or=(session_id.eq.<id>,session_id.is.null)` is injectable: encodeURIComponent keeps
 * `,` `(` `)` meaningful once PostgREST percent-decodes the query, so a crafted session id could add its own
 * conditions (for example `x,session_id.not.is.null` => every row). Defence in depth, both applied here:
 *   1. Strict allow-list patterns for every identifier that reaches a filter (rejects the hostile text outright).
 *   2. Values inside `or=(...)` groups are double-quoted and escaped per PostgREST rules, so even a value that
 *      slipped past (1) stays one literal.
 * Plain `col=eq.<value>` filters take the whole remainder literally, so they only need encoding, but they are
 * validated too so malformed ids fail fast with a clear 400 instead of leaking a database error string.
 */

/** Anonymous browser session ids are crypto.randomUUID() values; allow generous alphanumerics/underscore/hyphen only. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
/** Row ids (uuid), slugs, group ids. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** Tickers and crypto/option underlyings: letters, digits, dot, dash, caret, equals, slash. */
export const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.\-^=/]{0,31}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_PATTERN = /^\+?[0-9]{6,20}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;

/**
 * DECISION FOR THE OWNER: journal_positions rows created before the session_id column existed have
 * session_id IS NULL. Today every session can see them ("grandfathered": there was one real beta user then, so
 * hiding them would hide the owner's own old data). This constant makes that explicit. Set it to false after the
 * old rows are assigned to their real owner (UPDATE journal_positions SET session_id = '<owner session>' WHERE
 * session_id IS NULL) and every session will then see only its own rows.
 */
export const LEGACY_NULL_SESSION_ROWS_VISIBLE_TO_EVERYONE = true;

export class InvalidFilterValueError extends Error {
  constructor(label: string) {
    super(`Invalid ${label}.`);
    this.name = "InvalidFilterValueError";
  }
}

export function isValidSessionId(v: unknown): v is string {
  return typeof v === "string" && SESSION_ID_PATTERN.test(v);
}

export function assertSessionId(v: unknown): string {
  if (!isValidSessionId(v)) throw new InvalidFilterValueError("sessionId");
  return v;
}

export function assertId(v: unknown, label = "id"): string {
  if (typeof v !== "string" || !ID_PATTERN.test(v)) throw new InvalidFilterValueError(label);
  return v;
}

export function assertSymbol(v: unknown, label = "symbol"): string {
  if (typeof v !== "string" || !SYMBOL_PATTERN.test(v)) throw new InvalidFilterValueError(label);
  return v;
}

export function assertDate(v: unknown, label = "date"): string {
  if (typeof v !== "string" || !DATE_PATTERN.test(v)) throw new InvalidFilterValueError(label);
  return v;
}

export function assertPhone(v: unknown): string {
  if (typeof v !== "string" || !PHONE_PATTERN.test(v)) throw new InvalidFilterValueError("phone");
  return v;
}

export function assertToken(v: unknown): string {
  if (typeof v !== "string" || !TOKEN_PATTERN.test(v)) throw new InvalidFilterValueError("token");
  return v;
}

export function assertFiniteNumber(v: unknown, label = "number"): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new InvalidFilterValueError(label);
  return v;
}

export function assertOneOf<T extends string>(v: unknown, allowed: readonly T[], label: string): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new InvalidFilterValueError(label);
  return v as T;
}

export function clampLimit(v: unknown, fallback = 100, max = 1000): number {
  const n = typeof v === "number" && Number.isInteger(v) ? v : fallback;
  return Math.min(Math.max(n, 1), max);
}

/** URL-encoded id for a plain `col=eq.<value>` filter. */
export const pgId = (v: unknown, label = "id") => encodeURIComponent(assertId(v, label));
export const pgSymbol = (v: unknown, label = "symbol") => encodeURIComponent(assertSymbol(v, label));
export const pgSession = (v: unknown) => encodeURIComponent(assertSessionId(v));

/**
 * Quote a value for use inside an `or=(...)`/`and=(...)` group: wrap in double quotes and backslash-escape `\` and `"`
 * (PostgREST reserved-character rules), so `,` `(` `)` `.` `:` inside the value are literal.
 */
export function pgQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Filter that scopes a journal/paper row to its owner session. The session id is validated, then quoted.
 * Legacy NULL-session rows stay visible only while LEGACY_NULL_SESSION_ROWS_VISIBLE_TO_EVERYONE is true.
 */
export function sessionOwnershipFilter(sessionId: string): string {
  const quoted = encodeURIComponent(pgQuote(assertSessionId(sessionId)));
  if (!LEGACY_NULL_SESSION_ROWS_VISIBLE_TO_EVERYONE) return `session_id=eq.${encodeURIComponent(sessionId)}`;
  return `or=(session_id.eq.${quoted},session_id.is.null)`;
}

export function isValidId(v: unknown): v is string {
  return typeof v === "string" && ID_PATTERN.test(v);
}
