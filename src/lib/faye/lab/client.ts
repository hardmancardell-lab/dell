/**
 * Browser-side helpers for the Lab page. Talks ONLY to this app's own /api/faye/lab/* routes (same origin, cookie session).
 * Nothing here throws: every call returns a result object. Friendly sentences are written from the error code (grade 8 or lower);
 * the server's own sentence is never shown as is. Nothing in this file builds HTML.
 */
import { labSentence } from "./errors";
import type { CorpusNote, Correction, CorrectionKind, EvalRun, ExamItem, ExamSet, FeedbackItem, FeedbackSummary, ItemSuite, LabCounts, PendingEval, Rating } from "./types";
import type { EvalSuite } from "./config";

export const LAB_BASE_URL = "/api/faye/lab";

export type LabFail = { ok: false; code: string; status: number; message: string; detail?: string };
export type LabResult<T> = { ok: true; data: T } | LabFail;

export const NETWORK_SENTENCE = "I could not reach the server. Check your connection and try again.";
export const SIGN_IN_SENTENCE = "Sign in again to use the Lab.";

export function friendlyLabError(code: string, detail?: string): string {
  if (code === "network") return NETWORK_SENTENCE;
  if (code === "auth_required" || code === "gate_required") return SIGN_IN_SENTENCE;
  return labSentence(code as never, detail);
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

export interface LabClient {
  overview(): Promise<LabResult<{ ready: boolean; counts: LabCounts | null; online: boolean; queueDepth: number }>>;
  feedback(): Promise<LabResult<{ items: FeedbackItem[]; summary: FeedbackSummary }>>;
  submitFeedback(a: { rating: Rating; answerText: string; note?: string; jobId?: string }): Promise<LabResult<{ id: string }>>;
  corrections(): Promise<LabResult<{ items: Correction[] }>>;
  saveCorrection(a: { kind: CorrectionKind; question: string; betterAnswer: string; badExcerpt?: string }): Promise<LabResult<{ id: string }>>;
  dismissCorrection(id: string): Promise<LabResult<{ status: string }>>;
  reopenCorrection(id: string): Promise<LabResult<{ status: string }>>;
  promoteCorrection(id: string, target: ExamSet, suite: ItemSuite, keywords: string[]): Promise<LabResult<{ id: string; set: ExamSet }>>;
  exams(): Promise<LabResult<{ training: ExamItem[]; heldOut: ExamItem[] }>>;
  examAction(id: string, action: "pause" | "resume" | "delete"): Promise<LabResult<{ action: string }>>;
  notes(): Promise<LabResult<{ items: CorpusNote[] }>>;
  proposeNote(a: { correctionId?: string; examId?: string; title: string; body: string }): Promise<LabResult<{ id: string }>>;
  decideNote(id: string, decision: "approve" | "reject"): Promise<LabResult<{ status: string }>>;
  runs(): Promise<LabResult<{ runs: EvalRun[]; pending: PendingEval[]; online: boolean; queueDepth: number }>>;
  requestEval(suite: EvalSuite, confirmLong: boolean): Promise<LabResult<{ jobId: string; status: string; deduped: boolean }>>;
}

export function createLabClient(fetchImpl: typeof fetch = (...a) => fetch(...a)): LabClient {
  async function call(method: "GET" | "POST", path: string, body?: Json): Promise<LabResult<Json>> {
    let res: Response;
    try {
      res = await fetchImpl(`${LAB_BASE_URL}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      return { ok: false, code: "network", status: 0, message: NETWORK_SENTENCE };
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || !isObj(data) || data.ok === false) {
      const code = isObj(data) && typeof data.code === "string" ? data.code : res.status === 401 ? "auth_required" : "server_error";
      const detail = isObj(data) && typeof data.detail === "string" ? data.detail : undefined;
      return { ok: false, code, status: res.status, message: friendlyLabError(code, detail), detail };
    }
    return { ok: true, data };
  }

  const arr = (x: unknown): Json[] => (Array.isArray(x) ? x.filter(isObj) : []);
  const s = (x: unknown): string => (typeof x === "string" ? x : "");
  const map = async <T,>(r: Promise<LabResult<Json>>, f: (d: Json) => T): Promise<LabResult<T>> => {
    const x = await r;
    return x.ok ? { ok: true, data: f(x.data) } : x;
  };
  const worker = (d: Json) => {
    const w = isObj(d.worker) ? d.worker : {};
    return { online: w.online === true, queueDepth: typeof w.queueDepth === "number" ? w.queueDepth : 0 };
  };

  return {
    overview: () => map(call("GET", ""), (d) => ({ ready: d.ready === true, counts: isObj(d.counts) ? (d.counts as unknown as LabCounts) : null, ...worker(d) })),
    feedback: () =>
      map(call("GET", "/feedback"), (d) => ({
        items: arr(d.items) as unknown as FeedbackItem[],
        summary: (isObj(d.summary) ? d.summary : { good: 0, wrong: 0, too_long: 0, off_voice: 0, total: 0 }) as unknown as FeedbackSummary,
      })),
    submitFeedback: (a) => map(call("POST", "/feedback", { rating: a.rating, answer_text: a.answerText, note: a.note, job_id: a.jobId }), (d) => ({ id: s(d.id) })),
    corrections: () => map(call("GET", "/corrections"), (d) => ({ items: arr(d.items) as unknown as Correction[] })),
    saveCorrection: (a) => map(call("POST", "/corrections", { kind: a.kind, question: a.question, better_answer: a.betterAnswer, bad_excerpt: a.badExcerpt }), (d) => ({ id: s(d.id) })),
    dismissCorrection: (id) => map(call("POST", `/corrections/${encodeURIComponent(id)}`, { action: "dismiss" }), (d) => ({ status: s(d.status) })),
    reopenCorrection: (id) => map(call("POST", `/corrections/${encodeURIComponent(id)}`, { action: "reopen" }), (d) => ({ status: s(d.status) })),
    promoteCorrection: (id, target, suite, keywords) =>
      map(call("POST", `/corrections/${encodeURIComponent(id)}`, { action: "promote", target, suite, keywords }), (d) => ({ id: s(d.id), set: (d.set === "held_out" ? "held_out" : "training") as ExamSet })),
    exams: () => map(call("GET", "/exams"), (d) => ({ training: arr(d.training) as unknown as ExamItem[], heldOut: arr(d.held_out) as unknown as ExamItem[] })),
    examAction: (id, action) => map(call("POST", `/exams/${encodeURIComponent(id)}`, { action }), (d) => ({ action: s(d.action) })),
    notes: () => map(call("GET", "/notes"), (d) => ({ items: arr(d.items) as unknown as CorpusNote[] })),
    proposeNote: (a) => map(call("POST", "/notes", { correction_id: a.correctionId, exam_id: a.examId, title: a.title, body: a.body }), (d) => ({ id: s(d.id) })),
    decideNote: (id, decision) => map(call("POST", `/notes/${encodeURIComponent(id)}`, { decision }), (d) => ({ status: s(d.status) })),
    runs: () => map(call("GET", "/eval"), (d) => ({ runs: arr(d.runs) as unknown as EvalRun[], pending: arr(d.pending) as unknown as PendingEval[], ...worker(d) })),
    requestEval: (suite, confirmLong) =>
      map(call("POST", "/eval", { suite, confirm_long: confirmLong ? true : undefined }), (d) => ({ jobId: s(d.job_id), status: s(d.status), deduped: d.deduped === true })),
  };
}
