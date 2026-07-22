import { NextResponse } from "next/server";
import { runSingleWeekdayBacktest } from "@/lib/agents/trading-agent/skills/calendar-effects";
import type { DayOfWeekLabel } from "@/lib/agents/trading-agent/types";

const VALID_DAYS: DayOfWeekLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const dayOfWeek = searchParams.get("dayOfWeek");
  const occurrencesParam = searchParams.get("occurrences");

  if (!ticker || !dayOfWeek) {
    return NextResponse.json({ error: "Missing required 'ticker' and 'dayOfWeek' query params." }, { status: 400 });
  }
  if (!VALID_DAYS.includes(dayOfWeek as DayOfWeekLabel)) {
    return NextResponse.json({ error: "'dayOfWeek' must be one of Monday-Friday." }, { status: 400 });
  }
  const occurrences = occurrencesParam ? Number(occurrencesParam) : 50;
  if (!Number.isFinite(occurrences) || occurrences <= 0 || occurrences > 200) {
    return NextResponse.json({ error: "'occurrences' must be a number between 1 and 200." }, { status: 400 });
  }

  try {
    const result = await runSingleWeekdayBacktest(ticker, dayOfWeek as DayOfWeekLabel, occurrences);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
