import { NextResponse } from "next/server";
import { runBuybackAnomalyStudy } from "@/lib/agents/trading-agent/skills/buyback-gld-event-study";

export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "GLD";
  try {
    const result = await runBuybackAnomalyStudy(ticker);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
