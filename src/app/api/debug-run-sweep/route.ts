import { NextResponse } from "next/server";
import { runHypothesisSweep } from "@/lib/agents/trading-agent/skills/hypothesis-sweep";

export const maxDuration = 60;

// TEMP debug route — manually re-triggers the weekly hypothesis sweep so the
// new stop_loss_verdict column gets populated today. Delete after verifying.
export async function GET() {
  try {
    const result = await runHypothesisSweep();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
