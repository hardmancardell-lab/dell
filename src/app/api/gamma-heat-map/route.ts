import { NextResponse } from "next/server";
import { computeGammaHeatMap } from "@/lib/agents/trading-agent/skills/gamma-heat-map";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  try {
    return NextResponse.json(await computeGammaHeatMap(ticker));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
