/**
 * Input validation and text hygiene for the Faye mailbox routes. Pure functions, no I/O.
 * Contract: FAYE_MAILBOX_CONTRACT.md sections 3.2, 4 and 6.
 */
import { createHash } from "node:crypto";
import { LIMITS } from "./config";
import {
  MEMORY_CATEGORIES,
  RESULT_KINDS,
  type ChatState,
  type CleanResult,
  type MemoryCategory,
  type MemoryPackV1,
  type PortfolioPosition,
  type ResultKind,
} from "./types";
import { applyRelayGuard } from "./output-guard";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9.\-^=/]{0,15}$/;
const ASSET_CLASS_RE = /^[a-z_]{1,16}$/;

export type Check<T> = { ok: true; value: T } | { ok: false; code: "bad_request" | "too_large"; detail: string };
const bad = (detail: string): { ok: false; code: "bad_request"; detail: string } => ({ ok: false, code: "bad_request", detail });
const big = (detail: string): { ok: false; code: "too_large"; detail: string } => ({ ok: false, code: "too_large", detail });

export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// C0 controls except tab and newline, DEL, C1 controls, and bidirectional override/isolate characters (text-spoofing).
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/** Text-only hygiene: removes control and bidi-override characters. It does NOT escape HTML; the client renders text nodes only. */
export function cleanText(s: unknown, maxLen: number): string {
  if (typeof s !== "string") return "";
  const t = s.length > maxLen ? s.slice(0, maxLen) : s;
  return t.replace(UNSAFE_CHARS, "");
}

