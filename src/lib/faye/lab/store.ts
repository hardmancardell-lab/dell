/**
 * The only place that talks to the Lab functions in the database. Everything goes through `client.rpc(...)` as the signed-in user
 * (anon key plus the user's JWT), so Postgres checks the owner role and the user id itself; this file never passes a user id.
 * The real Supabase server client and the test fakes both satisfy `RpcClient`.
 *
 * A missing table or function (the lab migration was not run) becomes the honest code `not_ready`, never a vague server error.
 */
import type { RpcResponse } from "../access";
import { toLabCode, type LabErrorCode } from "./errors";
import type {
  Correction,
  CorrectionKind,
  CorpusNote,
  EvalRun,
  ExamItem,
  FeedbackItem,
  FeedbackSummary,
  ExamSet,
  ItemSuite,
  LabCounts,
  NoteStatus,
  PendingEval,
  Rating,
} from "./types";

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResponse>;
}

export type Res<T> = { ok: true; data: T } | { ok: false; code: LabErrorCode; detail?: string; infrastructure?: boolean };

const DETAIL_OK = /^[a-z_]{1,32}$/;
/** PostgREST "function not found" / "table not found", Postgres "undefined function" / "undefined table": the migration has not been applied. */
const NOT_INSTALLED = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const arr = (x: unknown): Obj[] => (Array.isArray(x) ? x.filter(isObj) : []);

export class LabStore {
  constructor(private readonly client: RpcClient) {}

  private async call(fn: string, args: Obj = {}): Promise<Res<Obj>> {
    let res: RpcResponse;
    try {
      res = await this.client.rpc(fn, args);
    } catch {
      console.error(`faye lab: ${fn} threw`);
      return { ok: false, code: "unavailable", infrastructure: true };
    }
    if (res.error) {
      const c = res.error.code ?? "";
      console.error(`faye lab: ${fn} failed (${c || "no code"})`); // code only; never the message or the arguments
      return { ok: false, code: NOT_INSTALLED.has(c) ? "not_ready" : "server_error", infrastructure: true };
    }
    if (!isObj(res.data)) return { ok: false, code: "server_error", infrastructure: true };
    if (res.data.ok === false) {
      const detail = typeof res.data.detail === "string" && DETAIL_OK.test(res.data.detail) ? res.data.detail : undefined;
      return { ok: false, code: toLabCode(res.data.code), detail };
    }
    return { ok: true, data: res.data };
  }

  async overview(): Promise<Res<{ ready: boolean; counts: LabCounts }>> {
    const r = await this.call("faye_lab_overview");
    if (!r.ok) return r;
    const c = isObj(r.data.counts) ? r.data.counts : {};
    return {
      ok: true,
      data: {
        ready: r.data.ready === true,
        counts: {
          feedback: num(c.feedback),
          feedbackToReview: num(c.feedback_to_review),
          correctionsNew: num(c.corrections_new),
          train: num(c.train),
          heldout: num(c.heldout),
          notesPending: num(c.notes_pending),
          runs: num(c.runs),
        },
      },
    };
  }

  async submitFeedback(a: { jobId: string | null; rating: Rating; note: string | null; answerHash: string; excerpt: string; provenance: Obj }): Promise<Res<{ id: string; rating: string }>> {
    const r = await this.call("faye_lab_submit_feedback", {
      p_job_id: a.jobId,
      p_rating: a.rating,
      p_note: a.note,
      p_answer_hash: a.answerHash,
      p_excerpt: a.excerpt,
      p_provenance: a.provenance,
    });
    if (!r.ok) return r;
    return { ok: true, data: { id: str(r.data.id) ?? "", rating: str(r.data.rating) ?? a.rating } };
  }

  async listFeedback(limit = 100): Promise<Res<{ items: FeedbackItem[]; summary: FeedbackSummary }>> {
    const r = await this.call("faye_lab_list_feedback", { p_limit: limit });
    if (!r.ok) return r;
    const s = isObj(r.data.summary) ? r.data.summary : {};
    return {
      ok: true,
      data: {
        items: arr(r.data.items).map((i) => ({
          id: str(i.id) ?? "",
          jobId: str(i.job_id),
          rating: (str(i.rating) ?? "good") as Rating,
          note: str(i.note),
          answerExcerpt: str(i.answer_excerpt) ?? "",
          createdAt: str(i.created_at),
        })),
        summary: { good: num(s.good), wrong: num(s.wrong), too_long: num(s.too_long), off_voice: num(s.off_voice), total: num(s.total) },
      },
    };
  }

  async saveCorrection(a: { kind: CorrectionKind; question: string; badExcerpt: string | null; better: string; jobId: string | null }): Promise<Res<{ id: string }>> {
    const r = await this.call("faye_lab_save_correction", { p_kind: a.kind, p_question: a.question, p_bad_excerpt: a.badExcerpt, p_better: a.better, p_job_id: a.jobId });
    if (!r.ok) return r;
    return { ok: true, data: { id: str(r.data.id) ?? "" } };
  }

