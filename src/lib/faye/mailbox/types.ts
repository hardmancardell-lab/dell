/** Shapes from FAYE_MAILBOX_CONTRACT.md. Keep in step with that file. */
import type { FayeErrorCode } from "./errors";

export type JobKind = "chat" | "continue" | "extract" | "eval";
export type JobStatus = "queued" | "claimed" | "running" | "done" | "failed" | "expired" | "cancelled";
export const FINAL_STATUSES: readonly JobStatus[] = ["done", "failed", "expired", "cancelled"];

export const MEMORY_CATEGORIES = ["style", "preference", "habit", "tendency", "goal", "context", "avoid"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface MemoryPackV1 {
  v: 1;
  items: { id: string; cat: MemoryCategory; t: string }[];
  chars: number;
  hash: string;
}

export interface PortfolioPosition {
  symbol: string;
  assetClass: string;
  shares: number;
  costBasisValue: number;
}
export interface ChatState {
  page: string;
  portfolio: { positions: PortfolioPosition[] };
}

export interface ChatRequestV1 {
  v: 1;
  question: string;
  state: ChatState | null;
  memory: MemoryPackV1 | null;
  stream: true;
}
export interface ContinueRequestV1 {
  v: 1;
  state: Record<string, unknown>;
  results: Record<string, unknown>;
}

export interface JobEvent {
  seq: number;
  ev: "chunk" | "retract";
  text: string;
}

export const RESULT_KINDS = ["generated", "conduct", "guardrail", "action_proposal", "tool_calls", "final"] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

export interface CleanResult {
  kind: ResultKind;
  text: string;
  calls: unknown[] | null;
  state: Record<string, unknown> | null;
  action: Record<string, unknown> | null;
  provenance: Record<string, unknown>;
}

export interface PollBody {
  ok: true;
  job_id: string;
  kind: JobKind;
  status: JobStatus;
  events: JobEvent[];
  last_seq: number;
  more: boolean;
  queue_position: number | null;
  done: boolean;
  result: CleanResult | Record<string, unknown> | null;
  error: { code: FayeErrorCode; message: string } | null;
  retracted: boolean;
  purged: boolean;
}

/** What a database function reported when it declined. */
export interface RpcRefusal {
  ok: false;
  code: FayeErrorCode;
  detail?: string;
  retryAfterSec?: number;
  /** HTTP-level problem (database unreachable, function missing) rather than a business refusal. */
  infrastructure?: boolean;
}
