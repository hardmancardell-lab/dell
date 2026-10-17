// Plain fetch, no SDK - same convention as every other external service in
// this app (Alpaca, Tradier, OANDA, Supabase, Resend, Twilio).

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Override with ANTHROPIC_MODEL (for example when the alias below is retired). */
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048;
/** Hard ceiling for one provider call; the route passes a smaller remaining-budget value. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 25_000;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  /** `invalid_arguments` is set by the local-model translator when the model's tool arguments were not usable JSON; the route answers such a call with an error result instead of running the tool. */
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; invalid_arguments?: string }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicApiMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
}

export interface CallOptions {
  /** "none" forces a plain-text answer from the tools already gathered (used for the final synthesis step). */
  toolChoice?: "auto" | "none";
  /** Abort the provider call after this many ms. */
  timeoutMs?: number;
}

export async function callClaude(
  messages: AnthropicApiMessage[],
  tools: AnthropicToolSchema[],
  system: string,
  options: CallOptions = {}
): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  // The wire format must not carry our private extension field.
  const cleanMessages = messages.map((m) =>
    typeof m.content === "string"
      ? m
      : { ...m, content: m.content.map((b) => (b.type === "tool_use" ? { type: "tool_use" as const, id: b.id, name: b.name, input: b.input } : b)) }
  );
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS),
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      ...(options.toolChoice === "none" ? { tool_choice: { type: "none" } } : {}),
      messages: cleanMessages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic request failed: ${res.status} ${body.slice(0, 500)}`);
  }
  const json = (await res.json().catch(() => null)) as AnthropicResponse | null;
  if (!json || !Array.isArray(json.content)) {
    throw new Error("Anthropic returned an unexpected response shape.");
  }
  return json;
}
