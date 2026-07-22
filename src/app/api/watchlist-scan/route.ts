import { NextResponse } from "next/server";
import { scanWatchlist } from "@/lib/agents/trading-agent/skills/watchlist-scan";
import type { WatchlistEntry } from "@/lib/agents/trading-agent/types";

// POST, not GET — every other route in this app is GET+searchParams, but a
// watchlist is a list of {symbol, assetClass} objects that doesn't fit
// cleanly in a query string, and the watchlist itself lives in the client's
// localStorage (no server persistence), so it has to be sent in the body.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { entries?: WatchlistEntry[] };
    if (!body.entries || !Array.isArray(body.entries)) {
      return NextResponse.json({ error: "Request body must include an 'entries' array." }, { status: 400 });
    }
    const summary = await scanWatchlist(body.entries);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
