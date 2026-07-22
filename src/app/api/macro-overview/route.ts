import { NextResponse } from "next/server";
import { getMacroOverview } from "@/lib/agents/research-agent/skills/macro-overview";

export async function GET() {
  try {
    const matrix = await getMacroOverview();
    return NextResponse.json(matrix);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
