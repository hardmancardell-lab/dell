import { NextResponse } from "next/server";
import { getTopFuturesRates } from "@/lib/agents/trading-agent/skills/futures-rates";

export async function GET() {
  try {
    const result = await getTopFuturesRates();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
