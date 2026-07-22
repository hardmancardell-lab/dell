import { NextResponse } from "next/server";
import { getLog } from "@/lib/agents/trading-agent/skills/paper-backtest-log";

export async function GET() {
  try {
    const entries = await getLog();
    return NextResponse.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
