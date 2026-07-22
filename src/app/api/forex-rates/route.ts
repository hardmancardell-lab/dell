import { NextResponse } from "next/server";
import { getTopForexRates } from "@/lib/agents/trading-agent/skills/forex-rates";

export async function GET() {
  try {
    const result = await getTopForexRates();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
