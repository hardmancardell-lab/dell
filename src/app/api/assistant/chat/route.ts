import { NextResponse } from "next/server";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { callLlm, isLlmConfigured, llmProviderProblem } from "@/lib/agents/assistant/llm-client";
import type { LlmMessage, LlmContentBlock } from "@/lib/agents/assistant/llm-client";
import { ASSISTANT_TOOLS, runTool } from "@/lib/agents/assistant/tools";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/agents/assistant/system-prompt";
import { MAX_BODY_CHARS, sanitizeHistory } from "@/lib/agents/assistant/request-guards";
import { createPending, isAffirmation, isNegation, peekPending, takePending, type PendingAction } from "@/lib/agents/assistant/confirmations";
import { clientIp, SlidingWindowLimiter, tooManyRequests } from "@/lib/access/rate-limit";
import { isValidSessionId } from "@/lib/data/postgrest-safe";

/** One chat turn can run up to MAX_TOOL_ITERATIONS provider calls plus tool fan-out; allow the platform to use up to a minute. */
export const maxDuration = 60;

interface PaperTradingNavigationTarget {
  target: { primaryId: string; secondaryId: string };
  prefill: {
    symbol: string;
    assetClass: string;
    optionRight: string | null;
    strikePrice: number | null;
    expirationDate: string | null;
  };
}

// Server-side tool-use loop against whichever LLM provider is configured
// (Anthropic by default, or a self-hosted model once LLM_PROVIDER=local is
// set - see llm-client.ts). Capped so a pathological back-and-forth (or a
// model that never settles) can't hang a request indefinitely. The LAST
// iteration is a forced plain-text synthesis (tool_choice none) so hitting
// the cap still produces an answer from the data already gathered.
const MAX_TOOL_ITERATIONS = 6;
const MAX_TOOL_CALLS_PER_STEP = 6;
const MAX_TOOL_CALLS_PER_REQUEST = 12;
/** Whole-request deadline, comfortably under maxDuration so the response still gets out. */
const TOTAL_BUDGET_MS = 55_000;
const PER_CALL_TIMEOUT_MS = 25_000;

// Best-effort, PER-INSTANCE limits (see src/lib/access/rate-limit.ts): each message can cost up to six paid provider
// calls. Per signed-in user 30/hour, per IP 60/hour (IP also bounds one person spreading across accounts), and one
// request in flight per user.
const userLimiter = new SlidingWindowLimiter(30, 60 * 60_000);
const ipLimiter = new SlidingWindowLimiter(60, 60 * 60_000);
const inFlight = new Set<string>();

/** Signed-in user id from the Supabase session cookie (middleware already required one), else the IP. */
async function rateKey(request: Request): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anon) {
    try {
      const supabase = createServerClient(url, anon, {
        cookies: { getAll: () => parseCookieHeader(request.headers.get("cookie") ?? "").map((c) => ({ name: c.name, value: c.value ?? "" })), setAll() {} },
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) return `u:${user.id}`;
    } catch {
      // fall through to IP
    }
  }
  return `ip:${clientIp(request)}`;
}

function errorResponse(error: unknown): NextResponse {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "UnsupportedLlmProviderError") return NextResponse.json({ error: message }, { status: 503 });
  if (name === "TimeoutError" || name === "AbortError") {
    return NextResponse.json({ error: "The AI provider took too long to answer. Please try again." }, { status: 504 });
  }
  // Provider and tool errors can contain URLs, keys' prefixes or database detail: log them, do not return them.
  console.error("assistant chat failed:", message.slice(0, 300));
  return NextResponse.json({ error: "The assistant is temporarily unavailable. Please try again." }, { status: 502 });
}

function pendingPayload(p: PendingAction | null) {
  return p ? { id: p.id, tool: p.tool, summary: p.summary, expiresInSec: Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)) } : null;
}

