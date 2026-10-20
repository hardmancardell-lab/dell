/** Response and body helpers for the Faye routes. Plain Web APIs only (no next/server), so tests can call the handlers directly. */
import { errorBody, HTTP_STATUS, type FayeErrorCode } from "./errors";

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extraHeaders } });
}

export function errorResponse(code: FayeErrorCode, extra: { retryAfterSec?: number; detail?: unknown } = {}): Response {
  const headers: Record<string, string> = {};
  const body = errorBody(code, extra);
  if (body.retry_after_sec) headers["retry-after"] = String(body.retry_after_sec);
  return jsonResponse(body, HTTP_STATUS[code], headers);
}

export type BodyRead = { ok: true; value: unknown } | { ok: false; code: "too_large" | "bad_request" };

/** Reads a JSON body without ever holding more than `maxBytes`. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, code: "too_large" };
  if (!request.body) return { ok: false, code: "bad_request" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, code: "too_large" };
    }
    chunks.push(value);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, code: "bad_request" };
  }
}
