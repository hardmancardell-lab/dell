/** Shapes for Faye memory (WP-F). The database columns are defined in db/migrations/2026-10-20_faye_memory.sql. */
import { MEMORY_CATEGORIES, type MemoryCategory } from "../mailbox/types";

export { MEMORY_CATEGORIES };
export type { MemoryCategory };

export const MEMORY_SOURCES = ["stated", "taught", "observed", "proposed_by_model"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const MEMORY_STATUSES = ["proposed", "approved", "rejected", "retired"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** A note as the routes return it (user_id is never included). */
export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  slot: string | null;
  fact: string;
  source: MemorySource;
  source_ref: string | null;
  confidence: number;
  evidence_count: number;
  status: MemoryStatus;
  approved_by: "owner" | null;
  sensitivity: "low" | "normal";
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  last_used_at: string | null;
  last_observed_at: string;
  use_count: number;
  expires_at: string | null;
  supersedes: string | null;
  usefulness: number;
  deleted_at: string | null;
}

/** What faye_memory_candidates returns for ranking (approved, live notes only). */
export interface Candidate {
  id: string;
  category: MemoryCategory;
  slot: string | null;
  fact: string;
  source: MemorySource;
  confidence: number;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  last_used_at: string | null;
  last_observed_at: string;
  usefulness: number;
  use_count: number;
}

export interface MemorySettings {
  learning_paused: boolean;
  show_used_notes: boolean;
}

/** A note the extractors would like to add. Always goes through screenMemoryText before it is sent anywhere. */
export interface NoteCandidate {
  category: MemoryCategory;
  slot: string | null;
  fact: string;
  source: Exclude<MemorySource, "proposed_by_model">;
  /** An id or a counter (never raw text): letters, digits and _:./=,- only, 120 characters at most. */
  sourceRef: string;
  confidence: number;
}

/** One day of counts (faye_usage_stats). */
export interface UsageDay {
  day: string;
  topic_counts: Record<string, number>;
  ticker_counts: Record<string, number>;
  hour_hist: Record<string, number>;
  questions: number;
}

export const FACT_MIN = 3;
export const FACT_MAX = 200;