export async function POST(request: Request) {
  const providerProblem = llmProviderProblem();
  if (providerProblem) return NextResponse.json({ error: providerProblem }, { status: 503 });
  if (!isLlmConfigured()) {
    return NextResponse.json(
      {
        error:
          "The assistant isn't configured yet - add a real ANTHROPIC_API_KEY to .env.local (get one at console.anthropic.com), or set LLM_PROVIDER=local plus LOCAL_MODEL_URL to point at a self-hosted server instead. Anthropic is the only path with real per-message cost.",
      },
      { status: 503 }
    );
  }

  const ipDecision = ipLimiter.hit(clientIp(request));
  if (!ipDecision.allowed) return tooManyRequests(ipDecision, "Too many assistant requests from this network. Please wait a bit.");

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_CHARS * 2) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }
  const rawText = await request.text().catch(() => "");
  if (rawText.length > MAX_BODY_CHARS) return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  let body: { messages?: unknown; sessionId?: unknown; confirm?: unknown } | null = null;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });

  const history = sanitizeHistory(body.messages);
  if (!history.ok) return NextResponse.json({ error: history.error }, { status: history.status });
  const sessionId = isValidSessionId(body.sessionId) ? body.sessionId : undefined;

  const key = await rateKey(request);
  const userDecision = userLimiter.hit(key);
  if (!userDecision.allowed) return tooManyRequests(userDecision, "You have reached the hourly assistant limit. Please try again later.");
  if (inFlight.has(key)) {
    return NextResponse.json({ error: "Your previous message is still being answered. Please wait for it to finish." }, { status: 429 });
  }
  inFlight.add(key);

  try {
    // ---- User confirmation of a parked action (no model call, no cost) ----
    const confirm = body.confirm && typeof body.confirm === "object" ? (body.confirm as { id?: unknown; approve?: unknown }) : null;
    const pendingNow = peekPending(key);
    let decision: { approve: boolean; id?: string } | null = null;
    if (confirm && typeof confirm.id === "string") decision = { approve: confirm.approve !== false, id: confirm.id };
    else if (pendingNow && isAffirmation(history.lastUserText)) decision = { approve: true };
    else if (pendingNow && isNegation(history.lastUserText)) decision = { approve: false };

    if (decision) {
      const pending = takePending(key, decision.id);
      if (!pending) {
        return NextResponse.json({
          reply: "I don't have a pending action to confirm (it may have expired). Ask me again and I'll set it up.",
          toolsUsed: [],
          dataLimitations: [],
          navigationTarget: null,
          pendingConfirmation: null,
        });
      }
      if (!decision.approve) {
        return NextResponse.json({ reply: "Okay, cancelled. Nothing was submitted or opened.", toolsUsed: [], dataLimitations: [], navigationTarget: null, pendingConfirmation: null });
      }
      const outcome = await runTool(pending.tool, pending.input, sessionId, { confirmed: true });
      let reply: string;
      let navigationTarget: PaperTradingNavigationTarget | null = null;
      if (outcome.isError) {
        reply = "I couldn't complete that: " + (typeof (outcome.result as { error?: unknown })?.error === "string" ? (outcome.result as { error: string }).error : "unknown error");
      } else if (pending.tool === "submit_feedback") {
        reply = (outcome.result as { stored?: boolean }).stored ? "Thanks - your feedback was submitted to the team." : "Feedback capture isn't set up on this deployment yet, so it was not saved.";
      } else {
        navigationTarget = outcome.result as unknown as PaperTradingNavigationTarget;
        reply = "Done - use the button below to open the Paper Trading ticket. It places no order; you review and submit it yourself.";
      }
      return NextResponse.json({ reply, toolsUsed: outcome.isError ? [] : [pending.tool], dataLimitations: [], navigationTarget, pendingConfirmation: null });
    }

    // ---- Normal turn: provider/tool loop ----
    const workingMessages: LlmMessage[] = history.messages.map((m) => ({ role: m.role, content: m.content }));
    const toolsUsed = new Set<string>();
    const dataLimitations = new Set<string>();
    let finalText = "";
    let pendingAction: PendingAction | null = null;
    let toolCallCount = 0;
    let hitIterationCap = false;
    let truncatedByLength = false;
    const deadline = Date.now() + TOTAL_BUDGET_MS;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const remaining = deadline - Date.now();
      if (remaining < 3_000) {
        hitIterationCap = true;
        dataLimitations.add("The time budget for one answer ran out - the answer may be based on partial data.");
        break;
      }
      const isLast = i === MAX_TOOL_ITERATIONS - 1;
      const response = await callLlm(workingMessages, ASSISTANT_TOOLS, ASSISTANT_SYSTEM_PROMPT, {
        toolChoice: isLast ? "none" : "auto",
        timeoutMs: Math.min(PER_CALL_TIMEOUT_MS, remaining - 500),
      });

      const textOf = () =>
        response.content
          .filter((b): b is Extract<LlmContentBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n\n")
          .trim();
      const toolUseBlocks = response.content.filter((b): b is Extract<LlmContentBlock, { type: "tool_use" }> => b.type === "tool_use");

      // Done: a plain answer, or a "tool_use" stop with no usable tool block, or the forced final step (any tool
      // calls the provider still produced are ignored there).
      if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0 || isLast) {
        finalText = textOf();
        if (isLast && toolUseBlocks.length > 0) {
          hitIterationCap = true;
          dataLimitations.add("Hit the maximum number of tool calls for one turn - the answer below is based on the data gathered so far.");
        }
        if (response.stop_reason === "max_tokens") truncatedByLength = true;
        break;
      }

      workingMessages.push({ role: "assistant", content: response.content });
      const toolResults: LlmContentBlock[] = [];
      for (const block of toolUseBlocks) {
        toolCallCount++;
        let outcome;
        if (toolResults.length >= MAX_TOOL_CALLS_PER_STEP || toolCallCount > MAX_TOOL_CALLS_PER_REQUEST) {
          outcome = { result: { error: "Too many tool calls in one turn; this one was not run." }, isError: true } as Awaited<ReturnType<typeof runTool>>;
        } else if (block.invalid_arguments) {
          outcome = { result: { error: `The arguments for ${block.name} were not usable (${block.invalid_arguments}). Call it again with a valid JSON object.` }, isError: true } as Awaited<ReturnType<typeof runTool>>;
        } else {
          outcome = await runTool(block.name, block.input, sessionId);
        }
        if (!outcome.isError && !outcome.pending) toolsUsed.add(block.name);
        if (outcome.pending) pendingAction = createPending(key, outcome.pending.tool, outcome.pending.input, outcome.pending.summary);
        const notes = (outcome.result as { dataLimitations?: unknown } | null)?.dataLimitations;
        if (Array.isArray(notes)) for (const n of notes) if (typeof n === "string") dataLimitations.add(n);
        // Tool output is wrapped so the model can tell data from instructions (the system prompt says so too).
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ untrusted_tool_data: outcome.result }),
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      workingMessages.push({ role: "user", content: toolResults });
    }

    if (!finalText) {
      finalText = hitIterationCap
        ? "I gathered some data but couldn't finish synthesizing a full answer in one turn - try asking a narrower follow-up."
        : "I couldn't produce an answer for that. Please try rephrasing.";
    }
    if (truncatedByLength) dataLimitations.add("The answer hit the length limit and may be cut off.");
    if (process.env.MARKET_DATA_MOCK_MODE === "true" && toolsUsed.size > 0) {
      dataLimitations.add("Market data is in MOCK mode on this deployment: prices and statistics are synthetic, not real.");
    }

    return NextResponse.json({
      reply: finalText,
      toolsUsed: Array.from(toolsUsed),
      dataLimitations: Array.from(dataLimitations),
      // Nothing navigates until the user confirms (see confirmations.ts); the UI can render pendingConfirmation as Confirm / Cancel.
      navigationTarget: null,
      pendingConfirmation: pendingPayload(pendingAction),
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    inFlight.delete(key);
  }
}
