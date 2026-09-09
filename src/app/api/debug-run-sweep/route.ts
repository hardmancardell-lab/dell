import { NextResponse } from "next/server";
import { runHypothesisSweep } from "@/lib/agents/trading-agent/skills/hypothesis-sweep";

export const maxDuration = 60;

// TEMP debug route — manually triggers the weekly hypothesis sweep so the
// new largest_loss_pct/max_drawdown_pct columns get populated today rather
// than waiting for next Monday's cron. Delete after verifying.
export async function GET() {
  try {
    const result = await runHypothesisSweep();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
