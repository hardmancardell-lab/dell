// Single, provider-agnostic entry point every real Claude-calling feature in
// this app should import from, instead of reaching into anthropic-client.ts
// (or, later, local-model-client.ts) directly. The real callers as of this
// writing - the Assistant chat route, economic-outlook narrative,
// security-forecast, currency-analysis, and supply-demand-shock prompts -
// all go through callLlm() here, so switching the default provider (e.g.
// once a locally-hosted fine-tuned model is ready) is a one-file config
// change, not a rewrite touching every caller.

import {
  callClaude,
  isAnthropicConfigured,
  type AnthropicApiMessage,
  type AnthropicContentBlock,
  type AnthropicToolSchema,
  type CallOptions,
} from "./anthropic-client";
import { callLocalModel, isLocalModelConfigured } from "./local-model-client";

// Neutral names, kept structurally identical to the Anthropic Messages API
// shape (role/content blocks, tool_use/tool_result) since that shape is
// generic enough to represent any tool-calling chat model, not just Claude
// - local-model-client.ts is what actually translates it to/from whatever
// wire format the self-hosted server expects (OpenAI-style function
// calling, by default). A hosted OpenAI model works through the same path:
// LLM_PROVIDER=local, LOCAL_MODEL_URL=https://api.openai.com, LOCAL_MODEL_API_KEY,
// LOCAL_MODEL_NAME and LOCAL_MODEL_TOKEN_PARAM=max_completion_tokens.
export type LlmMessage = AnthropicApiMessage;
export type LlmContentBlock = AnthropicContentBlock;
export type LlmToolSchema = AnthropicToolSchema;
export type LlmCallOptions = CallOptions;
export interface LlmResponse {
  content: LlmContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
}

export type LlmProvider = "anthropic" | "local";
const SUPPORTED_PROVIDERS: LlmProvider[] = ["anthropic", "local"];

export class UnsupportedLlmProviderError extends Error {
  constructor(value: string) {
    super(`LLM_PROVIDER="${value.slice(0, 40)}" is not supported. Use "anthropic" (default) or "local" (any OpenAI-compatible server, see LOCAL_MODEL_URL). Nothing was called.`);
    this.name = "UnsupportedLlmProviderError";
  }
}

/**
 * Unset or empty means Anthropic. "anthropic" and "local" (any letter case) are accepted. ANY other value (a typo,
 * "openai", "ollama") THROWS UnsupportedLlmProviderError instead of silently falling back to Anthropic, which would
 * send user text to a third party the operator did not choose.
 */
export function getLlmProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "") return "anthropic";
  if ((SUPPORTED_PROVIDERS as string[]).includes(raw)) return raw as LlmProvider;
  throw new UnsupportedLlmProviderError(process.env.LLM_PROVIDER ?? "");
}

/** The configuration problem to show an operator, or null when the provider choice is valid. */
export function llmProviderProblem(): string | null {
  try {
    getLlmProvider();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Unsupported LLM provider.";
  }
}

export function isLlmConfigured(): boolean {
  let provider: LlmProvider;
  try {
    provider = getLlmProvider();
  } catch {
    return false;
  }
  return provider === "local" ? isLocalModelConfigured() : isAnthropicConfigured();
}

export async function callLlm(messages: LlmMessage[], tools: LlmToolSchema[], system: string, options: LlmCallOptions = {}): Promise<LlmResponse> {
  const provider = getLlmProvider(); // throws on an unsupported value
  if (provider === "local") {
    if (!isLocalModelConfigured()) {
      throw new Error("LLM_PROVIDER=local but LOCAL_MODEL_URL is not set - point it at your self-hosted inference server.");
    }
    return callLocalModel(messages, tools, system, options);
  }
  return callClaude(messages, tools, system, options);
}