export function serializedLength(x: unknown): number {
  try {
    return JSON.stringify(x)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Rebuilds the portfolio state from an allowlist (page, and per position: symbol, assetClass, shares, costBasisValue) and
 * drops positions from the END until it serializes to at most `maxChars` characters. Anything else the client sent is discarded.
 */
export function trimPortfolioState(state: unknown, maxChars: number = LIMITS.stateChars): ChatState | null {
  if (!isPlainObject(state)) return null;
  const page = typeof state.page === "string" ? cleanText(state.page, 40).trim() || "Dellegate" : "Dellegate";
  const positions: PortfolioPosition[] = [];
  const portfolio = isPlainObject(state.portfolio) ? state.portfolio : null;
  const raw = portfolio && Array.isArray(portfolio.positions) ? portfolio.positions : [];
  for (const p of raw.slice(0, 200)) {
    if (!isPlainObject(p)) continue;
    const symbol = typeof p.symbol === "string" ? p.symbol.trim() : "";
    const assetClass = typeof p.assetClass === "string" ? p.assetClass.trim() : "";
    if (!SYMBOL_RE.test(symbol) || !ASSET_CLASS_RE.test(assetClass)) continue;
    if (typeof p.shares !== "number" || !Number.isFinite(p.shares)) continue;
    if (typeof p.costBasisValue !== "number" || !Number.isFinite(p.costBasisValue)) continue;
    positions.push({ symbol, assetClass, shares: p.shares, costBasisValue: p.costBasisValue });
  }
  const out: ChatState = { page, portfolio: { positions } };
  while (out.portfolio.positions.length > 0 && serializedLength(out) > maxChars) out.portfolio.positions.pop();
  return out;
}

export interface ChatInput {
  requestId: string;
  question: string;
  state: ChatState | null;
}
export interface ContinueInput {
  requestId: string;
  parentJobId: string;
  state: Record<string, unknown>;
  results: Record<string, unknown>;
}

function commonId(body: Record<string, unknown>): Check<string> {
  const id = body.request_id;
  if (typeof id !== "string" || !REQUEST_ID_RE.test(id)) return bad("bad_request_id");
  return { ok: true, value: id };
}

export function validateChatBody(body: unknown): Check<ChatInput> {
  if (!isPlainObject(body)) return bad("bad_payload");
  if ("memory" in body) return bad("memory_not_allowed");
  const id = commonId(body);
  if (!id.ok) return id;
  if (typeof body.question !== "string") return bad("bad_payload");
  const question = cleanText(body.question, LIMITS.questionChars + 1).trim();
  if (question.length < 1) return bad("bad_payload");
  if (question.length > LIMITS.questionChars) return big("question");
  if (body.state !== undefined && body.state !== null && !isPlainObject(body.state)) return bad("bad_payload");
  return { ok: true, value: { requestId: id.value, question, state: trimPortfolioState(body.state) } };
}

export function validateContinueBody(body: unknown): Check<ContinueInput> {
  if (!isPlainObject(body)) return bad("bad_payload");
  if ("memory" in body) return bad("memory_not_allowed");
  const id = commonId(body);
  if (!id.ok) return id;
  if (typeof body.parent_job_id !== "string" || !UUID_RE.test(body.parent_job_id)) return bad("bad_parent");
  if (!isPlainObject(body.state) || !isPlainObject(body.results)) return bad("bad_payload");
  if (Object.keys(body.results).length > LIMITS.continueResultsKeys) return big("results");
  if (serializedLength(body.state) > LIMITS.continueStateBytes) return big("state");
  if (serializedLength(body.results) > LIMITS.continueResultsBytes) return big("results");
  return { ok: true, value: { requestId: id.value, parentJobId: body.parent_job_id, state: body.state, results: body.results } };
}

// ---------------------------------------------------------------------------------------------------------------- memory pack

/** First 16 hex characters of sha256( items.map(i => id:cat:t).join("\n") ). Contract section 6. */
export function computeMemoryPackHash(items: { id: string; cat: string; t: string }[]): string {
  return createHash("sha256")
    .update(items.map((i) => `${i.id}:${i.cat}:${i.t}`).join("\n"), "utf8")
    .digest("hex")
    .slice(0, 16);
}

// eslint-disable-next-line no-control-regex
const ITEM_BAD_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

/** Returns a pack that satisfies the contract, or null (the job then runs with memory: null). Never throws. */
export function validateMemoryPack(pack: unknown): MemoryPackV1 | null {
  if (!isPlainObject(pack) || pack.v !== 1 || !Array.isArray(pack.items)) return null;
  const n = pack.items.length;
  if (n < 1 || n > LIMITS.memoryItems) return null;
  const items: MemoryPackV1["items"] = [];
  let chars = 0;
  for (const it of pack.items) {
    if (!isPlainObject(it)) return null;
    const { id, cat, t } = it;
    if (typeof id !== "string" || !UUID_RE.test(id)) return null;
    if (typeof cat !== "string" || !(MEMORY_CATEGORIES as readonly string[]).includes(cat)) return null;
    if (typeof t !== "string" || t.length < LIMITS.memoryItemMinChars || t.length > LIMITS.memoryItemMaxChars) return null;
    if (ITEM_BAD_CHARS.test(t) || t !== t.trim()) return null;
    chars += t.length;
    items.push({ id, cat: cat as MemoryCategory, t });
  }
  if (chars > LIMITS.memoryChars || pack.chars !== chars) return null;
  if (typeof pack.hash !== "string" || pack.hash !== computeMemoryPackHash(items)) return null;
  return { v: 1, items, chars, hash: pack.hash };
}

// ---------------------------------------------------------------------------------------------------------------- results

/**
 * What the browser receives for a chat or continue result: only kind, text, calls, state, action and provenance, with text
 * cleaned. A `generated` answer goes through the relay guard (same pattern as the worker's output guard).
 */
export function cleanChatResult(result: unknown): { result: CleanResult; retracted: boolean } {
  const r = isPlainObject(result) ? result : {};
  const kind: ResultKind = (RESULT_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as ResultKind) : "final";
  let text = cleanText(r.text, 60_000);
  let provenance: Record<string, unknown> = isPlainObject(r.provenance) ? r.provenance : {};
  if (serializedLength(provenance) > LIMITS.provenanceBytes) provenance = { truncated: true };
  let retracted = provenance.retracted === true;
  let outKind: ResultKind = kind;
  if (kind === "generated") {
    const g = applyRelayGuard(text);
    if (g.tripped) {
      text = g.text;
      retracted = true;
      outKind = "guardrail";
      provenance = { ...provenance, retracted: true, relay_guard: true };
    }
  }
  return {
    retracted,
    result: {
      kind: outKind,
      text,
      calls: Array.isArray(r.calls) ? r.calls : null,
      state: isPlainObject(r.state) ? r.state : null,
      action: isPlainObject(r.action) ? r.action : null,
      provenance,
    },
  };
}
