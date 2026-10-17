// Request-side guards for the Assistant chat route: size caps and a strict allow-list for the conversation history
// the browser sends. The browser is not trusted: it may only supply plain user/assistant TEXT turns. System-role
// messages and any structured content (tool_use / tool_result blocks, arrays, objects) are dropped, so a forged
// "tool result" with a fake price can never reach the model as if it were real tool output (audit finding H2).

import type { LlmMessage } from "./llm-client";

/** Whole request body, in characters. */
export const MAX_BODY_CHARS = 100_000;
/** Most recent turns kept. Older turns are dropped (the UI keeps the full transcript locally). */
export const MAX_HISTORY_MESSAGES = 30;
/** Largest single turn. */
export const MAX_MESSAGE_CHARS = 8_000;
/** Total characters across the kept history; oldest turns are dropped first to fit. */
export const MAX_HISTORY_CHARS = 24_000;

export type HistoryResult =
  | { ok: true; messages: LlmMessage[]; dropped: number; trimmed: number; lastUserText: string }
  | { ok: false; status: number; error: string };

export function sanitizeHistory(raw: unknown): HistoryResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, status: 400, error: "Request body must include a non-empty 'messages' array." };
  }
  const kept: { role: "user" | "assistant"; content: string }[] = [];
  let dropped = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) { dropped++; continue; }
    const m = item as Record<string, unknown>;
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") { dropped++; continue; }
    const content = m.content.trim();
    if (!content) { dropped++; continue; }
    if (content.length > MAX_MESSAGE_CHARS) {
      return { ok: false, status: 413, error: `A message is longer than ${MAX_MESSAGE_CHARS} characters.` };
    }
    kept.push({ role: m.role, content });
  }

  let trimmed = 0;
  while (kept.length > MAX_HISTORY_MESSAGES) { kept.shift(); trimmed++; }
  let total = kept.reduce((s, m) => s + m.content.length, 0);
  while (total > MAX_HISTORY_CHARS && kept.length > 1) { total -= kept.shift()!.content.length; trimmed++; }
  while (kept.length > 0 && kept[0].role !== "user") { kept.shift(); trimmed++; }

  const last = kept[kept.length - 1];
  if (!last || last.role !== "user") {
    return { ok: false, status: 400, error: "The last message must be a user message with text." };
  }
  return { ok: true, messages: kept, dropped, trimmed, lastUserText: last.content };
}
