import { NextResponse } from "next/server";
import { getWatchlistCurrencyNews } from "@/lib/agents/trading-agent/skills/watchlist-news";
import type { WatchlistEntry } from "@/lib/agents/trading-agent/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: "Body must be { entries: WatchlistEntry[] }." }, { status: 400 });
  }
  try {
    const result = await getWatchlistCurrencyNews(body.entries as WatchlistEntry[]);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
