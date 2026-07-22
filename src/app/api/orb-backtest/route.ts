import { NextResponse } from "next/server";
import { runOrbBacktest } from "@/lib/agents/trading-agent/skills/opening-range-breakout";

const VALID_RANGE_MINUTES = [5, 15, 30];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const openingRangeMinutesParam = searchParams.get("openingRangeMinutes");
  const lookbackMonthsParam = searchParams.get("lookbackMonths");

  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const openingRangeMinutes = openingRangeMinutesParam ? Number(openingRangeMinutesParam) : 15;
  if (!VALID_RANGE_MINUTES.includes(openingRangeMinutes)) {
    return NextResponse.json({ error: `'openingRangeMinutes' must be one of: ${VALID_RANGE_MINUTES.join(", ")}.` }, { status: 400 });
  }
  const lookbackMonths = lookbackMonthsParam ? Number(lookbackMonthsParam) : 3;
  if (!Number.isFinite(lookbackMonths) || lookbackMonths <= 0 || lookbackMonths > 6) {
    return NextResponse.json({ error: "'lookbackMonths' must be a number between 1 and 6." }, { status: 400 });
  }

  try {
    const result = await runOrbBacktest(ticker, openingRangeMinutes as 5 | 15 | 30, lookbackMonths);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
