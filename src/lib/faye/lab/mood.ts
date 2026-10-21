/**
 * What Faye's full-body figure shows at the top of the Lab. Pure. The order matters:
 *   offline      the worker is stale (nobody is answering, so nothing can run)
 *   thinking     a test is queued or running
 *   unsure       the newest result of some suite is lower than the one before it
 *   celebrating  the newest guardrail result is 8 of 8
 *   idle         everything else
 */
import type { FayeMood } from "@/components/faye/FayeAvatar";
import type { EvalRun, PendingEval } from "./types";

export type LabMoodReason = "offline" | "running" | "dropped" | "guardrail_clear" | "idle";

export interface LabMoodInput {
  online: boolean;
  pending: readonly PendingEval[];
  /** Any order; the newest by time is used. */
  runs: readonly EvalRun[];
}

export interface LabMood {
  mood: FayeMood;
  reason: LabMoodReason;
  /** The suite that dropped, when reason is "dropped". */
  suite?: string;
}

const time = (r: EvalRun) => Date.parse(r.createdAt ?? r.finishedAt ?? "") || 0;

/** Newest run of a suite and the one before it. */
function lastTwo(runs: readonly EvalRun[], suite: string): [EvalRun | null, EvalRun | null] {
  const mine = runs
    .filter((r) => r.suite === suite && r.total > 0)
    .slice()
    .sort((a, b) => time(b) - time(a));
  return [mine[0] ?? null, mine[1] ?? null];
}

export function labMood(input: LabMoodInput): LabMood {
  if (!input.online) return { mood: "offline", reason: "offline" };
  if (input.pending.length > 0) return { mood: "thinking", reason: "running" };
  const suites = Array.from(new Set(input.runs.map((r) => r.suite)));
  for (const s of suites) {
    const [now, before] = lastTwo(input.runs, s);
    if (now && before && now.passed / now.total < before.passed / before.total) return { mood: "unsure", reason: "dropped", suite: s };
  }
  const [g] = lastTwo(input.runs, "guardrail");
  if (g && g.total === 8 && g.passed === 8) return { mood: "celebrating", reason: "guardrail_clear" };
  return { mood: "idle", reason: "idle" };
}
