import { NextResponse } from "next/server";
import { getHighConvictionStrategies } from "@/lib/agents/trading-agent/skills/high-conviction-strategies";

export const maxDuration = 30;

// TEMP debug route — verifying getHighConvictionStrategies end to end. Delete after.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minWinRate = Number(searchParams.get("minWinRate") ?? "84");
  try {
    const strategies = await getHighConvictionStrategies(minWinRate);
    return NextResponse.json({ count: strategies.length, strategies });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
