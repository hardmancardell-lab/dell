/**
 * The Lab's state machine: a tiny store, so the same code runs in the browser and in the tests with a fake client.
 * The screen is LabView.tsx; the container that wires them is Lab.tsx.
 *
 * Everything here is plain text from the owner or from Faye's counters. Nothing builds HTML.
 */
import type { LabClient, LabFail } from "@/lib/faye/lab/client";
import type { EvalSuite } from "@/lib/faye/lab/config";
import { isDefaultSuite } from "@/lib/faye/lab/config";
import { labMood, type LabMood } from "@/lib/faye/lab/mood";
import type {
  CorpusNote,
  Correction,
  CorrectionKind,
  EvalRun,
  ExamItem,
  ExamSet,
  FeedbackItem,
  FeedbackSummary,
  ItemSuite,
  LabCounts,
  PendingEval,
} from "@/lib/faye/lab/types";
import { LAB_COPY } from "./copy";

export interface Notice {
  /** Goes up on every message, so the live region announces a repeated sentence again. */
  seq: number;
  tone: "ok" | "error";
  text: string;
}

export type LoadState = "idle" | "loading" | "ready" | "error" | "not_ready" | "disabled";

export interface LabState {
  load: LoadState;
  loadError: string;
  counts: LabCounts | null;
  online: boolean;
  queueDepth: number;
  feedback: FeedbackItem[];
  feedbackSummary: FeedbackSummary;
  corrections: Correction[];
  training: ExamItem[];
  heldOut: ExamItem[];
  notes: CorpusNote[];
  runs: EvalRun[];
  pending: PendingEval[];
  /** Keys of the calls in flight: "load", "correction", "eval:guardrail", a row id ... */
  busy: string[];
  notice: Notice | null;
  mood: LabMood;
}

export interface CorrectionForm {
  kind: CorrectionKind;
  question: string;
  betterAnswer: string;
  badExcerpt: string;
}

export interface LabStore {
  getState(): LabState;
  subscribe(fn: () => void): () => void;
  load(quiet?: boolean): Promise<boolean>;
  refreshRuns(): Promise<boolean>;
  saveCorrection(form: CorrectionForm): Promise<boolean>;
  dismissCorrection(id: string): Promise<boolean>;
  reopenCorrection(id: string): Promise<boolean>;
  promote(id: string, set: ExamSet, suite: ItemSuite, keywordsText: string): Promise<boolean>;
  proposeNote(a: { correctionId?: string; examId?: string; title: string; body: string }): Promise<boolean>;
  decideNote(id: string, decision: "approve" | "reject"): Promise<boolean>;
  examAction(id: string, action: "pause" | "resume" | "delete"): Promise<boolean>;
  requestEval(suite: EvalSuite, confirmLong: boolean): Promise<boolean>;
  notify(tone: Notice["tone"], text: string): void;
}

const EMPTY_SUMMARY: FeedbackSummary = { good: 0, wrong: 0, too_long: 0, off_voice: 0, total: 0 };

