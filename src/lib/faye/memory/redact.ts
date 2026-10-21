/**
 * The "never stored" list for Faye memory (design 3.6). Pure functions, no I/O.
 *
 * A candidate note that trips ANY rule is DROPPED (the caller gets only a reason code, never the text back) - it is never
 * masked or partly kept. The same rules, in the same order, are enforced again by the database at write time
 * (faye_memory_text_problem in db/migrations/2026-10-20_faye_memory.sql); scripts/fixtures/faye-memory-vectors.json is run through
 * both. This module is also the place to extend the list: change both, then run scripts/faye-memory.test.mts.
 *
 * Order of checks (first hit wins): hidden characters, markup, rules-changing text, secrets and keys, passwords, SSN-like and
 * card/account numbers, contact details and addresses, exact money and share counts, sensitive categories.
 */

export type DropReason =
  | "empty"
  | "length"
  | "control"
  | "markup"
  | "instruction"
  | "secret"
  | "credential"
  | "ssn"
  | "card"
  | "account"
  | "contact"
  | "address"
  | "money"
  | "position"
  | "sensitive_topic";

export type Screen = { ok: true; text: string } | { ok: false; reason: DropReason };

export const NOTE_MIN = 3;
export const NOTE_MAX = 200;

// Zero-width, soft hyphen, bidi marks and overrides, line/paragraph separators, invisible operators, BOM, interlinear marks, tag characters.
const span = (lo: number, hi = lo) => String.fromCharCode(lo) + (hi === lo ? "" : "-" + String.fromCharCode(hi));
const HIDDEN = new RegExp(`[${[span(0xad), span(0x180e), span(0x200b, 0x200f), span(0x2028, 0x202e), span(0x2060, 0x206f), span(0xfeff), span(0xfff9, 0xfffb)].join("")}]`);
const TAGS = new RegExp(`[${String.fromCodePoint(0xe0000)}-${String.fromCodePoint(0xe007f)}]`, "u");
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const MARKUP = /[<>`{}|\\]/;

// Cyrillic and Greek look-alikes folded to Latin letters (so "ignоre" with a Cyrillic o is still caught).
const FOLD_FROM = "аеорсухіјѕһԁӏνοραεικτυχ";
const FOLD_TO = "aeopcyxijshdlvopaeiktux";
const FOLD = new Map<string, string>([...FOLD_FROM].map((c, i) => [c, FOLD_TO[i]]));

function fold(s: string): string {
  let out = "";
  for (const ch of s) out += FOLD.get(ch) ?? ch;
  return out;
}

function luhnOk(digits: string): boolean {
  if (!/^[0-9]{13,19}$/.test(digits)) return false;
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

// ---- rule lists (JavaScript spelling of the SQL patterns: \b where SQL has \y)
const INSTRUCTION_U: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass|skip|discard|overrule|circumvent)\b.{0,40}\b(previous|prior|above|earlier|former|preceding|all|any|your|the|these|those|system|safety)\b.{0,40}\b(rules?|instructions?|prompts?|guidelines?|constraints?|guardrails?|policies|policy|restrictions?|directives?|limits?|training|safeguards?)\b/,
  /\b(system|developer|hidden|initial)\s+(prompt|message|instructions?)\b/,
  /\byou\s+(are|will\s+be|shall\s+be)\s+now\b/,
  /\b(from\s+now\s+on|henceforth|going\s+forward)\b.{0,40}\byou\b/,
  /\b(pretend|act|behave|roleplay|role-play|imagine)\b.{0,30}\b(as|to\s+be|you\s+are|like)\b.{0,30}\b(advis[eo]r|broker|analyst|fiduciary|planner|unrestricted|dan|jailbroken)\b/,
  /\b(always|must|should|may\s+now|are\s+allowed\s+to|are\s+permitted\s+to|will)\b.{0,30}\b(give|giving|offer|provide|say|tell|recommend|suggest|advise)\b.{0,40}\b(advice|buy|sell|hold|trade|trades|what\s+to|which)\b/,
  /\b(tell|say|give|recommend|suggest|advise|pick|choose)\b.{0,30}\b(what|which)\b.{0,25}\b(buy|sell|hold|trade|invest)\b/,
  /\bwants?\s+(faye|you|her|it|the\s+assistant)\s+to\s+(just\s+)?(say|tell|recommend|give|pick|choose|decide)\b/,
  /\bdisclaim\w*/,
  /\b(no|without|skip|stop|drop|remove|disable|turn\s+off|omit|hide|ignore)\b.{0,25}\b(warnings?|caveats?|educational|guardrails?|filters?|safety|refus\w*|declin\w*)\b/,
  /\bnot\s+(financial\s+)?advice\b/,
  /\bguard\s?rails?\b/,
  /\b(jailbreak|dan\s+mode|developer\s+mode|do\s+anything\s+now|unrestricted|no\s+restrictions|without\s+restrictions|no\s+limits|without\s+limits|sudo|admin\s+mode|god\s+mode)\b/,
  /\b(system|assistant|user|human|developer)\s*:/,
  /###/,
  /\[\/?inst\]/,
  /\b(buy|sell)\b\s+(now|this|that|it|immediately|more|all|everything)\b/,
  /\byou\s+(should|must|shall|need\s+to|have\s+to|are\s+to|will|can|may)\b/,
];
const INSTRUCTION_SQUASH = /(ignore|disregard|forget|override)(previous|prior|all|the|your|above|any)+(rules|instructions|prompts?|guidelines|constraints)/;
const INSTRUCTION_SQUASH2 = /(systemprompt|youarenow|jailbreak|disclaimer|doanythingnow|developermode)/;

const SECRET_T: RegExp[] = [
  /\b(sk|pk|rk)[-_][a-z0-9_-]{8,}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[a-z0-9]{20,}/,
  /github_pat_|\bxox[baprs]-|\bakia[0-9a-z]{12,}|\baiza[0-9a-z_-]{20,}|\bsbp_|\bsb_secret|\bfwt_[0-9a-f]{16,}/,
  /eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}/,
  /-----begin/,
  /\bbearer\s+[a-z0-9._~+/-]{8,}/,
];
const CREDENTIAL_U: RegExp[] = [
  /\b(password|passwd|passcode|passphrase|api\s?key|apikey|secret\s?key|private\s?key|access\s?key|seed\s?phrase|recovery\s?phrase|mnemonic|credentials?|2fa|otp|bearer)\b/,
  /\b(secret|token|pin|code)\s*(is|=|:)\s*\S{4,}/,
  /\b(api|auth|access|secret)[-_ ]?token\b/,
];

const SSN_WORDS = /\b(ssn|social\s+security|tax\s+id|taxpayer\s+id|itin|passport|driver.?s?\s+licen[sc]e)\b/;
const SSN_SHAPE = /\b[0-9]{3}[ -][0-9]{2}[ -][0-9]{4}\b/;
const CARD_RUNS = /[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}|[0-9]{4}[ -][0-9]{6}[ -][0-9]{4,5}|[0-9]{13,19}/g;
const GROUPED_DIGITS = [/[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}/, /[0-9]{4}[ -][0-9]{6}[ -][0-9]{4,5}/, /[0-9]{9,}/];
const ACCOUNT_WORDS = [/\b(account|acct|routing|iban|swift|aba|sort\s+code)\b[^.]{0,30}[0-9]{4,}/, /\b[a-z]{2}[0-9]{2}[a-z0-9]{11,30}\b/];

const CONTACT: RegExp[] = [
  /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/,
  /(https?:|www\.)/,
  /\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}/,
  /\b\+[0-9]{1,3}[ .-]?[0-9]/,
];
const ADDRESS: RegExp[] = [
  /\b[0-9]{1,6}\s+([a-z0-9.]+\s+){1,4}(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|highway|hwy|parkway|pkwy)\b/,
  /\bp\.?\s?o\.?\s+box\b/,
];
const MONEY: RegExp[] = [
  /[$€£¥]\s?[0-9]/,
  /[0-9][0-9,.]*\s?(k|m|mm|bn|b)?\s?(usd|dollars?|bucks|eur|euros?|gbp|pounds?|yen)\b/,
  /\b(net\s+worth|account\s+balance|my\s+balance|balance\s+of|salary|my\s+income|income\s+of|i\s+earn)\b/,
  /\bportfolio\s+(is|was|worth|value)\b/,
];
const POSITION: RegExp[] = [/\b[0-9][0-9,]*\s*(shares?|contracts?|lots?|units?|coins?|tokens?)\b/, /\b(shares?|position\s+size)\s*(of|:|=)?\s*[0-9]/];
const SENSITIVE =
  /\b(diagnos\w*|cancer|diabet\w*|depress\w*|anxiety|medicat\w*|prescri\w+|therap\w+|pregnan\w*|hiv|disabilit\w*|lawsuit|sued|divorce|custody|arrest\w*|convict\w*|felony|bankruptcy|immigration|religio\w*|sexual\s+orientation|political\s+(party|affiliation)|surgery|mental\s+health|illness|disease)\b/;

const any = (res: RegExp[], s: string) => res.some((r) => r.test(s));

/**
 * Applies the "never stored" list to one candidate note. On success the returned text is whitespace-collapsed and trimmed
 * (never altered otherwise). Anything that is not clean is refused with a reason code.
 */
export function screenMemoryText(raw: unknown, opts: { min?: number; max?: number } = {}): Screen {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (HIDDEN.test(raw) || TAGS.test(raw) || CONTROL.test(raw)) return { ok: false, reason: "control" };
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  const min = opts.min ?? NOTE_MIN;
  const max = opts.max ?? NOTE_MAX;
  if (text.length < min || text.length > max) return { ok: false, reason: "length" };
  if (MARKUP.test(text)) return { ok: false, reason: "markup" };

  const t = fold(text.normalize("NFKC").toLowerCase());
  const u = t.replace(/@/g, "a").replace(/\$/g, "s").replace(/!/g, "i");
  const s = u.replace(/[^a-z0-9]+/g, "");
  const l = s.replace(/[013457]/g, (c) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" })[c] as string);

  if (any(INSTRUCTION_U, u) || INSTRUCTION_SQUASH.test(s) || INSTRUCTION_SQUASH.test(l) || INSTRUCTION_SQUASH2.test(s) || INSTRUCTION_SQUASH2.test(l)) {
    return { ok: false, reason: "instruction" };
  }
  if (any(SECRET_T, t)) return { ok: false, reason: "secret" };
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{24,}/g)) {
    const g = m[0];
    if (/[0-9]/.test(g) || (/[A-Z]/.test(g) && /[a-z]/.test(g)) || /[+/=_]/.test(g) || (g.length >= 32 && !g.includes("-"))) {
      return { ok: false, reason: "secret" };
    }
  }
  if (any(CREDENTIAL_U, u)) return { ok: false, reason: "credential" };

  if (SSN_WORDS.test(t) || SSN_SHAPE.test(t)) return { ok: false, reason: "ssn" };
  for (const m of t.matchAll(CARD_RUNS)) {
    if (luhnOk(m[0].replace(/[^0-9]/g, ""))) return { ok: false, reason: "card" };
  }
  if (any(GROUPED_DIGITS, t) || any(ACCOUNT_WORDS, t)) return { ok: false, reason: "account" };

  if (any(CONTACT, t)) return { ok: false, reason: "contact" };
  if (any(ADDRESS, t)) return { ok: false, reason: "address" };
  if (any(MONEY, t)) return { ok: false, reason: "money" };
  if (any(POSITION, t)) return { ok: false, reason: "position" };
  if (SENSITIVE.test(t)) return { ok: false, reason: "sensitive_topic" };
  return { ok: true, text };
}

/** Friendly, text-free explanation for a refusal (safe to show; it never repeats the refused text). */
export function dropMessage(reason: DropReason): string {
  switch (reason) {
    case "instruction":
      return "I keep notes about you, not instructions for me, so I did not save that.";
    case "secret":
    case "credential":
    case "card":
    case "account":
    case "ssn":
      return "That looks like a key, password or account number, so I did not save it.";
    case "money":
    case "position":
      return "I do not keep exact amounts, balances or share counts, so I did not save that.";
    case "contact":
    case "address":
      return "I do not keep contact details or addresses, so I did not save that.";
    case "sensitive_topic":
      return "I do not keep health, legal or similar personal details, so I did not save that.";
    case "length":
      return "That note must be between 3 and 200 characters, so I did not save it.";
    default:
      return "I could not save that note.";
  }
}
