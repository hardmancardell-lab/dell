import { NextResponse } from "next/server";
import { getTickerNewsPanel } from "@/lib/agents/trading-agent/skills/ticker-news-panel";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

const VALID_ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const assetClass = searchParams.get("assetClass");

  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  if (!assetClass || !VALID_ASSET_CLASSES.includes(assetClass as AssetClass)) {
    return NextResponse.json({ error: `Missing or invalid 'assetClass'. Must be one of: ${VALID_ASSET_CLASSES.join(", ")}.` }, { status: 400 });
  }

  try {
    const result = await getTickerNewsPanel(ticker, assetClass as AssetClass);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
