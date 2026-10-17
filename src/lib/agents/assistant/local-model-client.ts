// Real client for a self-hosted, OpenAI-compatible chat-completions server
// (Ollama, vLLM, LM Studio, text-generation-webui, and llama.cpp's own
// server all speak this same /v1/chat/completions + tool-calling wire
// format) - this file is a genuine working implementation, not a stub, even
// before a real fine-tuned model is actually deployed behind it. Converts
// this app's neutral LlmMessage/LlmToolSchema/LlmResponse shapes (defined in
// llm-client.ts, structurally the Anthropic Messages API shape) to and from
// OpenAI's chat-completions format, since that's what the two conventions
// actually differ on - tool calls/results as inline content blocks
// (Anthropic) vs. as separate messages with a `tool_calls` array and a
// `role: "tool"` reply (OpenAI).
//
// Robustness rules (from the AI-assistant audit): tool calls are detected by their PRESENCE, not by finish_reason
// (Ollama-style servers answer "stop" with tool_calls); arguments may be a JSON string, an object, or garbage
// (garbage is flagged on the block so the route returns a tool error instead of running with an empty input);
// missing tool-call ids are synthesized; <think> reasoning is stripped; an empty or error-shaped response is an
// explicit error, never a blank reply.

import type { LlmCallOptions, LlmContentBlock, LlmMessage, LlmResponse, LlmToolSchema } from "./llm-client";

const MAX_TOKENS = 2048; // same cap this app already uses for the Anthropic path, kept consistent across providers
const DEFAULT_TIMEOUT_MS = 25_000;

export function isLocalModelConfigured(): boolean {
  return Boolean(process.env.LOCAL_MODEL_URL);
}

interface OpenAiToolCall {
  id?: string;
  type?: "function";
  function: { name: string; arguments: unknown };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface OpenAiChatCompletionResponse {
  choices?: {
    message?: { role?: "assistant"; content?: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: "stop" | "tool_calls" | "length" | "content_filter" | string | null;
  }[];
  error?: { message?: string } | string;
}

function toOpenAiTools(tools: LlmToolSchema[]): { type: "function"; function: { name: string; description: string; parameters: LlmToolSchema["input_schema"] } }[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/**
 * The one real structural translation this file exists for: Anthropic
 * represents a tool call as an `assistant` message containing a
 * `tool_use` content block, and its result as the NEXT `user` message
 * containing a `tool_result` block. OpenAI instead puts the call in the
 * assistant message's own `tool_calls` array (content alongside it, not
 * blocks) and expects the result as a separate message with
 * `role: "tool"` and a matching `tool_call_id` - never bundled into a
 * user-role message. Text blocks in user messages are kept (they used to be dropped).
 */
export function toOpenAiMessages(system: string, messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === "assistant") {
      const textParts = msg.content.filter((b): b is Extract<LlmContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text);
      const toolUseBlocks = msg.content.filter((b): b is Extract<LlmContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      out.push({
        role: "assistant",
        content: textParts.length > 0 ? textParts.join("\n\n") : null,
        tool_calls:
          toolUseBlocks.length > 0
            ? toolUseBlocks.map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input) } }))
            : undefined,
      });
      continue;
    }

    // role === "user" with content blocks: tool_result blocks each become their own `role: "tool"` message; any text
    // blocks become one user message.
    const toolResultBlocks = msg.content.filter((b): b is Extract<LlmContentBlock, { type: "tool_result" }> => b.type === "tool_result");
    for (const b of toolResultBlocks) {
      out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `ERROR: ${b.content}` : b.content });
    }
    const userText = msg.content.filter((b): b is Extract<LlmContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n\n");
    if (userText) out.push({ role: "user", content: userText });
  }

  return out;
}

/** Remove chain-of-thought blocks some local reasoning models put in `content`. */
export function stripThinking(text: string): string {
  let t = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  // A lone closing tag means the opening was cut off: everything before it is reasoning.
  const close = t.search(/<\/think(?:ing)?>/i);
  if (close >= 0) t = t.slice(close).replace(/^<\/think(?:ing)?>/i, "");
  // An unterminated opening tag means the model ran out while "thinking": nothing usable after it.
  const open = t.search(/<think(?:ing)?>/i);
  if (open >= 0) t = t.slice(0, open);
  return t.trim();
}

