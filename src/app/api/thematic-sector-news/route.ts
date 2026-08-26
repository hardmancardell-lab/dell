import { NextResponse } from "next/server";
import { getThematicSectorNews, THEMATIC_SECTOR_KEYWORDS } from "@/lib/agents/trading-agent/skills/thematic-sector-news";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const themesParam = searchParams.get("themes");
  const themeKeys = themesParam
    ? themesParam.split(",").map((t) => t.trim()).filter(Boolean)
    : Object.keys(THEMATIC_SECTOR_KEYWORDS);

  try {
    const result = await getThematicSectorNews(themeKeys);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
