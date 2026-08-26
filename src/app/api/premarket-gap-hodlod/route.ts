import { NextResponse } from "next/server";
import { getPremarketGapAndHodLodStats } from "@/lib/agents/trading-agent/skills/premarket-gap-hodlod";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const lookbackDays = Number(searchParams.get("lookbackDays") ?? "365");
  const dropThresholdPct = Number(searchParams.get("dropThresholdPct") ?? "4.5");

  try {
    const result = await getPremarketGapAndHodLodStats(ticker, lookbackDays, dropThresholdPct);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
