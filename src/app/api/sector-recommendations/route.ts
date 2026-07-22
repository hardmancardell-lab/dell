import { NextResponse } from "next/server";
import { getSectorRecommendations } from "@/lib/agents/research-agent/skills/sector-recommendations";
import { getMacroOverview } from "@/lib/agents/research-agent/skills/macro-overview";

export async function GET() {
  try {
    const matrix = await getMacroOverview();
    const recommendations = await getSectorRecommendations(matrix);
    return NextResponse.json(recommendations);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
