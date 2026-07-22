import { NextResponse } from "next/server";
import { checkCoverageSpikes } from "@/lib/agents/trading-agent/skills/geopolitical-news";

export async function GET() {
  try {
    const results = await checkCoverageSpikes();
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
