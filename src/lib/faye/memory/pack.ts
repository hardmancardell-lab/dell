/**
 * Builds the memory_pack v1 for one chat question (called from src/lib/faye/mailbox/memory-hook.ts).
 *
 * Returns null - never throws - when: the feature flag is off (default), the person has memory switched off, learning/memory is
 * paused, there are no approved notes, nothing is relevant, or anything at all goes wrong. The hook then re-validates whatever this
 * returns with validateMemoryPack(), so a bad pack is dropped and the question still runs without memory.
 */
import { memoryEnabled, MEMORY_LIMITS, type Env } from "./config";
import { buildPack } from "./rank";
import { MemoryStore, type RpcClient } from "./store";
import type { MemoryPackV1 } from "../mailbox/types";

export interface PackContext {
  client: unknown;
  userId: string;
  question: string;
  env: Env;
  now?: () => number;
}

function isRpcClient(c: unknown): c is RpcClient {
  return typeof c === "object" && c !== null && typeof (c as { rpc?: unknown }).rpc === "function";
}

export async function buildPackFromMemory(ctx: PackContext): Promise<MemoryPackV1 | null> {
  try {
    if (!memoryEnabled(ctx.env)) return null; // default OFF: no database call at all
    if (!isRpcClient(ctx.client)) return null;
    const store = new MemoryStore(ctx.client);
    const c = await store.candidates(MEMORY_LIMITS.candidateFetch);
    if (!c.ok || !c.data.memoryEnabled || c.data.paused) return null;
    const pack = buildPack(ctx.question, c.data.items, ctx.now ? ctx.now() : Date.now());
    if (!pack) return null;
    // bookkeeping only (last used, use count); a failure here must not matter
    await store.touch(pack.items.map((i) => i.id)).catch(() => undefined);
    return pack;
  } catch {
    return null;
  }
}
