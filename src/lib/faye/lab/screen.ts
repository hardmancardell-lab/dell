/**
 * Text screen for Lab input (questions, better answers, notes, excerpts). Pure functions, no I/O.
 *
 * Lab text is the owner's own teaching material, so unlike Faye's memory it MAY talk about buying, selling and advice (a guardrail
 * practice question has to). What it must never hold is a secret: keys, tokens, passwords with a value, card numbers, SSN-like
 * numbers, account numbers, e-mail addresses. A hit is REFUSED with a reason code and the text is never echoed back or masked.
 * The database checks length, shape and control characters again; secret screening is this file's job.
 */

export type LabDropReason = "empty" | "length" | "control" | "secret" | "credential" | "card" | "ssn" | "account" | "contact";
export type LabScreen = { ok: true; text: string } | { ok: false; reason: LabDropReason };

const span = (lo: number, hi = lo) => String.fromCharCode(lo) + (hi === lo ? "" : "-" + String.fromCharCode(hi));
const HIDDEN = new RegExp(`[${[span(0xad), span(0x180e), span(0x200b, 0x200f), span(0x2028, 0x202e), span(0x2060, 0x206f), span(0xfeff), span(0xfff9, 0xfffb)].join("")}]`);
const TAGS = new RegExp(`[${String.fromCodePoint(0xe0000)}-${String.fromCodePoint(0xe007f)}]`, "u");
// Every control character except tab, line feed and carriage return (those are tidied below).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

function luhnOk(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const SECRET: RegExp[] = [
  /\b(sk|pk|rk)[-_][a-z0-9_-]{8,}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[a-z0-9]{20,}/,
  /github_pat_|\bxox[baprs]-|\bakia[0-9a-z]{12,}|\baiza[0-9a-z_-]{20,}|\bsbp_|\bsb_secret|\bfwt_[0-9a-f]{16,}/,
  /eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}/,
  /-----begin/,
  /\bbearer\s+[a-z0-9._~+/-]{8,}/,
];
// A credential WORD is fine in a teaching question ("What is a password manager?"). A word followed by a value is not.
const CREDENTIAL_VALUE: RegExp[] = [
  /\b(password|passwd|passcode|passphrase|api\s?key|apikey|secret\s?key|private\s?key|access\s?key|seed\s?phrase|recovery\s?phrase|token|pin|otp|secret)\s*(is|=|:)\s*\S{4,}/,
];
const SSN_SHAPE = /\b[0-9]{3}[ -][0-9]{2}[ -][0-9]{4}\b/;
const CARD_RUNS = /[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}|[0-9]{4}[ -][0-9]{6}[ -][0-9]{4,5}|[0-9]{13,19}/g;
const ACCOUNT: RegExp[] = [/\b(account|acct|routing|iban|swift|aba|sort\s+code)\b[^.]{0,30}[0-9]{6,}/, /[0-9]{10,}/];
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/;

export interface LabScreenOptions {
  min?: number;
  max: number;
  /** Keep line breaks (notes). Default false: everything becomes one line. */
  multiline?: boolean;
}

export function screenLabText(raw: unknown, opts: LabScreenOptions): LabScreen {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (HIDDEN.test(raw) || TAGS.test(raw) || CONTROL.test(raw)) return { ok: false, reason: "control" };
  let text: string;
  if (opts.multiline) {
    text = raw
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    text = raw.replace(/\s+/g, " ").trim();
  }
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length < (opts.min ?? 1) || text.length > opts.max) return { ok: false, reason: "length" };

  const t = text.normalize("NFKC").toLowerCase();
  if (SECRET.some((r) => r.test(t))) return { ok: false, reason: "secret" };
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{24,}/g)) {
    const g = m[0];
    if (/[0-9]/.test(g) || (/[A-Z]/.test(g) && /[a-z]/.test(g)) || /[+/=_]/.test(g) || (g.length >= 32 && !g.includes("-"))) {
      return { ok: false, reason: "secret" };
    }
  }
  if (CREDENTIAL_VALUE.some((r) => r.test(t))) return { ok: false, reason: "credential" };
  if (SSN_SHAPE.test(t)) return { ok: false, reason: "ssn" };
  for (const m of t.matchAll(CARD_RUNS)) {
    if (luhnOk(m[0].replace(/[^0-9]/g, ""))) return { ok: false, reason: "card" };
  }
  if (ACCOUNT.some((r) => r.test(t))) return { ok: false, reason: "account" };
  if (EMAIL.test(t)) return { ok: false, reason: "contact" };
  return { ok: true, text };
}

/** What replaces an excerpt that looks private: the rating is still saved, the text is not. */
export const HIDDEN_EXCERPT = "(hidden: this may hold private data)";
