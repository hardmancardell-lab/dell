// Pending-confirmation store for the two Assistant tools that act on the user's behalf (submit_feedback writes a
// database row, open_paper_trading_ticket drives the UI). The model can only PROPOSE them: the proposal is parked
// here, and the tool takes effect only when the USER confirms, either by clicking a Confirm control that echoes
// the id back (`confirm: { id, approve }` in the request body) or by typing a plain "yes" / "no" as the whole
// next message. A prompt-injected tool result can therefore never cause a write by itself (audit finding H4).
//
// LIMITATION: in-memory and per instance. On a serverless platform a confirmation can land on a different (cold)
// instance, in which case the user is told no pending action was found and is asked to request it again. A shared
// store would fix that; the failure mode is safe (nothing happens), never a silent write.

import { randomUUID } from "crypto";

export type ConfirmableTool = "submit_feedback" | "open_paper_trading_ticket";
export const CONFIRMABLE_TOOLS: readonly string[] = ["submit_feedback", "open_paper_trading_ticket"];

export interface PendingAction {
  id: string;
  tool: ConfirmableTool;
  input: Record<string, unknown>;
  /** Plain-language description shown to the user, built from the VALIDATED input, never from model prose. */
  summary: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60_000;
const MAX_PENDING = 2000;
const store = new Map<string, PendingAction>();

function sweep(now: number) {
  if (store.size <= MAX_PENDING) return;
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
  while (store.size > MAX_PENDING) store.delete(store.keys().next().value as string);
}

/** One pending action per user key; a newer proposal replaces the older one. */
export function createPending(key: string, tool: ConfirmableTool, input: Record<string, unknown>, summary: string, now = Date.now()): PendingAction {
  const action: PendingAction = { id: randomUUID(), tool, input, summary, expiresAt: now + TTL_MS };
  store.set(key, action);
  sweep(now);
  return action;
}

export function peekPending(key: string, now = Date.now()): PendingAction | null {
  const p = store.get(key);
  if (!p) return null;
  if (p.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return p;
}

/** Remove and return the pending action if its id matches (or no id given, for the typed-reply path). */
export function takePending(key: string, id?: string, now = Date.now()): PendingAction | null {
  const p = peekPending(key, now);
  if (!p) return null;
  if (id !== undefined && p.id !== id) return null;
  store.delete(key);
  return p;
}

const YES = /^\s*(yes|y|yep|yeah|confirm|confirmed|ok|okay|sure|go ahead|submit|send it|do it|please do)[\s.!]*$/i;
const NO = /^\s*(no|n|nope|cancel|stop|don'?t|do not|never ?mind|discard)[\s.!]*$/i;
export const isAffirmation = (text: string) => YES.test(text);
export const isNegation = (text: string) => NO.test(text);

export function describePending(tool: ConfirmableTool, input: Record<string, unknown>): string {
  if (tool === "submit_feedback") {
    const msg = String(input.message ?? "");
    return `Submit this ${String(input.category ?? "other")} feedback to the Dellegate team: "${msg.length > 300 ? msg.slice(0, 300) + "..." : msg}"`;
  }
  const parts = [String(input.symbol ?? ""), String(input.assetClass ?? "equity")];
  if (input.optionRight) parts.push(`${String(input.optionRight)} ${String(input.strikePrice ?? "")} ${String(input.expirationDate ?? "")}`.trim());
  return `Open the Paper Trading ticket pre-filled with ${parts.join(" ")}. This places no order; you still review and submit it yourself.`;
}
