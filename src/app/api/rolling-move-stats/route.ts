import { NextResponse } from "next/server";
import { getRollingMoveStats } from "@/lib/agents/trading-agent/skills/rolling-move-stats";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  const assetClass = (searchParams.get("assetClass") ?? "equity") as AssetClass;
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  try {
    const result = await getRollingMoveStats(ticker, assetClass);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
