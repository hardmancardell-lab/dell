// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/assistant-confirm-ui.test.mts
// The Assistant's Confirm / Cancel buttons: they must send exactly the bare yes / no the server already understands, only
// while a proposal is pending and unexpired and is the latest message, and the component must wire them accessibly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONFIRM_MESSAGE, CANCEL_MESSAGE, parsePending, activePending } from "../../src/lib/agents/assistant/pending-ui.ts";
import { isAffirmation, isNegation } from "../../src/lib/agents/assistant/confirmations.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "\n  " + detail); };

t("Confirm sends a bare message the server reads as a yes, and nothing else", CONFIRM_MESSAGE === "yes" && isAffirmation(CONFIRM_MESSAGE) && !isNegation(CONFIRM_MESSAGE), CONFIRM_MESSAGE);
t("Cancel sends a bare message the server reads as a no, and nothing else", CANCEL_MESSAGE === "no" && isNegation(CANCEL_MESSAGE) && !isAffirmation(CANCEL_MESSAGE), CANCEL_MESSAGE);

const NOW = 1_000_000;
const wire = { id: "abc", tool: "submit_feedback", summary: "Submit this feedback", expiresInSec: 600 };
const p = parsePending(wire, NOW);
t("a server proposal is parsed with an absolute expiry", p && p.id === "abc" && p.expiresAt === NOW + 600_000, JSON.stringify(p));
t("null, missing or malformed pendingConfirmation gives no buttons", [null, undefined, "x", 5, {}, { id: "a" }, { id: "", tool: "t", summary: "s" }, { id: "a", tool: 1, summary: "s" }].every((x) => parsePending(x, NOW) === null), "");
t("a proposal with no usable expiry is treated as already expired", activePending([{ role: "assistant", pending: parsePending({ id: "a", tool: "t", summary: "s" }, NOW) }], NOW) === null, "");

const asst = { role: "assistant", pending: p };
t("buttons show for a pending, unexpired proposal on the latest message", activePending([{ role: "user" }, asst], NOW + 1000)?.id === "abc", "");
t("buttons go away once the proposal has expired", activePending([asst], NOW + 600_001) === null, "");
t("buttons go away as soon as anything is sent after the proposal (a yes, a no, or any other message)", activePending([asst, { role: "user" }], NOW + 1) === null && activePending([asst, { role: "user" }, { role: "assistant", pending: null }], NOW + 1) === null, "");
t("buttons never show on a user message or an empty chat", activePending([], NOW) === null && activePending([{ role: "user", pending: p }], NOW + 1) === null, "");
t("an older proposal does not show buttons when a newer assistant message follows it", activePending([asst, { role: "user" }, { role: "assistant" }], NOW + 1) === null, "");

// The component wiring, checked in the source (the component itself needs a browser).
const src = readFileSync(ROOT + "src/components/AssistantChatTab.tsx", "utf8");
t("component sends the shared CONFIRM_MESSAGE / CANCEL_MESSAGE through the same send() path as typing", /send\(CONFIRM_MESSAGE\)/.test(src) && /send\(CANCEL_MESSAGE\)/.test(src) && !/fetch\([^)]*confirm/.test(src), "");
t("buttons are real <button type=\"button\"> elements with aria labels", src.includes("aria-label={`Confirm: ") && src.includes("aria-label={`Cancel: ") && /type="button"[\s\S]{0,200}Confirm/.test(src), "");
t("buttons render only from activePending()", /activePending\(messages/.test(src), "");
t("the buttons sit in a labelled group, the prompt is announced politely, and focus is not stolen from the input", src.includes("role=\"group\"") && src.includes("role=\"status\" aria-live=\"polite\"") && !src.includes("confirmRef"), "");

console.log(`\n${passed} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
