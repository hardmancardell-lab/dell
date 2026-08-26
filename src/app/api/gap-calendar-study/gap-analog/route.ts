import { NextResponse } from "next/server";
import { getGapAnalogScan } from "@/lib/agents/trading-agent/skills/gap-calendar-study";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const gapThresholdPctParam = searchParams.get("gapThresholdPct");
  if (!ticker) return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  if (gapThresholdPctParam === null) {
    return NextResponse.json({ error: "Missing required 'gapThresholdPct' query param (signed, e.g. 2 for +2% up or -0.85 for -0.85% down)." }, { status: 400 });
  }

  const asOfTimeEt = searchParams.get("asOfTimeEt") ?? "07:00";
  const gapThresholdPct = Number(gapThresholdPctParam);
  const lookbackDays = Number(searchParams.get("lookbackDays") ?? "400");

  try {
    const result = await getGapAnalogScan(ticker, asOfTimeEt, gapThresholdPct, lookbackDays);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