  async listCorrections(limit = 100): Promise<Res<{ items: Correction[] }>> {
    const r = await this.call("faye_lab_list_corrections", { p_limit: limit });
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        items: arr(r.data.items).map((c) => ({
          id: str(c.id) ?? "",
          kind: (str(c.kind) ?? "answer") as CorrectionKind,
          question: str(c.question) ?? "",
          badExcerpt: str(c.bad_excerpt),
          betterAnswer: str(c.better_answer) ?? "",
          status: (str(c.status) ?? "new") as Correction["status"],
          createdAt: str(c.created_at),
          examMade: c.exam_made === true,
          practiceMade: c.practice_made === true,
          noteMade: c.note_made === true,
        })),
      },
    };
  }

  async decideCorrection(id: string, decision: "dismiss" | "reopen"): Promise<Res<{ status: string }>> {
    const r = await this.call("faye_lab_decide_correction", { p_id: id, p_decision: decision });
    if (!r.ok) return r;
    return { ok: true, data: { status: str(r.data.status) ?? "" } };
  }

  async promoteCorrection(id: string, set: ExamSet, suite: ItemSuite, keywords: string[]): Promise<Res<{ id: string; set: ExamSet }>> {
    const r = await this.call("faye_lab_promote_correction", { p_id: id, p_split: set === "held_out" ? "heldout" : "train", p_suite: suite, p_keywords: keywords });
    if (!r.ok) return r;
    return { ok: true, data: { id: str(r.data.id) ?? "", set: r.data.split === "heldout" ? "held_out" : "training" } };
  }

  async listItems(): Promise<Res<{ items: ExamItem[] }>> {
    const r = await this.call("faye_lab_list_eval_items");
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        items: arr(r.data.items).map((i) => ({
          id: str(i.id) ?? "",
          set: (i.split === "heldout" ? "held_out" : "training") as ExamSet,
          suite: (str(i.suite) ?? "domain") as ItemSuite,
          question: str(i.question) ?? "",
          requiredKeywords: Array.isArray(i.required_keywords) ? i.required_keywords.filter((k): k is string => typeof k === "string") : [],
          approved: i.approved !== false,
          usedInCorpus: i.used_in_corpus === true,
          sourceCorrectionId: str(i.source_correction_id),
          createdAt: str(i.created_at),
        })),
      },
    };
  }

  async updateItem(id: string, action: "pause" | "resume" | "delete"): Promise<Res<{ action: string }>> {
    const r = await this.call("faye_lab_update_eval_item", { p_id: id, p_action: action });
    if (!r.ok) return r;
    return { ok: true, data: { action: str(r.data.action) ?? action } };
  }

  async proposeNote(a: { correctionId: string | null; examId: string | null; title: string; body: string }): Promise<Res<{ id: string; status: string }>> {
    const r = await this.call("faye_lab_propose_note", { p_correction_id: a.correctionId, p_eval_item_id: a.examId, p_title: a.title, p_body: a.body });
    if (!r.ok) return r;
    return { ok: true, data: { id: str(r.data.id) ?? "", status: str(r.data.status) ?? "pending" } };
  }

  async listNotes(status: NoteStatus | null): Promise<Res<{ items: CorpusNote[] }>> {
    const r = await this.call("faye_lab_list_notes", { p_status: status });
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        items: arr(r.data.items).map((n) => ({
          id: str(n.id) ?? "",
          title: str(n.title) ?? "",
          body: str(n.body) ?? "",
          status: (str(n.status) ?? "pending") as NoteStatus,
          fromCorrectionId: str(n.from_correction_id),
          fromEvalItemId: str(n.from_eval_item_id),
          decidedAt: str(n.decided_at),
          createdAt: str(n.created_at),
        })),
      },
    };
  }

  async decideNote(id: string, decision: "approve" | "reject"): Promise<Res<{ status: string }>> {
    const r = await this.call("faye_lab_decide_note", { p_id: id, p_decision: decision });
    if (!r.ok) return r;
    return { ok: true, data: { status: str(r.data.status) ?? "" } };
  }

  async listRuns(suite: string | null, limit = 50): Promise<Res<{ runs: EvalRun[]; pending: PendingEval[] }>> {
    const r = await this.call("faye_lab_list_runs", { p_suite: suite, p_limit: limit });
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        runs: arr(r.data.runs).map((x) => ({
          id: str(x.id) ?? "",
          suite: str(x.suite) ?? "",
          startedAt: str(x.started_at),
          finishedAt: str(x.finished_at),
          passed: num(x.passed),
          total: num(x.total),
          constraintSha: str(x.constraint_sha),
          personaSha: str(x.persona_sha),
          model: str(x.model),
          createdAt: str(x.created_at),
        })),
        pending: arr(r.data.pending)
          .filter((p) => ["queued", "claimed", "running"].includes(String(p.status)))
          .map((p) => ({ jobId: str(p.job_id) ?? "", status: p.status as PendingEval["status"], suite: str(p.suite), createdAt: str(p.created_at) })),
      },
    };
  }
}
