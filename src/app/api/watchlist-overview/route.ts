import { NextResponse } from "next/server";
import { getWatchlistOverview } from "@/lib/agents/research-agent/skills/watchlist-overview";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get("symbols");
    const symbols = symbolsParam
      ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];
    if (symbols.length === 0) {
      return NextResponse.json({ error: "No 'symbols' query param provided." }, { status: 400 });
    }
    const result = await getWatchlistOverview(symbols);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
