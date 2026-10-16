import { NextResponse } from "next/server";
import { parseAnchorParam } from "@/lib/agents/trading-agent/skills/anchored-volume-profile";
import { getAnchoredVolumeProfile } from "@/lib/agents/trading-agent/skills/anchored-volume-profile-service";

export const maxDuration = 60;

// Equity tickers (AAPL, BRK.B) or Coinbase product ids (BTC-USD). Forex is excluded: tick volume is not traded volume.
const SYMBOL = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/;

/**
 * Anchored volume profile for one symbol from 5-minute bars: POC, 70% value area, high/low volume nodes. Read-only
 * research, no orders, behind the same login as the other studies.
 *
 *   GET /api/anchored-volume-profile?ticker=SPY&anchor=session
 *   anchor = session | previous | multi (with days=2..20) | date:YYYY-MM-DD | time:ISO-8601
 *   bins   = target number of price bins (20..200, default 60)
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const ticker = (sp.get("ticker") ?? "").trim();
  if (!SYMBOL.test(ticker)) {
    return NextResponse.json({ error: "Provide a ticker such as SPY, or a crypto product such as BTC-USD." }, { status: 400 });
  }

  const daysRaw = sp.get("days");
  const days = daysRaw === null || daysRaw === "" ? null : Number(daysRaw);
  const anchor = parseAnchorParam(sp.get("anchor"), days, Date.now());
  if (!anchor.ok) return NextResponse.json({ error: anchor.error }, { status: 400 });

  const binsRaw = sp.get("bins");
  const bins = binsRaw === null || binsRaw === "" ? 60 : Number(binsRaw);
  if (!Number.isInteger(bins) || bins < 20 || bins > 200) {
    return NextResponse.json({ error: "'bins' must be a whole number from 20 to 200." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getAnchoredVolumeProfile(ticker, anchor.spec, bins));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