let syntheticIdCounter = 0;
function syntheticToolId(): string {
  syntheticIdCounter += 1;
  return `call_${Date.now().toString(36)}_${syntheticIdCounter}`;
}

function parseArguments(raw: unknown): { input: Record<string, unknown>; invalid?: string } {
  if (raw === undefined || raw === null || raw === "") return { input: {} };
  if (typeof raw === "object" && !Array.isArray(raw)) return { input: raw as Record<string, unknown> };
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { input: parsed as Record<string, unknown> };
      return { input: {}, invalid: "arguments were valid JSON but not an object" };
    } catch {
      return { input: {}, invalid: "arguments were not valid JSON" };
    }
  }
  return { input: {}, invalid: "arguments had an unsupported type" };
}

export function fromOpenAiResponse(response: OpenAiChatCompletionResponse): LlmResponse {
  if (response && response.error) {
    const msg = typeof response.error === "string" ? response.error : response.error.message ?? "unknown error";
    throw new Error(`Local model returned an error: ${String(msg).slice(0, 300)}`);
  }
  const choice = response?.choices?.[0];
  if (!choice || !choice.message) {
    throw new Error("Local model returned no choices.");
  }

  const content: LlmContentBlock[] = [];
  const text = typeof choice.message.content === "string" ? stripThinking(choice.message.content) : "";
  if (text) content.push({ type: "text", text });

  const toolCalls = Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : [];
  const usedIds = new Set<string>();
  for (const tc of toolCalls) {
    if (!tc?.function || typeof tc.function.name !== "string" || !tc.function.name) continue;
    const { input, invalid } = parseArguments(tc.function.arguments);
    let id = typeof tc.id === "string" && tc.id ? tc.id : syntheticToolId();
    if (usedIds.has(id)) id = syntheticToolId();
    usedIds.add(id);
    content.push({ type: "tool_use", id, name: tc.function.name, input, ...(invalid ? { invalid_arguments: invalid } : {}) });
  }

  // Presence of tool calls decides, not finish_reason (Ollama and others report "stop" alongside tool_calls).
  const hasToolUse = content.some((b) => b.type === "tool_use");
  const stop_reason: LlmResponse["stop_reason"] = hasToolUse ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn";

  return { content, stop_reason };
}

async function postChat(url: string, headers: Record<string, string>, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  return fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(body) });
}

export async function callLocalModel(messages: LlmMessage[], tools: LlmToolSchema[], system: string, options: LlmCallOptions = {}): Promise<LlmResponse> {
  const baseUrl = process.env.LOCAL_MODEL_URL;
  if (!baseUrl) {
    throw new Error("LOCAL_MODEL_URL is not set.");
  }
  const model = process.env.LOCAL_MODEL_NAME ?? "local-model"; // Ollama/vLLM/LM Studio all take whatever model name is currently loaded/served
  const apiKey = process.env.LOCAL_MODEL_API_KEY; // most self-hosted servers need no key at all; optional for the ones that do (e.g. a reverse proxy in front of your own hardware)
  const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Newer OpenAI models reject `max_tokens` (they want `max_completion_tokens`); most self-hosted servers want
  // `max_tokens`. LOCAL_MODEL_TOKEN_PARAM picks one; if the server complains about the name we switch once and retry.
  let tokenParam = process.env.LOCAL_MODEL_TOKEN_PARAM === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens";
  const build = (param: string) => ({
    model,
    [param]: MAX_TOKENS,
    messages: toOpenAiMessages(system, messages),
    tools: toOpenAiTools(tools),
    ...(options.toolChoice === "none" ? { tool_choice: "none" } : {}),
  });

  let res = await postChat(url, headers, build(tokenParam), timeoutMs);
  if (res.status === 400) {
    const errText = await res.text().catch(() => "");
    if (/max_completion_tokens|max_tokens/i.test(errText)) {
      tokenParam = tokenParam === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      res = await postChat(url, headers, build(tokenParam), timeoutMs);
    } else {
      throw new Error(`Local model request failed: 400 ${errText.slice(0, 500)}`);
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Local model request failed: ${res.status} ${body.slice(0, 500)}`);
  }
  const json = (await res.json().catch(() => null)) as OpenAiChatCompletionResponse | null;
  if (!json) throw new Error("Local model returned a body that is not JSON.");
  return fromOpenAiResponse(json);
}
