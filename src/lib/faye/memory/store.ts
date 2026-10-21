/**
 * The only place that talks to the memory functions in the database. Everything goes through `client.rpc(...)` as the signed-in
 * user (anon key plus the user's JWT), so Postgres checks the owner role and the user id itself; this file never passes a user id.
 * The real Supabase server client and the test fakes both satisfy `RpcClient`.
 */
import type { RpcResponse } from "../access";
import { toMemoryCode, type MemoryErrorCode } from "./errors";
import type { Candidate, MemoryItem, MemorySettings, NoteCandidate, UsageDay } from "./types";

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResponse>;
}

export type Res<T> = { ok: true; data: T } | { ok: false; code: MemoryErrorCode; detail?: string; infrastructure?: boolean };

const DETAIL_OK = /^[a-z_]{1,32}$/;
/** PostgREST "function not found", Postgres "undefined function" and "undefined table": the migration has not been applied. */
const NOT_INSTALLED = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

export class MemoryStore {
  constructor(private readonly client: RpcClient) {}

  private async call(fn: string, args: Obj = {}): Promise<Res<Obj>> {
    let res: RpcResponse;
    try {
      res = await this.client.rpc(fn, args);
    } catch {
      console.error(`faye memory: ${fn} threw`);
      return { ok: false, code: "unavailable", infrastructure: true };
    }
    if (res.error) {
      const c = res.error.code ?? "";
      console.error(`faye memory: ${fn} failed (${c || "no code"})`); // code only; never the message or the arguments
      return { ok: false, code: NOT_INSTALLED.has(c) ? "unavailable" : "server_error", infrastructure: true };
    }
    if (!isObj(res.data)) return { ok: false, code: "server_error", infrastructure: true };
    if (res.data.ok === false) {
      const detail = typeof res.data.detail === "string" && DETAIL_OK.test(res.data.detail) ? res.data.detail : undefined;
      return { ok: false, code: toMemoryCode(res.data.code), detail };
    }
    return { ok: true, data: res.data };
  }

  async list(includeDeleted = false): Promise<Res<{ items: MemoryItem[]; settings: MemorySettings }>> {
    const r = await this.call("faye_memory_list", { p_include_deleted: includeDeleted });
    if (!r.ok) return r;
    return { ok: true, data: { items: arr<MemoryItem>(r.data.items), settings: settingsOf(r.data.settings) } };
  }

