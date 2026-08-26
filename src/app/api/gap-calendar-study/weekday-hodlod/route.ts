import { NextResponse } from "next/server";
import { getWeekdayHodLodStudy } from "@/lib/agents/trading-agent/skills/gap-calendar-study";

export const maxDuration = 60;

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });

  const weekdayParam = (searchParams.get("weekday") ?? "tuesday").toLowerCase();
  const weekday = WEEKDAY_NAMES[weekdayParam];
  if (weekday === undefined) {
    return NextResponse.json({ error: `Invalid 'weekday' — expected a day name (e.g. "tuesday"), got "${weekdayParam}".` }, { status: 400 });
  }
  const occurrenceCount = Number(searchParams.get("occurrenceCount") ?? "50");

  try {
    const result = await getWeekdayHodLodStudy(ticker, weekday, occurrenceCount);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
