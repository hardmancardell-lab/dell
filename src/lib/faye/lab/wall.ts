/**
 * The held-out wall at the library level (the database enforces the same rules with triggers; see db/migrations/2026-10-20_faye_lab.sql).
 * An exam question must never be taught, or the exam stops measuring.
 *
 * `heldOutHit` answers: would this note (or its source) touch an exam question? Pure; no I/O. The handlers call it BEFORE the database
 * so the owner gets a plain refusal, and the database check stays as the last line.
 */
import type { CorpusNote, ExamItem } from "./types";

/** Same normal form as faye_lab_question_key in SQL: lower case, runs of non-letters and non-digits become one space. */
export function normalizeQuestion(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export interface WallInput {
  /** The note's title and body joined, or any text that is about to be taught. */
  text?: string;
  correctionId?: string | null;
  examId?: string | null;
}

export function heldOutHit(items: readonly ExamItem[], input: WallInput): boolean {
  const heldOut = items.filter((i) => i.set === "held_out");
  if (input.examId && heldOut.some((i) => i.id === input.examId)) return true;
  if (input.correctionId && heldOut.some((i) => i.sourceCorrectionId === input.correctionId)) return true;
  const text = (input.text ?? "").toLowerCase();
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    for (const i of heldOut) {
      const q = i.question.toLowerCase();
      if (q.length < 12) continue;
      if (text.includes(q)) return true;
      if (trimmed.length >= 12 && q.includes(trimmed)) return true;
    }
  }
  return false;
}

/** Is this question already in the other set? Used to say "already an exam question" before the database says no. */
export function findSameQuestion(items: readonly ExamItem[], question: string): ExamItem | null {
  const key = normalizeQuestion(question);
  return items.find((i) => normalizeQuestion(i.question) === key) ?? null;
}

/**
 * The other direction: would adding this as an EXAM question collide with a note that already exists (not rejected)? True when a note
 * holds the question's text or comes from the correction the question is made from.
 */
export function noteTouchesQuestion(notes: readonly CorpusNote[], q: { question: string; correctionId?: string | null }): boolean {
  const question = q.question.toLowerCase();
  for (const n of notes) {
    if (n.status === "rejected") continue;
    if (q.correctionId && n.fromCorrectionId === q.correctionId) return true;
    if (question.length >= 12 && `${n.title} ${n.body}`.toLowerCase().includes(question)) return true;
  }
  return false;
}
