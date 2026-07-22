import { NextResponse } from "next/server";
import { runDayOfWeekBacktest } from "@/lib/agents/trading-agent/skills/calendar-effects";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const yearsParam = searchParams.get("years");

  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  const years = yearsParam ? Number(yearsParam) : 3;
  if (!Number.isFinite(years) || years <= 0 || years > 5) {
    return NextResponse.json({ error: "'years' must be a number between 1 and 5." }, { status: 400 });
  }

  try {
    const result = await runDayOfWeekBacktest(ticker, years);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
