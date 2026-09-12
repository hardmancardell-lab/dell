import { NextResponse } from "next/server";
import { runFomcWeekVarianceStudy } from "@/lib/agents/trading-agent/skills/fomc-week-variance-study";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "GLD";

  try {
    const result = await runFomcWeekVarianceStudy(ticker);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
