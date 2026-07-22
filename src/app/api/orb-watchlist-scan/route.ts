import { NextResponse } from "next/server";
import { scanWatchlistOrb } from "@/lib/agents/trading-agent/skills/opening-range-breakout-watchlist";
import type { AssetClass, WatchlistEntry } from "@/lib/agents/trading-agent/types";

const VALID_RANGE_MINUTES = [5, 15, 30];

// POST, not GET — same rationale as watchlist-scan/route.ts: the watchlist
// is an array of {symbol, assetClass} objects that doesn't fit a query
// string, and it lives client-side only.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      entries?: WatchlistEntry[];
      openingRangeMinutes?: number;
      lookbackMonths?: number;
      allowedAssetClasses?: AssetClass[];
    };
    if (!body.entries || !Array.isArray(body.entries)) {
      return NextResponse.json({ error: "Request body must include an 'entries' array." }, { status: 400 });
    }
    const openingRangeMinutes = body.openingRangeMinutes ?? 15;
    if (!VALID_RANGE_MINUTES.includes(openingRangeMinutes)) {
      return NextResponse.json({ error: `'openingRangeMinutes' must be one of: ${VALID_RANGE_MINUTES.join(", ")}.` }, { status: 400 });
    }
    const lookbackMonths = body.lookbackMonths ?? 3;
    if (!Number.isFinite(lookbackMonths) || lookbackMonths <= 0 || lookbackMonths > 6) {
      return NextResponse.json({ error: "'lookbackMonths' must be a number between 1 and 6." }, { status: 400 });
    }

    const summary = await scanWatchlistOrb(
      body.entries,
      openingRangeMinutes as 5 | 15 | 30,
      lookbackMonths,
      body.allowedAssetClasses
    );
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
