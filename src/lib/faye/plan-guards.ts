/**
 * Guards for a tool plan that arrives from Faye's server. The server is a separate local (or tunnelled) process, so a
 * plan is untrusted input: a tampered or impostor server could otherwise ask the browser to fire thousands of
 * authenticated requests per turn, reuse ids to overwrite results, or crash the run with odd elements (privacy audit F5).
 *
 * sanitizePlanCalls() rebuilds every call from whitelisted fields, so nothing the server adds (extra keys, prototype
 * tricks, array-typed paths) survives. The path/method allowlist and parameter checks stay in FayeChatWidget.tsx.
 */

/** Calls the browser will run for ONE turn of a plan. Real playbooks plan up to about a dozen (a deep dive). */
export const MAX_CALLS_PER_TURN = 16;
/** Calls across a whole multi-turn run. */
export const MAX_CALLS_PER_RUN = 40;
/** Turns (server round trips) per run. */
export const MAX_PLAN_TURNS = 6;

export interface PlanCallShape {
  id: string;
  tool: string;
  agent: string;
  method: "GET" | "POST";
  path: string;
  params?: Record<string, string | number>;
  body?: { entries?: { symbol: string; assetClass: string }[] };
}

export type PlanCheck = { ok: true; calls: PlanCallShape[] } | { ok: false; error: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const LABEL = /^[A-Za-z0-9 _.\-]{0,40}$/;
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);
const MAX_PARAMS = 8;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * @param raw   the `calls` value from the server
 * @param alreadyRun  number of calls already executed earlier in this run
 */
export function sanitizePlanCalls(raw: unknown, alreadyRun = 0): PlanCheck {
  if (!Array.isArray(raw)) return { ok: false, error: "The plan was malformed, so nothing was run." };
  if (raw.length === 0) return { ok: false, error: "The plan had no steps." };
  if (raw.length > MAX_CALLS_PER_TURN) return { ok: false, error: `The plan asked for ${raw.length} tool calls in one step (limit ${MAX_CALLS_PER_TURN}), so it was not run.` };
  if (alreadyRun + raw.length > MAX_CALLS_PER_RUN) return { ok: false, error: `The run would exceed ${MAX_CALLS_PER_RUN} tool calls, so it was stopped.` };

  const seen = new Set<string>();
  const calls: PlanCallShape[] = [];
  for (const item of raw) {
    if (!isObj(item)) return { ok: false, error: "The plan contained a malformed step, so nothing was run." };
    const { id, tool, agent, method, path, params, body } = item;
    if (typeof id !== "string" || !ID.test(id) || RESERVED_IDS.has(id)) return { ok: false, error: "The plan used an invalid step id." };
    if (seen.has(id)) return { ok: false, error: "The plan reused a step id, so it was not run." };
    seen.add(id);
    if (typeof path !== "string" || path.length > 120) return { ok: false, error: "The plan used an invalid path." };
    if (method !== "GET" && method !== "POST") return { ok: false, error: "The plan used an invalid method." };
    if (typeof tool !== "string" || !LABEL.test(tool) || typeof agent !== "string" || !LABEL.test(agent)) return { ok: false, error: "The plan used an invalid label." };

    let cleanParams: Record<string, string | number> | undefined;
    if (params !== undefined && params !== null) {
      if (!isObj(params)) return { ok: false, error: "The plan used invalid parameters." };
      const entries = Object.entries(params);
      if (entries.length > MAX_PARAMS) return { ok: false, error: "The plan used too many parameters." };
      cleanParams = {};
      for (const [k, v] of entries) {
        // Only plain strings and finite numbers; null, arrays and objects used to be stringified ("null", "AAPL").
        if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) cleanParams[k] = v;
        else return { ok: false, error: "The plan used an invalid parameter value." };
      }
    }

    let cleanBody: PlanCallShape["body"];
    if (body !== undefined && body !== null) {
      if (!isObj(body) || !Array.isArray(body.entries)) return { ok: false, error: "The plan used an invalid request body." };
      const entries: { symbol: string; assetClass: string }[] = [];
      for (const e of body.entries) {
        if (!isObj(e) || typeof e.symbol !== "string" || typeof e.assetClass !== "string") return { ok: false, error: "The plan used an invalid request body." };
        entries.push({ symbol: e.symbol, assetClass: e.assetClass });
      }
      cleanBody = { entries };
    }
    calls.push({ id, tool, agent, method, path, ...(cleanParams ? { params: cleanParams } : {}), ...(cleanBody ? { body: cleanBody } : {}) });
  }
  return { ok: true, calls };
}

/**
 * Incremental Server-Sent-Events splitter. Feed it decoded text chunks; it returns only COMPLETE events (those followed by a
 * blank line) and keeps a trailing partial block in its buffer, so a chunk boundary inside `data:` or right after
 * `event:` no longer throws or silently drops an event (privacy audit F10). Total input is capped.
 */
export const MAX_STREAM_CHARS = 4_000_000;

export class SseParser {
  private buf = "";
  private total = 0;

  push(chunk: string): { event: string; data: unknown }[] {
    this.total += chunk.length;
    if (this.total > MAX_STREAM_CHARS) throw new Error("Faye's response was larger than expected, so it was stopped.");
    this.buf = (this.buf + chunk).replace(/\r\n/g, "\n"); // a "\r" at the end of a chunk waits for its "\n"
    const parts = this.buf.split("\n\n");
    this.buf = parts.pop() ?? "";
    const out: { event: string; data: unknown }[] = [];
    for (const block of parts) {
      const event = /^event: *(\w+)/m.exec(block)?.[1];
      if (!event) continue;
      const dataLines = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, ""));
      let data: unknown = {};
      if (dataLines.length > 0) {
        try {
          data = JSON.parse(dataLines.join("\n"));
        } catch {
          continue; // a corrupt event is skipped rather than aborting the whole run
        }
      }
      out.push({ event, data });
    }
    return out;
  }
}
