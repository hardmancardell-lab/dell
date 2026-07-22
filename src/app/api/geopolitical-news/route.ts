import { NextResponse } from "next/server";
import { getGeopoliticalNews, MAJOR_PAIR_KEYWORDS } from "@/lib/agents/trading-agent/skills/geopolitical-news";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pair = searchParams.get("pair");
  const freeform = searchParams.get("query");

  try {
    if (pair) {
      const match = MAJOR_PAIR_KEYWORDS.find((p) => p.pair === pair);
      if (!match) {
        return NextResponse.json({ error: `Unknown pair "${pair}".` }, { status: 400 });
      }
      const result = await getGeopoliticalNews(match.query, match.pair, match.mechanismNote);
      return NextResponse.json(result);
    }

    if (freeform) {
      const result = await getGeopoliticalNews(freeform);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Provide either 'pair' or 'query' query param." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
