// Real client for a self-hosted, OpenAI-compatible chat-completions server
// (Ollama, vLLM, LM Studio, text-generation-webui, and llama.cpp's own
// server all speak this same /v1/chat/completions + tool-calling wire
// format) — this is the standard target for "your own hardware," so this
// file is a genuine working implementation, not a stub, even before a real
// fine-tuned model is actually deployed behind it. Converts this app's
// neutral LlmMessage/LlmToolSchema/LlmResponse shapes (defined in
// llm-client.ts, structurally the Anthropic Messages API shape) to and from
// OpenAI's chat-completions format, since that's what the two conventions
// actually differ on — tool calls/results as inline content blocks
// (Anthropic) vs. as separate messages with a `tool_calls` array and a
// `role: "tool"` reply (OpenAI).

import type { LlmContentBlock, LlmMessage, LlmResponse, LlmToolSchema } from "./llm-client";

const MAX_TOKENS = 2048; // same cap this app already uses for the Anthropic path, kept consistent across providers

export function isLocalModelConfigured(): boolean {
  return Boolean(process.env.LOCAL_MODEL_URL);
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiChatCompletionResponse {
  choices: {
    message: { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | string;
  }[];
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
 * `role: "tool"` and a matching `tool_call_id` — never bundled into a
 * user-role message.
 */
function toOpenAiMessages(system: string, messages: LlmMessage[]): OpenAiMessage[] {
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
            ? toolUseBlocks.map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }))
            : undefined,
      });
      continue;
    }

    // role === "user" with content blocks — in this app's real usage, that's
    // always one or more tool_result blocks (the app never sends a user
    // turn containing e.g. images), each becoming its own `role: "tool"` message.
    const toolResultBlocks = msg.content.filter((b): b is Extract<LlmContentBlock, { type: "tool_result" }> => b.type === "tool_result");
    for (const b of toolResultBlocks) {
      out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
    }
  }

  return out;
}

function fromOpenAiResponse(response: OpenAiChatCompletionResponse): LlmResponse {
  const choice = response.choices[0];
  if (!choice) {
    return { content: [], stop_reason: "end_turn" };
  }

  const content: LlmContentBlock[] = [];
  if (choice.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }
  for (const tc of choice.message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      // A local model producing malformed tool-call JSON is a real,
      // disclosed reliability gap vs. Claude — surfaced as an empty input
      // object rather than crashing the whole response, so at least any
      // accompanying text still reaches the user.
    }
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }

  const stop_reason: LlmResponse["stop_reason"] =
    choice.finish_reason === "tool_calls"
      ? "tool_use"
      : choice.finish_reason === "length"
        ? "max_tokens"
        : choice.finish_reason === "stop"
          ? "end_turn"
          : "end_turn";

  return { content, stop_reason };
}

export async function callLocalModel(messages: LlmMessage[], tools: LlmToolSchema[], system: string): Promise<LlmResponse> {
  const baseUrl = process.env.LOCAL_MODEL_URL;
  if (!baseUrl) {
    throw new Error("LOCAL_MODEL_URL is not set.");
  }
  const model = process.env.LOCAL_MODEL_NAME ?? "local-model"; // Ollama/vLLM/LM Studio all take whatever model name is currently loaded/served
  const apiKey = process.env.LOCAL_MODEL_API_KEY; // most self-hosted servers need no key at all; optional for the ones that do (e.g. a reverse proxy in front of your own hardware)

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: toOpenAiMessages(system, messages),
      tools: toOpenAiTools(tools),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Local model request failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as OpenAiChatCompletionResponse;
  return fromOpenAiResponse(json);
}