  async add(n: NoteCandidate | (Omit<NoteCandidate, "source"> & { source: "taught" | "stated" }), status: "proposed" | "approved"): Promise<Res<{ id: string; duplicate: boolean; superseded: string | null; item: MemoryItem | null }>> {
    const r = await this.call("faye_memory_add", {
      p_category: n.category,
      p_slot: n.slot,
      p_fact: n.fact,
      p_source: n.source,
      p_source_ref: n.sourceRef,
      p_confidence: n.confidence,
      p_status: status,
    });
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        id: String(r.data.id ?? ""),
        duplicate: r.data.duplicate === true,
        superseded: typeof r.data.superseded === "string" ? r.data.superseded : null,
        item: isObj(r.data.item) ? (r.data.item as unknown as MemoryItem) : null,
      },
    };
  }

  async edit(id: string, fact: string | null, category: string | null): Promise<Res<{ item: MemoryItem | null }>> {
    const r = await this.call("faye_memory_edit", { p_id: id, p_fact: fact, p_category: category });
    if (!r.ok) return r;
    return { ok: true, data: { item: isObj(r.data.item) ? (r.data.item as unknown as MemoryItem) : null } };
  }

  async decide(id: string, decision: "approve" | "reject" | "retire" | "revive"): Promise<Res<{ item: MemoryItem | null; superseded: string | null }>> {
    const r = await this.call("faye_memory_decide", { p_id: id, p_decision: decision });
    if (!r.ok) return r;
    return {
      ok: true,
      data: { item: isObj(r.data.item) ? (r.data.item as unknown as MemoryItem) : null, superseded: typeof r.data.superseded === "string" ? r.data.superseded : null },
    };
  }

  async remove(id: string, permanent: boolean): Promise<Res<{ permanent: boolean; undoMinutes: number | null }>> {
    const r = await this.call("faye_memory_delete", { p_id: id, p_permanent: permanent });
    if (!r.ok) return r;
    return { ok: true, data: { permanent: r.data.permanent === true, undoMinutes: typeof r.data.undo_minutes === "number" ? r.data.undo_minutes : null } };
  }

  async restore(id: string): Promise<Res<{ item: MemoryItem | null }>> {
    const r = await this.call("faye_memory_restore", { p_id: id });
    if (!r.ok) return r;
    return { ok: true, data: { item: isObj(r.data.item) ? (r.data.item as unknown as MemoryItem) : null } };
  }

  async deleteAll(): Promise<Res<{ deleted: Record<string, number> }>> {
    const r = await this.call("faye_memory_delete_all", { p_confirm: "DELETE" });
    if (!r.ok) return r;
    return { ok: true, data: { deleted: numbers(r.data.deleted) } };
  }

  async updateSettings(s: Partial<MemorySettings>): Promise<Res<{ settings: MemorySettings }>> {
    const r = await this.call("faye_memory_update_settings", {
      p_learning_paused: typeof s.learning_paused === "boolean" ? s.learning_paused : null,
      p_show_used_notes: typeof s.show_used_notes === "boolean" ? s.show_used_notes : null,
    });
    if (!r.ok) return r;
    return { ok: true, data: { settings: settingsOf(r.data.settings) } };
  }

  async exportAll(): Promise<Res<Obj>> {
    return this.call("faye_memory_export");
  }

  async candidates(limit: number): Promise<Res<{ memoryEnabled: boolean; paused: boolean; items: Candidate[] }>> {
    const r = await this.call("faye_memory_candidates", { p_limit: limit });
    if (!r.ok) return r;
    return { ok: true, data: { memoryEnabled: r.data.memory_enabled === true, paused: r.data.paused === true, items: arr<Candidate>(r.data.items) } };
  }

  async touch(ids: string[]): Promise<Res<{ touched: number }>> {
    const r = await this.call("faye_memory_touch", { p_ids: ids });
    if (!r.ok) return r;
    return { ok: true, data: { touched: typeof r.data.touched === "number" ? r.data.touched : 0 } };
  }

  async usageBump(day: string, topics: Record<string, number>, tickers: Record<string, number>, hour: number): Promise<Res<Obj>> {
    return this.call("faye_usage_bump", { p_day: day, p_topics: topics, p_tickers: tickers, p_hour: hour });
  }

  async usageRecent(days: number): Promise<Res<{ rows: UsageDay[] }>> {
    const r = await this.call("faye_usage_recent", { p_days: days });
    if (!r.ok) return r;
    return { ok: true, data: { rows: arr<UsageDay>(r.data.rows) } };
  }

  /** The app refused a candidate note before sending it anywhere; records only that it happened. */
  async noteDropped(count: number, source: string): Promise<void> {
    await this.call("faye_memory_note_dropped", { p_count: count, p_source: source });
  }

  /** "Erase everything Faye holds about me" (mailbox function), then one content-free line saying that it happened. */
  async erase(): Promise<Res<{ deleted: Record<string, number> }>> {
    const r = await this.call("faye_erase_me", { p_confirm: "DELETE" });
    if (!r.ok) return r;
    const deleted = numbers(r.data.deleted);
    await this.call("faye_memory_note_erased", { p_deleted: Object.values(deleted).reduce((a, b) => a + b, 0) });
    return { ok: true, data: { deleted } };
  }
}

function arr<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x.filter(isObj) as unknown as T[]) : [];
}
function numbers(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(x)) for (const [k, v] of Object.entries(x)) if (typeof v === "number" && /^[a-z_]{1,40}$/.test(k)) out[k] = v;
  return out;
}
function settingsOf(x: unknown): MemorySettings {
  const o = isObj(x) ? x : {};
  return { learning_paused: o.learning_paused === true, show_used_notes: o.show_used_notes !== false };
}
