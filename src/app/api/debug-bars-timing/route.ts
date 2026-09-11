import { NextResponse } from "next/server";
import { getDailyBars } from "@/lib/agents/trading-agent/skills/daily-bars";
import { fetchMinuteBars } from "@/lib/data/market-data";

export const maxDuration = 60;

// TEMP debug route — isolating which real call times out. Delete after.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("ticker") ?? "GOOGL").toUpperCase();
  const years = Number(searchParams.get("years") ?? "3");
  const months = Number(searchParams.get("months") ?? "6");

  const results: Record<string, unknown> = {};

  const dailyStart = Date.now();
  try {
    const lookbackCalendarDays = Math.round(years * 365.25) + 30;
    const bars = await getDailyBars(symbol, lookbackCalendarDays);
    results.daily = { ok: true, ms: Date.now() - dailyStart, count: bars.length };
  } catch (err) {
    results.daily = { ok: false, ms: Date.now() - dailyStart, error: err instanceof Error ? err.message : "unknown" };
  }

  const minuteStart = Date.now();
  try {
    const now = Date.now();
    const minuteLookbackDays = Math.round(months * 30.44);
    const startMs = now - minuteLookbackDays * 24 * 60 * 60 * 1000;
    const candles = await fetchMinuteBars(symbol, startMs, now, 60 * 30);
    results.minute = { ok: true, ms: Date.now() - minuteStart, count: candles.length };
  } catch (err) {
    results.minute = { ok: false, ms: Date.now() - minuteStart, error: err instanceof Error ? err.message : "unknown" };
  }

  return NextResponse.json(results);
}
