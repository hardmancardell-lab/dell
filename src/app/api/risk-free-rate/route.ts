import { NextResponse } from "next/server";
import { getCurrentRiskFreeRate } from "@/lib/agents/trading-agent/skills/options-calculator";

export async function GET() {
  try {
    const result = await getCurrentRiskFreeRate();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
