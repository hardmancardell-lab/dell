import { NextResponse } from "next/server";
import { getSectorPeerRanking } from "@/lib/agents/research-agent/skills/sector-peer-ranking";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "Missing required 'ticker' query param." }, { status: 400 });
  }
  try {
    const ranking = await getSectorPeerRanking(ticker);
    return NextResponse.json(ranking);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
