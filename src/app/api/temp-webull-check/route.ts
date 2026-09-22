import { NextResponse } from "next/server";
import * as webull from "@/lib/data/webull";

// TEMP: one-off cross-check of Alpaca IEX daily bars vs. Webull's own real
// data for the same ticker/dates, to see whether the two providers actually
// disagree on open/close prints. Delete after use.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "INTC";
  const days = Number(searchParams.get("days") ?? "10");

  if (!webull.isWebullConfigured()) {
    return NextResponse.json({ error: "Webull not configured." }, { status: 503 });
  }

  try {
    const now = Date.now();
    const startMs = now - days * 24 * 60 * 60 * 1000;
    const candles = await webull.fetchDailyBars(ticker, startMs, now);
    return NextResponse.json({ ticker, source: "webull", candles });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
