import { NextResponse } from "next/server";
import { scanMarket, scanSector } from "@/lib/agents/trading-agent/skills/pm-volume-scan";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sector = searchParams.get("sector");
  if (!sector) {
    return NextResponse.json({ error: "Missing required 'sector' query param (or 'market')." }, { status: 400 });
  }
  try {
    if (sector === "market") {
      const summaries = await scanMarket();
      return NextResponse.json({ summaries });
    }
    const summary = await scanSector(sector);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
