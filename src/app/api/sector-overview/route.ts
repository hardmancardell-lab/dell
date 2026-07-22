import { NextResponse } from "next/server";
import { getSectorOverview } from "@/lib/agents/research-agent/skills/sector-overview";

export async function GET() {
  try {
    const matrix = await getSectorOverview();
    return NextResponse.json(matrix);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
