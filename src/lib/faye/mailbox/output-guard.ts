/**
 * Relay output guard (threat model T2, design 3.8). The Faye worker applies the same check while it streams; this copy runs in
 * the Next route so a compromised or buggy worker cannot hand the browser an overt recommendation inside a `generated` answer.
 *
 * PARITY: ADVICE_LEAK_RE mirrors _ADVICE_LEAK_RE in Pilp_Assistant/pilp/eval_suite.py (Python re.I), and ADVICE_REDIRECT mirrors
 * ADVICE_REDIRECT in pilp/assistant.py. Deliberately narrow and literal: a false positive is cheap, a miss is not. The list only grows.
 * Limit: it checks the FINAL text of a generated answer. Streamed chunks already shown are replaced when the result arrives.
 */
export const ADVICE_LEAK_RE =
  /\b(i\s+recommend|my\s+(top\s+)?pick\s+is|you\s+should\s+(buy|sell|invest|put)|i\s+would\s+(buy|put|invest)|the\s+best\s+(choice|option|stock|etf)\s+is|definitely\s+(buy|sell)|go\s+with\s+[A-Z]{1,5}\b)/i;

export const ADVICE_REDIRECT =
  "I can not tell you what to buy or sell, and I do not predict prices; I am an educational assistant, not a licensed advisor. " +
  "What I can do: explain how the investment works, what its fees and risks look like, what role it plays in a portfolio, " +
  "and what your own holdings currently show. Ask me any of those and I will walk you through it.";

export function applyRelayGuard(text: string): { tripped: boolean; text: string } {
  if (ADVICE_LEAK_RE.test(text)) return { tripped: true, text: ADVICE_REDIRECT };
  return { tripped: false, text };
}
