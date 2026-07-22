import { NextResponse } from "next/server";
import { runTimeOfDayBacktest } from "@/lib/agents/trading-agent/skills/calendar-effects";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const lookbackDaysParam = searchParams.get("lookbackDays");

  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const lookbackDays = lookbackDaysParam ? Number(lookbackDaysParam) : 90;
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0 || lookbackDays > 180) {
    return NextResponse.json({ error: "'lookbackDays' must be a number between 1 and 180." }, { status: 400 });
  }

  try {
    const result = await runTimeOfDayBacktest(ticker, lookbackDays);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
