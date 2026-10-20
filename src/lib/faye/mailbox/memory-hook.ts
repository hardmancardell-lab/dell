/**
 * Where the memory pack (design 3.5) is attached to a chat job. The pack is built SERVER-SIDE with the user-scoped client so the
 * worker only ever sees a slice; the browser can never supply one (a `memory` field in the request body is rejected).
 *
 * WP-F: replace the body of `buildMemoryPack` (one change, in this file) with a call to your ranker, for example
 *   return buildPackFromMemory(ctx.client, ctx.userId, ctx.question);
 * It may return a pack object or null. Whatever it returns is re-validated by validateMemoryPack(); an invalid pack is dropped
 * and the job runs without memory, never with a half-trusted one. Until then this returns null (no memory).
 */
import type { MemoryPackV1 } from "./types";
import { validateMemoryPack } from "./validate";

export interface MemoryContext {
  client: unknown;
  userId: string;
  question: string;
  env: Record<string, string | undefined>;
}
export type MemoryPackProvider = (ctx: MemoryContext) => Promise<unknown>;

let provider: MemoryPackProvider | null = null;

/** Tests (and WP-F, if it prefers registering over editing this file) can install a provider. */
export function setMemoryPackProvider(p: MemoryPackProvider | null): void {
  provider = p;
}

async function buildMemoryPack(ctx: MemoryContext): Promise<unknown> {
  if (provider) return provider(ctx);
  return null; // WP-F: replace with the real ranker
}

export async function attachMemoryPack(ctx: MemoryContext): Promise<MemoryPackV1 | null> {
  const flag = (ctx.env.FAYE_MEMORY_ENABLED ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false") return null;
  try {
    return validateMemoryPack(await buildMemoryPack(ctx));
  } catch {
    return null; // memory must never be able to break a question
  }
}