/** "a, b|c" -> ["a", "b|c"]. Splits on commas and line breaks; blanks dropped. The server checks the count and the length. */
export function parseKeywords(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

export function initialState(): LabState {
  const base = { online: false, pending: [] as PendingEval[], runs: [] as EvalRun[] };
  return {
    load: "idle",
    loadError: "",
    counts: null,
    online: false,
    queueDepth: 0,
    feedback: [],
    feedbackSummary: EMPTY_SUMMARY,
    corrections: [],
    training: [],
    heldOut: [],
    notes: [],
    runs: [],
    pending: [],
    busy: [],
    notice: null,
    mood: labMood(base),
  };
}

export function createLabStore(deps: { client: LabClient; enabled?: boolean }): LabStore {
  const { client } = deps;
  let state: LabState = initialState();
  let seq = 0;
  const subs = new Set<() => void>();

  const set = (patch: Partial<LabState>) => {
    const next = { ...state, ...patch };
    next.mood = labMood({ online: next.online, pending: next.pending, runs: next.runs });
    state = next;
    for (const fn of [...subs]) fn();
  };
  const notice = (tone: Notice["tone"], text: string) => set({ notice: { seq: ++seq, tone, text } });
  const begin = (key: string): boolean => {
    if (state.busy.includes(key)) return false;
    set({ busy: [...state.busy, key] });
    return true;
  };
  const end = (key: string) => set({ busy: state.busy.filter((k) => k !== key) });
  const fail = (r: LabFail) => notice("error", r.message);

  async function load(quiet = false): Promise<boolean> {
    if (deps.enabled === false) {
      set({ load: "disabled" });
      return false;
    }
    if (!quiet) set({ load: "loading", loadError: "" });
    const ov = await client.overview();
    if (!ov.ok) {
      if (ov.code === "disabled") set({ load: "disabled" });
      else set({ load: quiet ? state.load : "error", loadError: ov.message });
      if (quiet) fail(ov);
      return false;
    }
    if (!ov.data.ready) {
      set({ load: "not_ready", online: ov.data.online, queueDepth: ov.data.queueDepth, counts: null });
      return false;
    }
    const [fb, co, ex, no, ru] = await Promise.all([client.feedback(), client.corrections(), client.exams(), client.notes(), client.runs()]);
    const bad = [fb, co, ex, no, ru].find((r) => !r.ok) as LabFail | undefined;
    if (bad) {
      if (bad.code === "not_ready") set({ load: "not_ready", counts: null });
      else set({ load: quiet ? state.load : "error", loadError: bad.message });
      if (quiet) fail(bad);
      return false;
    }
    set({
      load: "ready",
      loadError: "",
      counts: ov.data.counts,
      online: ru.ok ? ru.data.online : ov.data.online,
      queueDepth: ru.ok ? ru.data.queueDepth : ov.data.queueDepth,
      feedback: fb.ok ? fb.data.items : [],
      feedbackSummary: fb.ok ? fb.data.summary : EMPTY_SUMMARY,
      corrections: co.ok ? co.data.items : [],
      training: ex.ok ? ex.data.training : [],
      heldOut: ex.ok ? ex.data.heldOut : [],
      notes: no.ok ? no.data.items : [],
      runs: ru.ok ? ru.data.runs : [],
      pending: ru.ok ? ru.data.pending : [],
    });
    return true;
  }

  /** Quiet refresh of the runs and the waiting tests (used while a test is running). */
  async function refreshRuns(): Promise<boolean> {
    const r = await client.runs();
    if (!r.ok) return false;
    const before = state.pending.length;
    set({ runs: r.data.runs, pending: r.data.pending, online: r.data.online, queueDepth: r.data.queueDepth });
    if (before > 0 && r.data.pending.length === 0) notice("ok", LAB_COPY.notice.testDone);
    return true;
  }

  async function act<T>(key: string, call: () => Promise<{ ok: true; data: T } | LabFail>, onOk: (d: T) => string, reload = true): Promise<boolean> {
    if (!begin(key)) return false;
    try {
      const r = await call();
      if (!r.ok) {
        fail(r);
        if (r.code === "not_found" || r.code === "conflict" || r.code === "held_out_wall") await load(true);
        return false;
      }
      const text = onOk(r.data);
      if (reload) await load(true);
      notice("ok", text);
      return true;
    } finally {
      end(key);
    }
  }

  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    load,
    refreshRuns,
    saveCorrection: (f) =>
      act("correction", () => client.saveCorrection({ kind: f.kind, question: f.question, betterAnswer: f.betterAnswer, badExcerpt: f.badExcerpt.trim() === "" ? undefined : f.badExcerpt }), () => LAB_COPY.notice.correctionSaved),
    dismissCorrection: (id) => act(id, () => client.dismissCorrection(id), () => LAB_COPY.notice.dismissed),
    reopenCorrection: (id) => act(id, () => client.reopenCorrection(id), () => LAB_COPY.notice.reopened),
    promote: (id, setName, suite, keywordsText) =>
      act(id, () => client.promoteCorrection(id, setName, suite, parseKeywords(keywordsText)), (d) => (d.set === "held_out" ? LAB_COPY.notice.examSaved : LAB_COPY.notice.practiceSaved)),
    proposeNote: (a) => act("note-new", () => client.proposeNote(a), () => LAB_COPY.notice.noteProposed),
    decideNote: (id, d) => act(id, () => client.decideNote(id, d), () => (d === "approve" ? LAB_COPY.notice.noteApproved : LAB_COPY.notice.noteRejected)),
    examAction: (id, a) => act(id, () => client.examAction(id, a), () => (a === "delete" ? LAB_COPY.notice.itemDeleted : a === "pause" ? LAB_COPY.notice.itemPaused : LAB_COPY.notice.itemResumed)),
    requestEval: async (suite, confirmLong) => {
      if (!isDefaultSuite(suite) && !confirmLong) {
        notice("error", LAB_COPY.notice.confirmFirst);
        return false;
      }
      const ok = await act(`eval:${suite}`, () => client.requestEval(suite, confirmLong), () => LAB_COPY.notice.testQueued, false);
      if (ok) await refreshRuns();
      return ok;
    },
    notify: notice,
  };
}
