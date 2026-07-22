import { NextResponse } from "next/server";
import { callClaude, isAnthropicConfigured } from "@/lib/agents/assistant/anthropic-client";
import type { AnthropicApiMessage, AnthropicContentBlock } from "@/lib/agents/assistant/anthropic-client";
import { ASSISTANT_TOOLS, dispatchTool } from "@/lib/agents/assistant/tools";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/agents/assistant/system-prompt";
import type { AssistantMessage } from "@/lib/agents/assistant/types";

// Server-side tool-use loop against the Anthropic Messages API. Capped so a
// pathological back-and-forth (or a model that never settles) can't hang a
// request indefinitely — same defensive-cap instinct as this app's other
// bounded loops (Monte Carlo simulation counts, retry limits).
const MAX_TOOL_ITERATIONS = 6;

export async function POST(request: Request) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      {
        error:
          "The assistant isn't configured yet — add a real ANTHROPIC_API_KEY to .env.local (get one at console.anthropic.com). This is the only key in this app with real per-message cost.",
      },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as { messages?: AssistantMessage[] };
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: "Request body must include a non-empty 'messages' array." }, { status: 400 });
    }

    const workingMessages: AnthropicApiMessage[] = body.messages.map((m) => ({ role: m.role, content: m.content }));
    const toolsUsed = new Set<string>();
    const dataLimitations = new Set<string>();
    let finalText = "";
    let hitIterationCap = true;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await callClaude(workingMessages, ASSISTANT_TOOLS, ASSISTANT_SYSTEM_PROMPT);
      workingMessages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        finalText = response.content
          .filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n\n");
        hitIterationCap = false;
        break;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> => b.type === "tool_use"
      );
      const toolResults: AnthropicContentBlock[] = [];
      for (const block of toolUseBlocks) {
        toolsUsed.add(block.name);
        const result = await dispatchTool(block.name, block.input);
        if (
          result &&
          typeof result === "object" &&
          "dataLimitations" in result &&
          Array.isArray((result as { dataLimitations: unknown }).dataLimitations)
        ) {
          for (const note of (result as { dataLimitations: string[] }).dataLimitations) dataLimitations.add(note);
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      workingMessages.push({ role: "user", content: toolResults });
    }

    if (hitIterationCap) {
      dataLimitations.add("Hit the maximum number of tool calls for one turn — the answer below may be based on partial data.");
      if (!finalText) {
        finalText = "I gathered some data but couldn't finish synthesizing a full answer in one turn — try asking a narrower follow-up.";
      }
    }

    return NextResponse.json({
      reply: finalText,
      toolsUsed: Array.from(toolsUsed),
      dataLimitations: Array.from(dataLimitations),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
