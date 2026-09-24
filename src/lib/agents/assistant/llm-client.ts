// Single, provider-agnostic entry point every real Claude-calling feature in
// this app should import from, instead of reaching into anthropic-client.ts
// (or, later, local-model-client.ts) directly. The five real callers as of
// this writing — the Assistant chat route, economic-outlook narrative,
// security-forecast, currency-analysis, and supply-demand-shock prompts —
// all go through callLlm() here, so switching the default provider (e.g.
// once a locally-hosted fine-tuned model is ready) is a one-file config
// change, not a rewrite touching every caller.

import {
  callClaude,
  isAnthropicConfigured,
  type AnthropicApiMessage,
  type AnthropicContentBlock,
  type AnthropicToolSchema,
} from "./anthropic-client";
import { callLocalModel, isLocalModelConfigured } from "./local-model-client";

// Neutral names, kept structurally identical to the Anthropic Messages API
// shape (role/content blocks, tool_use/tool_result) since that shape is
// generic enough to represent any tool-calling chat model, not just Claude
// — local-model-client.ts is what actually translates it to/from whatever
// wire format the self-hosted server expects (OpenAI-style function
// calling, by default).
export type LlmMessage = AnthropicApiMessage;
export type LlmContentBlock = AnthropicContentBlock;
export type LlmToolSchema = AnthropicToolSchema;
export interface LlmResponse {
  content: LlmContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
}

export type LlmProvider = "anthropic" | "local";

/**
 * "local" only activates when BOTH explicitly requested (LLM_PROVIDER=local)
 * AND actually configured (LOCAL_MODEL_URL set) — an explicit request with
 * no real endpoint configured is a real misconfiguration, surfaced as an
 * error from callLlm() below, not a silent fallback to Anthropic (which
 * would defeat the point if the whole reason for switching was the security/
 * data-residency benefit of never calling a third party).
 */
export function getLlmProvider(): LlmProvider {
  return process.env.LLM_PROVIDER === "local" ? "local" : "anthropic";
}

export function isLlmConfigured(): boolean {
  return getLlmProvider() === "local" ? isLocalModelConfigured() : isAnthropicConfigured();
}

export async function callLlm(messages: LlmMessage[], tools: LlmToolSchema[], system: string): Promise<LlmResponse> {
  const provider = getLlmProvider();
  if (provider === "local") {
    if (!isLocalModelConfigured()) {
      throw new Error("LLM_PROVIDER=local but LOCAL_MODEL_URL is not set — point it at your self-hosted inference server.");
    }
    return callLocalModel(messages, tools, system);
  }
  return callClaude(messages, tools, system);
}
