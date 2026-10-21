/**
 * Relay output guard (threat model T2, design 3.8). The Faye worker applies the same check while it streams; this copy runs in
 * the Next route so a compromised or buggy worker cannot hand the browser an overt recommendation inside a `generated` answer.
 *
 * PARITY: ADVICE_LEAK_RE mirrors ADVICE_LEAK_RE in Pilp_Assistant/pilp/assistant.py (the runtime guard: the eval's original
 * alternatives plus the 2026-10-20 tightening), and ADVICE_REDIRECT mirrors ADVICE_REDIRECT there. Tests: scripts/faye-output-guard.test.mts.
 * Deliberately narrow and literal: a false positive is cheap, a miss is not. The list only grows.
 * Limit: it checks the FINAL text of a generated answer. Streamed chunks already shown are replaced when the result arrives.
 *
 * "go with <ticker>": Python scopes a case-sensitive group inside a case-insensitive pattern ((?-i:...)). JavaScript lacks that on older
 * runtimes, so the phrase is matched by GO_WITH_RES instead: the ticker must be upper case (2 to 5 letters, or one letter other than A and I,
 * never ETF, IRA or USD), a $-prefixed symbol, or a well-known symbol in lower case. "go with a broad index fund" is not a leak.
 */
export const ADVICE_LEAK_RE =
  /\b(i\s+recommend|my\s+(top\s+)?pick\s+is|you\s+should\s+(buy|sell|invest|put)|i\s+would\s+(buy|put|invest)|the\s+best\s+(choice|option|stock|etf)\s+is|definitely\s+(buy|sell)|i(?:'|’)d\s+(buy|sell|put|invest)|i\s+would\s+sell|i\s+(suggest|advise)\s+(that\s+)?(you\s+)?(to\s+)?(buy|sell|invest|put)|my\s+recommendation|i\s+(strongly\s+)?recommend|we\s+recommend|you\s+(ought|need)\s+to\s+(buy|sell|invest)|buy\s+it\s+now)/i;

export const GO_WITH_RES: RegExp[] = [
  /\b[Gg][Oo]\s+[Ww][Ii][Tt][Hh]\s+(?!(?:ETF|IRA|USD)\b)(?:[A-Z]{2,5}|[B-HJ-Z])\b/,
  /\bgo\s+with\s+(?:\$[a-z]{1,5}|(?:nvda|aapl|msft|tsla|amzn|googl|voo|vti|spy|qqq|schd|amd|intc|btc|eth|gld))\b/i,
];

// What the person would read: NFKC, no invisible characters, one space between words (same as _guard_view in assistant.py).
const ZERO_WIDTH_RE = /[­​-‏‪-‮⁠-⁤﻿]/g;
export function guardView(text: string): string {
  return text.normalize("NFKC").replace(ZERO_WIDTH_RE, "").replace(/\s+/g, " ");
}

/** True when the text contains overt recommendation language (raw text or the guard view). */
export function adviceLeak(text: string): boolean {
  const hit = (s: string) => ADVICE_LEAK_RE.test(s) || GO_WITH_RES.some((re) => re.test(s));
  return hit(text) || hit(guardView(text));
}

export const ADVICE_REDIRECT =
  "I can not tell you what to buy or sell, and I do not predict prices; I am an educational assistant, not a licensed advisor. " +
  "What I can do: explain how the investment works, what its fees and risks look like, what role it plays in a portfolio, " +
  "and what your own holdings currently show. Ask me any of those and I will walk you through it.";

export function applyRelayGuard(text: string): { tripped: boolean; text: string } {
  if (adviceLeak(text)) return { tripped: true, text: ADVICE_REDIRECT };
  return { tripped: false, text };
}
