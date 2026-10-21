/** Shapes used by the Lab routes and the Lab page. Snake_case fields from the database are mapped to camelCase by the store. */

export type Rating = "good" | "wrong" | "too_long" | "off_voice";
export const RATINGS: readonly Rating[] = ["good", "wrong", "too_long", "off_voice"];

export type CorrectionKind = "answer" | "fact" | "voice" | "guardrail";
export const CORRECTION_KINDS: readonly CorrectionKind[] = ["answer", "fact", "voice", "guardrail"];
export type CorrectionStatus = "new" | "promoted_eval" | "promoted_note" | "rejected";

/**
 * The two sets, in the words the routes and the page use. The database spells them `split` = 'train' | 'heldout' (the frozen contract
 * and the memory trigger read those); store.ts maps between the two.
 */
export type ExamSet = "training" | "held_out";
export const EXAM_SETS: readonly ExamSet[] = ["training", "held_out"];
export type ItemSuite = "guardrail" | "domain" | "persona";
export const ITEM_SUITES: readonly ItemSuite[] = ["guardrail", "domain", "persona"];

export type NoteStatus = "pending" | "approved" | "rejected";

export interface FeedbackItem {
  id: string;
  jobId: string | null;
  rating: Rating;
  note: string | null;
  answerExcerpt: string;
  createdAt: string | null;
}
export interface FeedbackSummary {
  good: number;
  wrong: number;
  too_long: number;
  off_voice: number;
  total: number;
}

export interface Correction {
  id: string;
  kind: CorrectionKind;
  question: string;
  badExcerpt: string | null;
  betterAnswer: string;
  status: CorrectionStatus;
  createdAt: string | null;
  examMade: boolean;
  practiceMade: boolean;
  noteMade: boolean;
}

export interface ExamItem {
  id: string;
  set: ExamSet;
  suite: ItemSuite;
  question: string;
  requiredKeywords: string[];
  approved: boolean;
  usedInCorpus: boolean;
  sourceCorrectionId: string | null;
  createdAt: string | null;
}

export interface CorpusNote {
  id: string;
  title: string;
  body: string;
  status: NoteStatus;
  fromCorrectionId: string | null;
  fromEvalItemId: string | null;
  decidedAt: string | null;
  createdAt: string | null;
}

export interface EvalRun {
  id: string;
  suite: string;
  startedAt: string | null;
  finishedAt: string | null;
  passed: number;
  total: number;
  constraintSha: string | null;
  personaSha: string | null;
  model: string | null;
  createdAt: string | null;
}

export interface PendingEval {
  jobId: string;
  status: "queued" | "claimed" | "running";
  suite: string | null;
  createdAt: string | null;
}

export interface LabCounts {
  feedback: number;
  feedbackToReview: number;
  correctionsNew: number;
  train: number;
  heldout: number;
  notesPending: number;
  runs: number;
}
