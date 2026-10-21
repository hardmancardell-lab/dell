// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-output-guard.test.mts
// The relay output guard (src/lib/faye/mailbox/output-guard.ts) against the Python runtime guard (Pilp_Assistant pilp/assistant.py
// ADVICE_LEAK_RE + output_guard_hit), hardening item 4 (WP-E finding 5) and item 2 (the "go with" false positive).
// Pure functions, no network, no database.
import { makeT } from "./fixtures/fake-fetch.mts";

const { t, summary } = makeT();
const G = await import("../src/lib/faye/mailbox/output-guard.ts");

const trips = (s: string) => G.applyRelayGuard(s).tripped;

// ---- the original eval pattern (must never stop being caught)
const original = ["I recommend NVDA", "my top pick is GLD", "my pick is MSFT", "you should buy it", "you should sell", "you should invest",
  "you should put it in", "I would buy this", "I would put it there", "I would invest", "the best choice is cash", "the best option is VOO",
  "the best stock is X", "the best etf is Y", "definitely buy", "definitely sell", "go with NVDA", "Go with VOO", "I RECOMMEND", "i   recommend"];
t("relay guard: every phrase of the original eval pattern is caught", original.every(trips), original.filter((p) => !trips(p)).join(" | "));

// ---- the Python tightening (2026-10-20)
const tightening = ["I'd buy NVDA now", "I’d sell it", "I would sell it", "I suggest you buy it", "I advise you to sell", "I suggest that you invest",
  "my recommendation is NVDA", "we recommend VOO", "I strongly recommend this", "you ought to buy gold", "you need to sell now", "buy it now",
  "I'd put it all in", "I’d invest in it"];
t("relay guard: the tightened phrases of the Python runtime guard are caught", tightening.every(trips), tightening.filter((p) => !trips(p)).join(" | "));
t("relay guard: the redirect text replaces a tightened phrase", G.applyRelayGuard("I'd buy NVDA now").text === G.ADVICE_REDIRECT);

// ---- hidden-text tricks the Python guard view removes
const tricks = ["I rec​ommend NVDA.", "Ｉ recommend NVDA.", "I  RECOMMEND  it.", "I­ recommend it", "you⁠ should buy it", "Ｇo with NVDA"];
t("relay guard: zero-width characters, full-width letters and spacing do not hide a leak", tricks.every(trips), tricks.filter((p) => !trips(p)).join(" | "));

// ---- go with: letters only, no longer any short word
const harmless = ["You can go with a broad index fund.", "Many people go with the first option.", "You may go with that approach for the long term.",
  "Some investors go with an equal weight plan.", "If you like, you can go with a shorter path first.", "Beginners often go with ETFs for diversification.",
  "People sometimes go with IRAs for retirement.", "You could go with Plan A or Plan B depending on your timeline."];
t("relay guard: harmless 'go with' sentences do not trip it", harmless.every((s) => !trips(s)), harmless.filter(trips).join(" | "));
const goWith = ["Go with NVDA.", "I would go with NVDA for now.", "go with VOO", "Go with SCHD for income.", "Just go with $nvda.", "go with nvda", "Go with  AAPL today", "Go with F."];
t("relay guard: real 'go with <ticker>' leaks still trip it", goWith.every(trips), goWith.filter((s) => !trips(s)).join(" | "));

// ---- benign educational answers
const safe = ["GEX measures dealer gamma exposure.", "An index fund tracks a market index and has low fees.", "Diversification spreads risk across holdings.",
  "I am not a licensed advisor. Here is how each behaves.", "Your holdings show 60 percent stocks.", "A recommendation letter is not part of investing.",
  "A covered call sells the right to buy shares at a set price.", "Bullish means expecting prices to rise.", "Experts often say you need to diversify.",
  "The P/E ratio divides price by earnings.", "Many advisors suggest reading the prospectus.", "You can buy it through most brokers."];
t("relay guard: benign educational sentences do not trip it", safe.every((s) => !trips(s)), safe.filter(trips).join(" | "));

// ---- shape
t("relay guard: non-leaks come back unchanged", G.applyRelayGuard("Plain text.").text === "Plain text." && G.applyRelayGuard("Plain text.").tripped === false);
t("relay guard: ADVICE_LEAK_RE is still exported and still matches the old phrases", G.ADVICE_LEAK_RE.test("You should buy it") && G.ADVICE_LEAK_RE.test("my top pick is X"));

summary();
